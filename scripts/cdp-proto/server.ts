#!/usr/bin/env bun
/**
 * Throwaway CDP-browser prototype backend.
 *
 * This is the feel-test stand-in for the eventual product: it owns the CDP
 * socket to a headless Chromium and relays to a browser viewer. In the real
 * thing this role is played by internal/display/bridge.go (the WS proxy) and
 * the viewer becomes a ContainerBrowser component. Nothing here is meant to
 * ship — it exists so we can click around and measure input->paint latency
 * side-by-side with the VNC desktop tab before committing engineering to it.
 *
 * Run:  bun scripts/cdp-proto/server.ts
 * Then: open http://localhost:8080
 *
 * Chromium resolution order:
 *   1. CDP_CHROME_PATH env var
 *   2. common macOS Chrome/Chromium/Brave/Edge install paths
 *   3. auto-download chrome-for-testing via `@puppeteer/browsers`
 */

const FRAME_W = 1440
const FRAME_H = 900
const DEBUG_PORT = 9222
const VIEWER_PORT = 8080

// --- 1. Resolve a Chromium binary ------------------------------------------

async function resolveChrome(): Promise<string> {
  const fromEnv = process.env.CDP_CHROME_PATH
  if (fromEnv && (await Bun.file(fromEnv).exists())) return fromEnv

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ]
  for (const c of candidates) {
    if (await Bun.file(c).exists()) return c
  }

  // Nothing installed: download a self-contained chrome-for-testing build.
  const cacheDir = `${import.meta.dir}/.cache`
  const existing = await findCachedChrome(cacheDir)
  if (existing) return existing

  console.log("[cdp-proto] no Chromium found; downloading chrome-for-testing (one-time)...")
  const proc = Bun.spawn(
    ["bunx", "@puppeteer/browsers", "install", "chrome@stable", "--path", cacheDir],
    { stdout: "inherit", stderr: "inherit" },
  )
  await proc.exited
  // The installer path contains spaces ("Google Chrome for Testing.app"), so
  // don't parse stdout — locate the executable on disk by its known layout.
  const found = await findCachedChrome(cacheDir)
  if (!found) throw new Error(`chrome installed but executable not found under ${cacheDir}`)
  return found
}

async function findCachedChrome(cacheDir: string): Promise<string | undefined> {
  const { Glob } = await import("bun")
  // macOS arm: .cache/chrome/mac_arm-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
  const glob = new Glob("chrome/*/chrome-mac*/*.app/Contents/MacOS/*")
  for await (const rel of glob.scan({ cwd: cacheDir, onlyFiles: true })) {
    return `${cacheDir}/${rel}`
  }
  return undefined
}

// --- 2. Minimal CDP client over a WebSocket --------------------------------

type CdpMessage = { id?: number; method?: string; params?: any; result?: any; error?: any; sessionId?: string }

class Cdp {
  private ws: WebSocket
  private nextId = 1
  private pending = new Map<number, (m: CdpMessage) => void>()
  private listeners = new Map<string, ((params: any) => void)[]>()
  ready: Promise<void>

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve())
      this.ws.addEventListener("error", (e) => reject(e))
    })
    this.ws.addEventListener("message", (ev) => {
      const msg: CdpMessage = JSON.parse(ev.data as string)
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg)
        this.pending.delete(msg.id)
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
      }
    })
  }

  send(method: string, params: any = {}): Promise<any> {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)))
    })
  }

  on(method: string, fn: (params: any) => void) {
    const arr = this.listeners.get(method) ?? []
    arr.push(fn)
    this.listeners.set(method, arr)
  }
}

// --- 3. Launch Chromium and find the page target ----------------------------

async function debugEndpointUp(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(800) })
    return r.ok
  } catch {
    return false
  }
}

// Reuse a Chromium left running by a previous run instead of leaking another.
let chrome: ReturnType<typeof Bun.spawn> | undefined
if (await debugEndpointUp()) {
  console.log("[cdp-proto] reusing existing Chromium on :" + DEBUG_PORT)
} else {
  const chromePath = await resolveChrome()
  console.log(`[cdp-proto] launching: ${chromePath}`)
  chrome = Bun.spawn(
    [
      chromePath,
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--remote-allow-origins=*",
      `--window-size=${FRAME_W},${FRAME_H}`,
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=" + `${import.meta.dir}/.cache/profile`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  )
}

async function findPageTarget(): Promise<string> {
  // First launch of a freshly downloaded, quarantined app can take ~10s.
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      const targets = (await res.json()) as any[]
      const page = targets.find((t) => t.type === "page")
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // not up yet
    }
    await Bun.sleep(200)
  }
  throw new Error("Chromium debug endpoint never became ready")
}

const pageWsUrl = await findPageTarget()
console.log(`[cdp-proto] attached to page target`)

// --- 4. Viewer server: serve HTML + bridge a viewer WS to a CDP session -----

const indexHtml = await Bun.file(`${import.meta.dir}/index.html`).text()

Bun.serve({
  port: VIEWER_PORT,
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return
      return new Response("expected websocket", { status: 400 })
    }
    return new Response(indexHtml, { headers: { "content-type": "text/html" } })
  },
  websocket: {
    async open(viewer) {
      // Each viewer gets its own CDP connection to the same page target.
      const cdp = new Cdp(pageWsUrl)
      await cdp.ready
      ;(viewer as any).cdp = cdp

      cdp.on("Page.screencastFrame", (p) => {
        // Forward the JPEG, then immediately ack so the stream keeps flowing.
        viewer.send(JSON.stringify({ t: "frame", data: p.data }))
        cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {})
      })

      await cdp.send("Page.enable")
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: FRAME_W,
        maxHeight: FRAME_H,
        everyNthFrame: 1,
      })
      viewer.send(JSON.stringify({ t: "ready", w: FRAME_W, h: FRAME_H }))
    },
    async message(viewer, raw) {
      const cdp: Cdp = (viewer as any).cdp
      if (!cdp) return
      const m = JSON.parse(raw as string)
      switch (m.t) {
        case "mouse":
          cdp.send("Input.dispatchMouseEvent", {
            type: m.sub, // mouseMoved | mousePressed | mouseReleased | mouseWheel
            x: m.x,
            y: m.y,
            button: m.button ?? "none",
            buttons: m.buttons ?? 0,
            clickCount: m.sub === "mousePressed" || m.sub === "mouseReleased" ? 1 : 0,
            deltaX: m.deltaX ?? 0,
            deltaY: m.deltaY ?? 0,
          }).catch(() => {})
          break
        case "key":
          cdp.send("Input.dispatchKeyEvent", {
            type: m.sub, // keyDown | keyUp
            key: m.key,
            code: m.code,
            text: m.text ?? "",
            windowsVirtualKeyCode: m.keyCode ?? 0,
          }).catch(() => {})
          break
        case "navigate":
          cdp.send("Page.navigate", { url: m.url }).catch(() => {})
          break
      }
    },
    close(viewer) {
      // CDP socket is GC'd with the viewer; nothing else to clean up in a throwaway.
      void viewer
    },
  },
})

console.log(`\n[cdp-proto] viewer ready -> http://localhost:${VIEWER_PORT}\n`)

process.on("SIGINT", () => {
  chrome?.kill()
  process.exit(0)
})
