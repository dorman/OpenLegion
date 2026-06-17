import { afterAll, describe, expect, test } from "bun:test"
import { captureCdpScreenshot, CdpError, performCdpActions } from "@/container/cdp"
import { encodePng } from "@/container/vnc"

// ---------------------------------------------------------------------------
// Mock CDP endpoint over a websocket: parses {id,method,params} commands and
// replies {id,result}, recording every command so tests can assert the wire
// behaviour. Page.captureScreenshot returns a known 4x2 PNG.
// ---------------------------------------------------------------------------

const WIDTH = 4
const HEIGHT = 2

function knownPng() {
  return encodePng(WIDTH, HEIGHT, Buffer.alloc(WIDTH * HEIGHT * 4, 255))
}

type Recorded = { method: string; params: Record<string, unknown> }

const servers: { stop: () => void }[] = []

function startServer(viewport?: { width: number; height: number }) {
  const calls: Recorded[] = []
  const png = knownPng().toString("base64")
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      if (srv.upgrade(request)) return undefined
      return new Response("expected websocket", { status: 400 })
    },
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"))
        calls.push({ method: msg.method, params: msg.params })
        let result: Record<string, unknown> = {}
        if (msg.method === "Page.captureScreenshot") result = { data: png }
        else if (msg.method === "Page.getLayoutMetrics") {
          result = { cssVisualViewport: { clientWidth: viewport?.width ?? WIDTH, clientHeight: viewport?.height ?? HEIGHT } }
        }
        ws.send(JSON.stringify({ id: msg.id, result }))
      },
    },
  })
  servers.push(server)
  return { url: `ws://127.0.0.1:${server.port}`, calls }
}

afterAll(() => {
  for (const server of servers) server.stop()
})

describe("captureCdpScreenshot", () => {
  test("decodes the screenshot and its dimensions", async () => {
    const { url, calls } = startServer()
    const shot = await captureCdpScreenshot({ url })
    expect(shot.width).toBe(WIDTH)
    expect(shot.height).toBe(HEIGHT)
    expect(shot.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(calls.map((c) => c.method)).toContain("Page.enable")
    expect(calls.map((c) => c.method)).toContain("Page.captureScreenshot")
  })

  test("rejects with CdpError when the endpoint is unreachable", async () => {
    await expect(captureCdpScreenshot({ url: "ws://127.0.0.1:1", timeoutMs: 1000 })).rejects.toBeInstanceOf(CdpError)
  })

  test("rejects with CdpError when no screenshot data is returned", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request, srv) {
        if (srv.upgrade(request)) return undefined
        return new Response("expected websocket", { status: 400 })
      },
      websocket: {
        message(ws, raw) {
          const msg = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"))
          ws.send(JSON.stringify({ id: msg.id, result: {} }))
        },
      },
    })
    servers.push(server)
    await expect(captureCdpScreenshot({ url: `ws://127.0.0.1:${server.port}` })).rejects.toBeInstanceOf(CdpError)
  })
})

describe("performCdpActions", () => {
  const inputCalls = (calls: Recorded[], method: string) => calls.filter((c) => c.method === method)

  test("a click dispatches press then release and returns a screenshot", async () => {
    const { url, calls } = startServer()
    const shot = await performCdpActions({ url, settleMs: 0, actions: [{ action: "click", x: 2, y: 1 }] })
    expect(shot.width).toBe(WIDTH)

    const mouse = inputCalls(calls, "Input.dispatchMouseEvent")
    const types = mouse.map((c) => c.params.type)
    expect(types).toContain("mousePressed")
    expect(types).toContain("mouseReleased")
    const pressed = mouse.find((c) => c.params.type === "mousePressed")!
    expect(pressed.params.x).toBe(2)
    expect(pressed.params.y).toBe(1)
    expect(pressed.params.button).toBe("left")
  })

  test("typing text uses Input.insertText", async () => {
    const { url, calls } = startServer()
    await performCdpActions({ url, settleMs: 0, actions: [{ action: "type", text: "hi" }] })
    const inserts = inputCalls(calls, "Input.insertText")
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.params.text).toBe("hi")
  })

  test("a ctrl+c combo holds the modifier and emits no text", async () => {
    const { url, calls } = startServer()
    await performCdpActions({ url, settleMs: 0, actions: [{ action: "key", key: "ctrl+c" }] })
    const keys = inputCalls(calls, "Input.dispatchKeyEvent")
    // Control keydown carries the Control modifier bit (2)...
    const control = keys.find((c) => c.params.key === "Control")
    expect(control?.params.modifiers).toBe(2)
    // ...and the "c" keydown is a rawKeyDown (no text) while ctrl is held.
    const cDown = keys.find((c) => c.params.key === "c" && c.params.type === "rawKeyDown")
    expect(cDown).toBeDefined()
    expect(cDown!.params.text).toBeUndefined()
    expect(cDown!.params.modifiers).toBe(2)
  })

  test("clamps coordinates to the reported viewport", async () => {
    const { url, calls } = startServer({ width: 10, height: 10 })
    await performCdpActions({ url, settleMs: 0, actions: [{ action: "move", x: 999, y: 999 }] })
    const move = inputCalls(calls, "Input.dispatchMouseEvent").find((c) => c.params.type === "mouseMoved")!
    expect(move.params.x).toBe(9)
    expect(move.params.y).toBe(9)
  })
})
