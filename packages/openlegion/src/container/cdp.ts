import type { VncInputAction } from "@/container/vnc"

/**
 * Minimal Chrome DevTools Protocol client for the CDP browser display the
 * sandbox daemon exposes for headless-Chromium desktop VMs (the `cdp` display
 * kind). It is the screenshot/input counterpart of the RFB client in `vnc.ts`:
 * the daemon bridge tunnels this WebSocket straight to the guest Chromium page
 * debugger, so we speak CDP directly — `Page.captureScreenshot` for senses and
 * `Input.dispatch*` for computer use. Actions share `VncInputAction` so the
 * agent tools treat both display kinds uniformly.
 */

const DEFAULT_TIMEOUT_MS = 20_000

// The guest Chromium is launched at a fixed 1440x900 window (see the desktop
// image's chromium flags and FRAME_* in the front-end browser viewer). Used as
// the coordinate space and as a fallback when layout metrics are unavailable.
const FRAME_W = 1440
const FRAME_H = 900

export class CdpError extends Error {}

export type CdpScreenshot = { width: number; height: number; png: Buffer }

// ---------------------------------------------------------------------------
// CDP command/response multiplexing over a single WebSocket.
// ---------------------------------------------------------------------------

type CdpResult = Record<string, unknown>

class CdpSession {
  private nextId = 1
  private pending = new Map<number, { resolve: (result: CdpResult) => void; reject: (error: Error) => void }>()

  constructor(private readonly socket: WebSocket) {}

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    const id = this.nextId++
    return new Promise<CdpResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (err) {
        this.pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  handleMessage(data: unknown) {
    if (typeof data !== "string") return
    let msg: { id?: number; result?: CdpResult; error?: { message?: string } }
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (typeof msg.id !== "number") return // an event, not a command reply
    const waiter = this.pending.get(msg.id)
    if (!waiter) return
    this.pending.delete(msg.id)
    if (msg.error) waiter.reject(new CdpError(msg.error.message ?? "CDP command failed"))
    else waiter.resolve(msg.result ?? {})
  }

  failAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
  }
}

function withCdpSession<T>(input: { url: string; timeoutMs?: number }, run: (session: CdpSession) => Promise<T>): Promise<T> {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket
  if (!WebSocketCtor) {
    return Promise.reject(new CdpError("WebSocket is not available in this runtime"))
  }

  return new Promise((resolve, reject) => {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let socket: WebSocket
    try {
      socket = new WebSocketCtor(input.url)
    } catch (err) {
      reject(new CdpError(`failed to connect to display: ${err instanceof Error ? err.message : String(err)}`))
      return
    }

    const session = new CdpSession(socket)
    let settled = false
    const finish = (result: { ok: true; value: T } | { ok: false; error: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {}
      if (result.ok) resolve(result.value)
      else reject(result.error)
    }
    const timer = setTimeout(() => {
      const error = new CdpError(`the display session timed out after ${timeoutMs}ms`)
      session.failAll(error)
      finish({ ok: false, error })
    }, timeoutMs)

    socket.onmessage = (event: MessageEvent) => session.handleMessage(event.data)
    socket.onerror = () => {
      const error = new CdpError("websocket connection to the display failed")
      session.failAll(error)
      finish({ ok: false, error })
    }
    socket.onclose = () => {
      const error = new CdpError("the display connection closed unexpectedly")
      session.failAll(error)
      finish({ ok: false, error })
    }
    socket.onopen = () => {
      run(session).then(
        (value) => finish({ ok: true, value }),
        (error) => finish({ ok: false, error: error instanceof Error ? error : new Error(String(error)) }),
      )
    }
  })
}

// ---------------------------------------------------------------------------
// Screenshot.
// ---------------------------------------------------------------------------

/** Read width/height from a PNG's IHDR (8-byte signature + 8-byte chunk header). */
function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length >= 24 && png.readUInt32BE(0) === 0x89504e47) {
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
  }
  return { width: FRAME_W, height: FRAME_H }
}

async function captureScreen(session: CdpSession): Promise<CdpScreenshot> {
  await session.send("Page.enable")
  const result = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
  const data = typeof result.data === "string" ? result.data : undefined
  if (!data) throw new CdpError("CDP returned no screenshot data")
  const png = Buffer.from(data, "base64")
  const { width, height } = pngSize(png)
  return { width, height, png }
}

