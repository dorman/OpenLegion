import { afterAll, describe, expect, test } from "bun:test"
import { inflateSync } from "node:zlib"
import { captureVncScreenshot, desEncryptBlock, encodePng, vncAuthResponse, VncError } from "@/container/vnc"

// ---------------------------------------------------------------------------
// Mock RFB 3.8 server over websocket. Serves a 4x2 framebuffer: top row red,
// bottom row blue, in the little-endian r16/g8/b0 pixel format the client
// requests (bytes per pixel: B, G, R, X).
// ---------------------------------------------------------------------------

const WIDTH = 4
const HEIGHT = 2
const PASSWORD = "secret"

type Mode = "none" | "vnc-auth" | "refuse"

function rawFramebuffer() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4)
  for (let x = 0; x < WIDTH; x++) {
    data[x * 4 + 2] = 255 // top row: red channel at byte 2
    const bottom = (WIDTH + x) * 4
    data[bottom] = 255 // bottom row: blue channel at byte 0
  }
  return data
}

function serverInitMessage() {
  const init = Buffer.alloc(24 + 4)
  init.writeUInt16BE(WIDTH, 0)
  init.writeUInt16BE(HEIGHT, 2)
  init.writeUInt32BE(4, 20)
  init.write("mock", 24, "latin1")
  return init
}

function frameUpdateMessage() {
  const head = Buffer.alloc(4 + 12)
  head[0] = 0
  head.writeUInt16BE(1, 2) // one rectangle
  head.writeUInt16BE(WIDTH, 4 + 4)
  head.writeUInt16BE(HEIGHT, 4 + 6)
  head.writeInt32BE(0, 4 + 8) // raw encoding
  return Buffer.concat([head, rawFramebuffer()])
}

type State = { phase: string; received: Buffer; challenge: Buffer }

function startServer(mode: Mode) {
  const states = new WeakMap<object, State>()
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      if (srv.upgrade(request)) return undefined
      return new Response("expected websocket", { status: 400 })
    },
    websocket: {
      open(ws) {
        states.set(ws, { phase: "version", received: Buffer.alloc(0), challenge: Buffer.alloc(16, 7) })
        ws.send(Buffer.from("RFB 003.008\n", "latin1"))
      },
      message(ws, raw) {
        const state = states.get(ws)!
        const incoming = typeof raw === "string" ? Buffer.from(raw, "latin1") : Buffer.from(raw)
        state.received = Buffer.concat([state.received, incoming])

        const take = (n: number) => {
          if (state.received.length < n) return undefined
          const out = state.received.subarray(0, n)
          state.received = state.received.subarray(n)
          return out
        }

        for (;;) {
          if (state.phase === "version") {
            const version = take(12)
            if (!version) return
            if (mode === "refuse") {
              const reason = Buffer.from("maintenance", "latin1")
              const msg = Buffer.alloc(5 + reason.length)
              msg[0] = 0 // zero security types
              msg.writeUInt32BE(reason.length, 1)
              reason.copy(msg, 5)
              ws.send(msg)
              state.phase = "done"
              return
            }
            ws.send(Buffer.from([1, mode === "vnc-auth" ? 2 : 1]))
            state.phase = "security"
          } else if (state.phase === "security") {
            const choice = take(1)
            if (!choice) return
            if (mode === "vnc-auth") {
              if (choice[0] !== 2) throw new Error(`client chose ${choice[0]}`)
              ws.send(state.challenge)
              state.phase = "auth"
            } else {
              if (choice[0] !== 1) throw new Error(`client chose ${choice[0]}`)
              ws.send(Buffer.from([0, 0, 0, 0])) // SecurityResult ok
              state.phase = "client-init"
            }
          } else if (state.phase === "auth") {
            const response = take(16)
            if (!response) return
            const expected = vncAuthResponse(PASSWORD, state.challenge)
            if (!response.equals(expected)) {
              const reason = Buffer.from("bad password", "latin1")
              const msg = Buffer.alloc(8 + reason.length)
              msg.writeUInt32BE(1, 0)
              msg.writeUInt32BE(reason.length, 4)
              reason.copy(msg, 8)
              ws.send(msg)
              state.phase = "done"
              return
            }
            ws.send(Buffer.from([0, 0, 0, 0]))
            state.phase = "client-init"
          } else if (state.phase === "client-init") {
            const init = take(1)
            if (!init) return
            ws.send(serverInitMessage())
            state.phase = "setup"
          } else if (state.phase === "setup") {
            // SetPixelFormat (20) + SetEncodings (8) + FramebufferUpdateRequest (10)
            const setup = take(38)
            if (!setup) return
            ws.send(Buffer.from([2])) // a Bell first: client must skip it
            ws.send(frameUpdateMessage())
            state.phase = "done"
          } else {
            return
          }
        }
      },
    },
  })
  return server
}

