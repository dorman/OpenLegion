import { Spinner } from "@openlegion-ai/ui/spinner"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"

// The guest's headless Chromium is pinned to this framebuffer; see guestCDPPort
// / desktopScreen* in internal/engine/qemu_sandbox.go. The viewer letterboxes
// this fixed size to fit, mirroring the VNC desktop tab.
const FRAME_W = 1440
const FRAME_H = 900

function logBrowserDisplay(event: string, extra?: Record<string, unknown>) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : ""
  console.info(`[openlegion:browser-display] ${event}${payload}`)
}

const CDP_BUTTON = ["left", "middle", "right"] as const

type Cmd = (method: string, params?: Record<string, unknown>) => void

/**
 * CDP-streamed browser viewer. Connects to the daemon WebSocket (which tunnels
 * to the guest Chromium page debugger), drives Page.startScreencast for frames
 * and Input.dispatch* for mouse/keyboard. Parallel to ContainerDisplay (VNC);
 * the inspect dialog picks between them on the display "kind".
 *
 * Unlike a VNC desktop, headless Chromium renders no browser chrome and no
 * cursor, so this component supplies its own address bar (Page.navigate) and a
 * synthetic local cursor.
 */
export function ContainerBrowser(props: {
  url: string
  password?: string
  active: boolean
  compact?: boolean
  fullscreen?: boolean
}) {
  const language = useLanguage()
  let canvas!: HTMLCanvasElement
  let stage!: HTMLDivElement
  const [error, setError] = createSignal<string | undefined>()
  const [connecting, setConnecting] = createSignal(true)
  const [connected, setConnected] = createSignal(false)
  const [address, setAddress] = createSignal("https://example.com")
  const [cursor, setCursor] = createSignal<{ x: number; y: number } | null>(null)

  // Lifted so the address bar (rendered outside the connect effect) can drive
  // navigation on the live socket.
  let sendCmd: Cmd | undefined

  const sessionKey = createMemo(() => props.url)

  function navigate() {
    let target = address().trim()
    if (!target) return
    if (!/^[a-z]+:\/\//i.test(target)) target = "https://" + target
    setAddress(target)
    sendCmd?.("Page.navigate", { url: target })
    canvas.focus()
  }

  createEffect(() => {
    // Re-run whenever the target URL changes or the tab toggles active.
    sessionKey()
    if (!props.active) {
      logBrowserDisplay("inactive")
      setConnecting(true)
      setConnected(false)
      setError(undefined)
      return
    }

    let cancelled = false
    let nextId = 1
    let buttonsMask = 0
    const decoder = new Image()
    const ctx = canvas.getContext("2d")
    setConnecting(true)
    setConnected(false)
    setError(undefined)
    logBrowserDisplay("connecting", { url: props.url })

    const ws = new WebSocket(props.url)

    function send(method: string, params: Record<string, unknown> = {}) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: nextId++, method, params }))
    }
    sendCmd = send

    decoder.onload = () => ctx?.drawImage(decoder, 0, 0, FRAME_W, FRAME_H)

    ws.addEventListener("open", () => {
      if (cancelled) return
      logBrowserDisplay("connected")
      setConnecting(false)
      setConnected(true)
      send("Page.enable")
      send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: FRAME_W, maxHeight: FRAME_H, everyNthFrame: 1 })
      canvas.focus()
    })

    ws.addEventListener("message", (event) => {
      let msg: { method?: string; params?: { sessionId?: number; data?: string } }
      try {
        msg = JSON.parse(event.data as string)
      } catch {
        return
      }
      if (msg.method === "Page.screencastFrame" && msg.params?.data) {
        decoder.src = "data:image/jpeg;base64," + msg.params.data
        // Ack immediately or Chromium stops emitting frames.
        send("Page.screencastFrameAck", { sessionId: msg.params.sessionId })
      }
    })

    ws.addEventListener("close", () => {
      if (cancelled) return
      logBrowserDisplay("disconnected")
      setConnecting(false)
      setConnected(false)
      setError(language.t("containers.inspect.displayDisconnected"))
    })
    ws.addEventListener("error", () => {
      if (cancelled) return
      logBrowserDisplay("connect failed")
      setConnecting(false)
      setError(language.t("containers.inspect.displayDisconnected"))
    })

    // --- map canvas CSS coords -> the fixed framebuffer's device pixels ------
    function toFrame(e: MouseEvent) {
      const r = canvas.getBoundingClientRect()
      const x = ((e.clientX - r.left) / r.width) * FRAME_W
      const y = ((e.clientY - r.top) / r.height) * FRAME_H
      return { x: Math.max(0, Math.min(FRAME_W, x)), y: Math.max(0, Math.min(FRAME_H, y)) }
    }

    function onMove(e: MouseEvent) {
      const p = toFrame(e)
      // Synthetic cursor follows the hand instantly — headless Chromium draws
      // none into the stream, so without this the view feels disconnected.
      const sr = stage.getBoundingClientRect()
      setCursor({ x: e.clientX - sr.left, y: e.clientY - sr.top })
      send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, buttons: buttonsMask })
    }
    function onLeave() {
      setCursor(null)
    }
    function onDown(e: MouseEvent) {
      e.preventDefault()
      canvas.focus()
      const p = toFrame(e)
      buttonsMask |= 1 << e.button
      send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: CDP_BUTTON[e.button] ?? "left", buttons: buttonsMask, clickCount: 1 })
    }
    function onUp(e: MouseEvent) {
      const p = toFrame(e)
      buttonsMask &= ~(1 << e.button)
      send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: CDP_BUTTON[e.button] ?? "left", buttons: buttonsMask, clickCount: 1 })
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const p = toFrame(e)
      send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY })
    }
    function onContext(e: MouseEvent) {
      e.preventDefault()
    }
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      send("Input.dispatchKeyEvent", { type: "keyDown", key: e.key, code: e.code, text: e.key.length === 1 ? e.key : "", windowsVirtualKeyCode: e.keyCode })
    }
    function onKeyUp(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      send("Input.dispatchKeyEvent", { type: "keyUp", key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode })
    }

    canvas.addEventListener("mousemove", onMove)
    canvas.addEventListener("mouseleave", onLeave)
    canvas.addEventListener("mousedown", onDown)
    canvas.addEventListener("mouseup", onUp)
    canvas.addEventListener("wheel", onWheel, { passive: false })
    canvas.addEventListener("contextmenu", onContext)
    canvas.addEventListener("keydown", onKeyDown)
    canvas.addEventListener("keyup", onKeyUp)

    onCleanup(() => {
      cancelled = true
      logBrowserDisplay("cleanup")
      sendCmd = undefined
      canvas.removeEventListener("mousemove", onMove)
      canvas.removeEventListener("mouseleave", onLeave)
      canvas.removeEventListener("mousedown", onDown)
      canvas.removeEventListener("mouseup", onUp)
      canvas.removeEventListener("wheel", onWheel)
      canvas.removeEventListener("contextmenu", onContext)
      canvas.removeEventListener("keydown", onKeyDown)
      canvas.removeEventListener("keyup", onKeyUp)
      decoder.onload = null
      ws.close()
    })
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <Show when={error()}>
        <div class="text-sm text-v2-text-text-danger">{error()}</div>
      </Show>
      {/* Address bar — headless Chromium has no chrome, so navigation lives here. */}
      <form
        class="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          navigate()
        }}
      >
        <input
          value={address()}
          onInput={(e) => setAddress(e.currentTarget.value)}
          spellcheck={false}
          autocomplete="off"
          placeholder="https://…"
          class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-3 py-1.5 font-mono text-sm text-v2-text-text-base outline-none focus:border-v2-border-border-strong"
        />
        <button
          type="submit"
          class="rounded-md border border-v2-border-border-base px-3 py-1.5 text-sm text-v2-text-text-base hover:bg-v2-background-bg-subtle"
        >
          Go
        </button>
      </form>
      <div
        ref={stage}
        classList={{
          "relative flex min-h-[min(50vh,420px)] flex-1 items-center justify-center overflow-hidden rounded-md border border-v2-border-border-base bg-black": true,
          "min-h-[240px]": props.compact,
          "fixed inset-4 z-[100] min-h-0 rounded-lg shadow-2xl": props.fullscreen,
        }}
      >
        <Show when={connecting() && !connected()}>
          <div class="absolute inset-0 z-10 flex items-center justify-center bg-v2-background-bg-base/80">
            <Spinner />
          </div>
        </Show>
        <canvas
          ref={canvas}
          width={FRAME_W}
          height={FRAME_H}
          tabindex={0}
          role="application"
          aria-label={language.t("containers.inspect.displayViewport")}
          class="max-h-full max-w-full cursor-none outline-none"
          style={{ "aspect-ratio": `${FRAME_W} / ${FRAME_H}` }}
        />
        <Show when={cursor()}>
          {(pos) => (
            <div
              class="pointer-events-none absolute z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white mix-blend-difference"
              style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            />
          )}
        </Show>
      </div>
    </div>
  )
}