export function captureCdpScreenshot(input: { url: string; timeoutMs?: number }): Promise<CdpScreenshot> {
  return withCdpSession(input, captureScreen)
}

// ---------------------------------------------------------------------------
// Input: Input.dispatch{Mouse,Key}Event and high-level actions.
// ---------------------------------------------------------------------------

const KEYSTROKE_DELAY_MS = 12
const ACTION_DELAY_MS = 50
const DOUBLE_CLICK_GAP_MS = 80
const SETTLE_BEFORE_SCREENSHOT_MS = 1_000
const MAX_WAIT_MS = 10_000
const MAX_SCROLL_TICKS = 10
const SCROLL_TICK_PX = 100

// CDP mouse "buttons" bitmask (pressed state) and modifier bitmask.
const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const
const MODIFIER_BITS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  super: 4,
  win: 4,
  cmd: 4,
  shift: 8,
}
// Modifier key definitions, keyed by their modifier bit, for synthesising the
// modifier keydown/keyup that brackets a combo.
const MODIFIER_KEYDEFS: Record<number, CdpKey> = {
  1: { key: "Alt", code: "AltLeft", keyCode: 18 },
  2: { key: "Control", code: "ControlLeft", keyCode: 17 },
  4: { key: "Meta", code: "MetaLeft", keyCode: 91 },
  8: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
}

type CdpKey = { key: string; code: string; keyCode: number; text?: string }

const NAMED_KEYS: Record<string, CdpKey> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  insert: { key: "Insert", code: "Insert", keyCode: 45 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
}
for (let i = 1; i <= 12; i++) NAMED_KEYS[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i }

function charKey(char: string): CdpKey {
  const upper = char.toUpperCase()
  let code = ""
  if (/^[a-zA-Z]$/.test(char)) code = `Key${upper}`
  else if (/^[0-9]$/.test(char)) code = `Digit${char}`
  return { key: char, code, keyCode: upper.charCodeAt(0), text: char }
}

function resolveKey(token: string): CdpKey {
  const named = NAMED_KEYS[token.toLowerCase()]
  if (named) return named
  if ([...token].length === 1) return charKey(token)
  throw new CdpError(`unknown key "${token}"`)
}