const servers: ReturnType<typeof startServer>[] = []
const serve = (mode: Mode) => {
  const server = startServer(mode)
  servers.push(server)
  return `ws://127.0.0.1:${server.port}/`
}

afterAll(() => {
  for (const server of servers) server.stop(true)
})

function decodePixels(png: Buffer) {
  // Parse our own encoder's layout: IHDR at 8, IDAT data begins at 8+25+8.
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  const idatLength = png.readUInt32BE(33)
  const idat = png.subarray(41, 41 + idatLength)
  const raw = inflateSync(idat)
  const stride = width * 4 + 1
  const pixels: number[][] = []
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0)
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * 4
      pixels.push([raw[at]!, raw[at + 1]!, raw[at + 2]!, raw[at + 3]!])
    }
  }
  return { width, height, pixels }
}

describe("container.vnc", () => {
  test("DES matches the canonical zero vector and Bun's crypto", () => {
    const zero = desEncryptBlock(Buffer.alloc(8), Buffer.alloc(8))
    expect(zero.toString("hex")).toBe("8ca64de9c1b123a7")

    const { createCipheriv } = require("node:crypto") as typeof import("node:crypto")
    const key = Buffer.from("0123456789abcdef", "hex")
    const block = Buffer.from("fedcba9876543210", "hex")
    const cipher = createCipheriv("des-ecb", key, null)
    cipher.setAutoPadding(false)
    expect(desEncryptBlock(key, block).toString("hex")).toBe(cipher.update(block).toString("hex"))
  })

  test("captures a framebuffer without auth", async () => {
    const shot = await captureVncScreenshot({ url: serve("none"), timeoutMs: 5000 })
    expect(shot.width).toBe(WIDTH)
    expect(shot.height).toBe(HEIGHT)

    const { width, height, pixels } = decodePixels(shot.png)
    expect(width).toBe(WIDTH)
    expect(height).toBe(HEIGHT)
    expect(pixels[0]).toEqual([255, 0, 0, 255]) // top row red
    expect(pixels[WIDTH]).toEqual([0, 0, 255, 255]) // bottom row blue
  })

  test("captures a framebuffer with VNC authentication", async () => {
    const shot = await captureVncScreenshot({ url: serve("vnc-auth"), password: PASSWORD, timeoutMs: 5000 })
    expect(shot.width).toBe(WIDTH)
    expect(decodePixels(shot.png).pixels[0]).toEqual([255, 0, 0, 255])
  })

  test("fails clearly on a wrong password", async () => {
    await expect(
      captureVncScreenshot({ url: serve("vnc-auth"), password: "wrong", timeoutMs: 5000 }),
    ).rejects.toThrow("bad password")
  })

  test("fails clearly when auth is required but missing", async () => {
    await expect(captureVncScreenshot({ url: serve("vnc-auth"), timeoutMs: 5000 })).rejects.toThrow(
      /requires a password/,
    )
  })

  test("surfaces server refusals", async () => {
    await expect(captureVncScreenshot({ url: serve("refuse"), timeoutMs: 5000 })).rejects.toThrow(/maintenance/)
  })

  test("times out instead of hanging", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request, srv) {
        if (srv.upgrade(request)) return undefined
        return new Response("", { status: 400 })
      },
      websocket: { open() {}, message() {} }, // never speaks RFB
    })
    servers.push(server)
    await expect(
      captureVncScreenshot({ url: `ws://127.0.0.1:${server.port}/`, timeoutMs: 300 }),
    ).rejects.toBeInstanceOf(VncError)
  })

  test("encodePng round-trips pixel data", () => {
    const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
    const { width, height, pixels } = decodePixels(encodePng(2, 1, rgba))
    expect(width).toBe(2)
    expect(height).toBe(1)
    expect(pixels).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
  })
})