/** Parse a key combo like "ctrl+c" into modifier bits plus the key itself. */
function parseKeyCombo(combo: string): { modifiers: number[]; key: CdpKey } {
  const trimmed = combo.trim()
  if (trimmed === "") throw new CdpError("empty key")
  if ([...trimmed].length === 1) return { modifiers: [], key: charKey(trimmed) }
  const tokens = trimmed.split("+").map((token) => token.trim())
  // a trailing empty token means a literal "+" was the key, e.g. "ctrl++"
  const last = tokens.pop()!
  const key = last === "" ? charKey("+") : resolveKey(last)
  const modifiers = tokens
    .filter((token) => token !== "")
    .map((token) => {
      const bit = MODIFIER_BITS[token.toLowerCase()]
      if (bit === undefined) throw new CdpError(`"${token}" is not a modifier key (use ctrl, shift, alt, or super)`)
      return bit
    })
  return { modifiers, key }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function dispatchKey(session: CdpSession, k: CdpKey, modifiers: number, down: boolean) {
  // Emit text only on keydown and only when no command modifier is held
  // (Shift still produces text); Ctrl/Alt/Meta combos are shortcuts, not text.
  const emitText = down && (modifiers & ~8) === 0 && k.text !== undefined
  await session.send("Input.dispatchKeyEvent", {
    type: down ? (emitText ? "keyDown" : "rawKeyDown") : "keyUp",
    modifiers,
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.keyCode,
    ...(emitText ? { text: k.text } : {}),
  })
}

async function tapKey(session: CdpSession, k: CdpKey, modifiers = 0) {
  await dispatchKey(session, k, modifiers, true)
  await dispatchKey(session, k, modifiers, false)
}

async function dispatchMouse(
  session: CdpSession,
  type: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel",
  params: Record<string, unknown>,
) {
  await session.send("Input.dispatchMouseEvent", { type, ...params })
}

async function performAction(session: CdpSession, action: VncInputAction, vp: { w: number; h: number }) {
  const clampX = (x: number) => Math.max(0, Math.min(Math.round(x), vp.w - 1))
  const clampY = (y: number) => Math.max(0, Math.min(Math.round(y), vp.h - 1))

  switch (action.action) {
    case "type": {
      // insertText handles the bulk; newlines become Enter presses.
      const parts = action.text.split("\n")
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) await session.send("Input.insertText", { text: parts[i] })
        if (i < parts.length - 1) await tapKey(session, NAMED_KEYS.enter!)
        await sleep(KEYSTROKE_DELAY_MS)
      }
      return
    }
    case "key": {
      const { modifiers, key } = parseKeyCombo(action.key)
      let mask = 0
      for (const bit of modifiers) {
        mask |= bit
        await dispatchKey(session, MODIFIER_KEYDEFS[bit]!, mask, true)
      }
      await tapKey(session, key, mask)
      for (const bit of [...modifiers].reverse()) {
        await dispatchKey(session, MODIFIER_KEYDEFS[bit]!, mask, false)
        mask &= ~bit
      }
      return
    }
    case "click":
    case "double_click": {
      const x = clampX(action.x)
      const y = clampY(action.y)
      const button = action.button ?? "left"
      const buttons = BUTTON_BITS[button]
      const clicks = action.action === "double_click" ? 2 : 1
      await dispatchMouse(session, "mouseMoved", { x, y, buttons: 0 })
      for (let i = 0; i < clicks; i++) {
        if (i > 0) await sleep(DOUBLE_CLICK_GAP_MS)
        await dispatchMouse(session, "mousePressed", { x, y, button, buttons, clickCount: i + 1 })
        await dispatchMouse(session, "mouseReleased", { x, y, button, buttons: 0, clickCount: i + 1 })
      }
      return
    }
    case "move": {
      await dispatchMouse(session, "mouseMoved", { x: clampX(action.x), y: clampY(action.y), buttons: 0 })
      return
    }
    case "scroll": {
      const x = clampX(action.x)
      const y = clampY(action.y)
      const ticks = Math.max(1, Math.min(Math.round(action.amount ?? 3), MAX_SCROLL_TICKS))
      const deltaY = (action.direction === "down" ? 1 : -1) * SCROLL_TICK_PX
      for (let i = 0; i < ticks; i++) {
        await dispatchMouse(session, "mouseWheel", { x, y, deltaX: 0, deltaY })
        await sleep(KEYSTROKE_DELAY_MS)
      }
      return
    }
    case "wait": {
      await sleep(Math.max(0, Math.min(action.ms, MAX_WAIT_MS)))
      return
    }
  }
}

async function viewportSize(session: CdpSession): Promise<{ w: number; h: number }> {
  try {
    const metrics = await session.send("Page.getLayoutMetrics")
    const vp = (metrics.cssVisualViewport ?? metrics.cssLayoutViewport) as
      | { clientWidth?: number; clientHeight?: number }
      | undefined
    const w = Math.round(vp?.clientWidth ?? FRAME_W)
    const h = Math.round(vp?.clientHeight ?? FRAME_H)
    return { w: w || FRAME_W, h: h || FRAME_H }
  } catch {
    return { w: FRAME_W, h: FRAME_H }
  }
}

function estimateActionsMs(actions: readonly VncInputAction[]) {
  let total = SETTLE_BEFORE_SCREENSHOT_MS
  for (const action of actions) {
    total += 500
    if (action.action === "wait") total += Math.min(action.ms, MAX_WAIT_MS)
  }
  return total
}

/**
 * Perform a sequence of input actions over one CDP connection, then capture a
 * screenshot of the resulting page after a short settle delay.
 */
export function performCdpActions(input: {
  url: string
  actions: readonly VncInputAction[]
  timeoutMs?: number
  settleMs?: number
}): Promise<CdpScreenshot> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS + estimateActionsMs(input.actions)
  return withCdpSession({ url: input.url, timeoutMs }, async (session) => {
    await session.send("Page.enable")
    const vp = await viewportSize(session)
    for (const action of input.actions) {
      await performAction(session, action, vp)
      await sleep(ACTION_DELAY_MS)
    }
    await sleep(input.settleMs ?? SETTLE_BEFORE_SCREENSHOT_MS)
    return captureScreen(session)
  })
}
