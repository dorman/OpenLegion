import { deflateSync } from "node:zlib"

/**
 * Minimal RFB 3.x client for the VNC websocket the sandbox daemon exposes for
 * desktop VMs. Speaks only what screenshots and input need: None/VNC-auth
 * security, a 32bpp true-colour pixel format, Raw encoding, and
 * KeyEvent/PointerEvent messages.
 */

const DEFAULT_TIMEOUT_MS = 15_000
const SECURITY_NONE = 1
const SECURITY_VNC = 2
const ENCODING_RAW = 0

export class VncError extends Error {}

export type VncScreenshot = { width: number; height: number; png: Buffer }

// ---------------------------------------------------------------------------
// Byte stream over websocket messages: RFB frames arrive with arbitrary
// chunking, so reads await until enough bytes have accumulated.
// ---------------------------------------------------------------------------

class ByteStream {
  private chunks: Uint8Array[] = []
  private size = 0
  private waiter?: { n: number; resolve: (buf: Buffer) => void; reject: (err: Error) => void }
  private error?: Error

  push(data: Uint8Array) {
    if (this.error) return
    this.chunks.push(data)
    this.size += data.byteLength
    this.flush()
  }

  fail(error: Error) {
    if (this.error) return
    this.error = error
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.reject(error)
  }

  read(n: number): Promise<Buffer> {
    if (this.error) return Promise.reject(this.error)
    if (this.waiter) return Promise.reject(new VncError("concurrent read on RFB stream"))
    return new Promise((resolve, reject) => {
      this.waiter = { n, resolve, reject }
      this.flush()
    })
  }

  private flush() {
    const waiter = this.waiter
    if (!waiter || this.size < waiter.n) return
    const out = Buffer.alloc(waiter.n)
    let offset = 0
    while (offset < waiter.n) {
      const head = this.chunks[0]!
      const take = Math.min(head.byteLength, waiter.n - offset)
      out.set(head.subarray(0, take), offset)
      offset += take
      if (take === head.byteLength) this.chunks.shift()
      else this.chunks[0] = head.subarray(take)
    }
    this.size -= waiter.n
    this.waiter = undefined
    waiter.resolve(out)
  }
}

// ---------------------------------------------------------------------------
// DES, encrypt-only, for the VNC authentication challenge. Implemented in
// TypeScript because OpenSSL 3 (Node) refuses legacy DES; VNC auth is two
// 8-byte ECB blocks, so a bit-level textbook implementation is plenty.
// ---------------------------------------------------------------------------

// prettier-ignore
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7]
// prettier-ignore
const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25]
// prettier-ignore
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1]
// prettier-ignore
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25]
// prettier-ignore
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4]
// prettier-ignore
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32]
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
// prettier-ignore
const SBOXES = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
]

function bytesToBits(bytes: Uint8Array) {
  const bits: number[] = []
  for (const byte of bytes) {
    for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1)
  }
  return bits
}

function bitsToBytes(bits: number[]) {
  const out = Buffer.alloc(bits.length / 8)
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[i >> 3]! |= 1 << (7 - (i & 7))
  }
  return out
}

function permute(bits: number[], table: number[]) {
  return table.map((index) => bits[index - 1]!)
}

function rotateLeft(bits: number[], by: number) {
  return [...bits.slice(by), ...bits.slice(0, by)]
}

export function desEncryptBlock(key: Uint8Array, block: Uint8Array): Buffer {
  let c = permute(bytesToBits(key), PC1)
  let d = c.slice(28)
  c = c.slice(0, 28)
  const subkeys: number[][] = []
  for (const shift of SHIFTS) {
    c = rotateLeft(c, shift)
    d = rotateLeft(d, shift)
    subkeys.push(permute([...c, ...d], PC2))
  }

  const initial = permute(bytesToBits(block), IP)
  let left = initial.slice(0, 32)
  let right = initial.slice(32)
  for (const subkey of subkeys) {
    const expanded = permute(right, E).map((bit, i) => bit ^ subkey[i]!)
    const substituted: number[] = []
    for (let box = 0; box < 8; box++) {
      const offset = box * 6
      const row = expanded[offset]! * 2 + expanded[offset + 5]!
      const col =
        expanded[offset + 1]! * 8 + expanded[offset + 2]! * 4 + expanded[offset + 3]! * 2 + expanded[offset + 4]!
      const value = SBOXES[box]![row * 16 + col]!
      substituted.push((value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1)
    }
    const round = permute(substituted, P)
    const next = left.map((bit, i) => bit ^ round[i]!)
    left = right
    right = next
  }
  return bitsToBytes(permute([...right, ...left], FP))
}

function reverseBits(byte: number) {
  let out = 0
  for (let bit = 0; bit < 8; bit++) {
    if (byte & (1 << bit)) out |= 1 << (7 - bit)
  }
  return out
}

/** VNC auth: DES-encrypt the 16-byte challenge with the bit-reversed password as key. */
export function vncAuthResponse(password: string, challenge: Buffer): Buffer {
  const key = Buffer.alloc(8)
  const bytes = Buffer.from(password, "latin1")
  for (let i = 0; i < 8; i++) key[i] = reverseBits(bytes[i] ?? 0)
  return Buffer.concat([desEncryptBlock(key, challenge.subarray(0, 8)), desEncryptBlock(key, challenge.subarray(8, 16))])
}

// ---------------------------------------------------------------------------
// PNG encoding (RGBA, no filtering) via zlib.
// ---------------------------------------------------------------------------

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(...buffers: Buffer[]) {
  let crc = 0xffffffff
  for (const buf of buffers) {
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeBuf, data), 0)
  return Buffer.concat([head, typeBuf, data, crc])
}

export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// RFB protocol
// ---------------------------------------------------------------------------

type Send = (data: Buffer) => void

async function readReason(stream: ByteStream) {
  const length = (await stream.read(4)).readUInt32BE(0)
  return (await stream.read(Math.min(length, 1024))).toString("latin1")
}

async function negotiateSecurity(stream: ByteStream, send: Send, password?: string) {
  const versionLine = (await stream.read(12)).toString("latin1")
  const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(versionLine)
  if (!match) throw new VncError(`not an RFB server (got ${JSON.stringify(versionLine)})`)
  const minor = Number(match[2])
  const version = Number(match[1]) > 3 || minor >= 8 ? 8 : minor >= 7 ? 7 : 3
  send(Buffer.from(`RFB 003.00${version}\n`, "latin1"))

  let security: number
  if (version === 3) {
    security = (await stream.read(4)).readUInt32BE(0)
    if (security === 0) throw new VncError(`server refused connection: ${await readReason(stream)}`)
  } else {
    const count = (await stream.read(1))[0]!
    if (count === 0) throw new VncError(`server refused connection: ${await readReason(stream)}`)
    const offered = await stream.read(count)
    if (offered.includes(SECURITY_NONE)) security = SECURITY_NONE
    else if (offered.includes(SECURITY_VNC)) security = SECURITY_VNC
    else throw new VncError(`no supported security type (server offered ${Array.from(offered).join(", ")})`)
    send(Buffer.from([security]))
  }

  if (security === SECURITY_VNC) {
    if (!password) throw new VncError("the display requires a password but none was provided")
    const challenge = await stream.read(16)
    send(vncAuthResponse(password, challenge))
  } else if (security !== SECURITY_NONE) {
    throw new VncError(`unsupported security type ${security}`)
  }

  // 3.8 always sends a SecurityResult; 3.3/3.7 only after VNC auth.
  if (version === 8 || security === SECURITY_VNC) {
    const result = (await stream.read(4)).readUInt32BE(0)
    if (result !== 0) {
      const reason = version === 8 ? await readReason(stream).catch(() => "authentication failed") : "authentication failed"
      throw new VncError(reason)
    }
  }
}

function clientSetup(send: Send, width: number, height: number) {
  // SetPixelFormat: 32bpp depth-24 true colour, little endian, shifts r16 g8 b0.
  const setPixelFormat = Buffer.alloc(20)
  setPixelFormat[0] = 0
  setPixelFormat[4] = 32
  setPixelFormat[5] = 24
  setPixelFormat[6] = 0
  setPixelFormat[7] = 1
  setPixelFormat.writeUInt16BE(255, 8)
  setPixelFormat.writeUInt16BE(255, 10)
  setPixelFormat.writeUInt16BE(255, 12)
  setPixelFormat[14] = 16
  setPixelFormat[15] = 8
  setPixelFormat[16] = 0
  send(setPixelFormat)

  const setEncodings = Buffer.alloc(8)
  setEncodings[0] = 2
  setEncodings.writeUInt16BE(1, 2)
  setEncodings.writeInt32BE(ENCODING_RAW, 4)
  send(setEncodings)

  const updateRequest = Buffer.alloc(10)
  updateRequest[0] = 3
  updateRequest[1] = 0 // non-incremental: full framebuffer
  updateRequest.writeUInt16BE(width, 6)
  updateRequest.writeUInt16BE(height, 8)
  send(updateRequest)
}

function blitRaw(fb: Buffer, fbWidth: number, fbHeight: number, x: number, y: number, w: number, h: number, data: Buffer) {
  for (let row = 0; row < h; row++) {
    const ty = y + row
    if (ty < 0 || ty >= fbHeight) continue
    const copyWidth = Math.min(w, fbWidth - x)
    for (let col = 0; col < copyWidth; col++) {
      const src = (row * w + col) * 4
      const dst = (ty * fbWidth + x + col) * 4
      fb[dst] = data[src + 2]! // red (shift 16, little endian)
      fb[dst + 1] = data[src + 1]!
      fb[dst + 2] = data[src]!
      fb[dst + 3] = 255
    }
  }
}

type VncConnection = { stream: ByteStream; send: Send; width: number; height: number }

async function handshake(stream: ByteStream, send: Send, password?: string): Promise<VncConnection> {
  await negotiateSecurity(stream, send, password)

  send(Buffer.from([1])) // ClientInit: shared
  const serverInit = await stream.read(24)
  const width = serverInit.readUInt16BE(0)
  const height = serverInit.readUInt16BE(2)
  const nameLength = serverInit.readUInt32BE(20)
  if (nameLength > 0) await stream.read(nameLength)
  if (width === 0 || height === 0) throw new VncError("server reported an empty framebuffer")
  return { stream, send, width, height }
}

async function captureScreen({ stream, send, width, height }: VncConnection): Promise<VncScreenshot> {
  clientSetup(send, width, height)

  const fb = Buffer.alloc(width * height * 4)
  for (;;) {
    const messageType = (await stream.read(1))[0]!
    if (messageType === 0) {
      // FramebufferUpdate: a non-incremental request yields the whole screen
      // in one update message (possibly as several rectangles).
      await stream.read(1)
      const rectangles = (await stream.read(2)).readUInt16BE(0)
      for (let i = 0; i < rectangles; i++) {
        const head = await stream.read(12)
        const x = head.readUInt16BE(0)
        const y = head.readUInt16BE(2)
        const w = head.readUInt16BE(4)
        const h = head.readUInt16BE(6)
        const encoding = head.readInt32BE(8)
        if (encoding !== ENCODING_RAW) throw new VncError(`server used unsupported encoding ${encoding}`)
        const data = await stream.read(w * h * 4)
        blitRaw(fb, width, height, x, y, w, h, data)
      }
      return { width, height, png: encodePng(width, height, fb) }
    }
    if (messageType === 1) {
      // SetColourMapEntries
      const head = await stream.read(5)
      await stream.read(head.readUInt16BE(3) * 6)
    } else if (messageType === 2) {
      // Bell: no payload
    } else if (messageType === 3) {
      // ServerCutText
      const head = await stream.read(7)
      await stream.read(head.readUInt32BE(3))
    } else {
      throw new VncError(`unexpected server message ${messageType}`)
    }
  }
}

function withVncSession<T>(
  input: { url: string; password?: string; timeoutMs?: number },
  run: (conn: VncConnection) => Promise<T>,
): Promise<T> {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket
  if (!WebSocketCtor) {
    return Promise.reject(new VncError("WebSocket is not available in this runtime"))
  }

  return new Promise((resolve, reject) => {
    const stream = new ByteStream()
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let socket: WebSocket
    try {
      socket = new WebSocketCtor(input.url)
    } catch (err) {
      reject(new VncError(`failed to connect to display: ${err instanceof Error ? err.message : String(err)}`))
      return
    }
    socket.binaryType = "arraybuffer"

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
      const error = new VncError(`the display session timed out after ${timeoutMs}ms`)
      stream.fail(error)
      finish({ ok: false, error })
    }, timeoutMs)

    socket.onmessage = (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | Uint8Array
      stream.push(data instanceof Uint8Array ? data : new Uint8Array(data))
    }
    socket.onerror = () => stream.fail(new VncError("websocket connection to the display failed"))
    socket.onclose = () => stream.fail(new VncError("the display connection closed unexpectedly"))

    handshake(stream, (data) => socket.send(data), input.password)
      .then(run)
      .then(
        (value) => finish({ ok: true, value }),
        (error) => finish({ ok: false, error: error instanceof Error ? error : new Error(String(error)) }),
      )
  })
}

export function captureVncScreenshot(input: {
  url: string
  password?: string
  timeoutMs?: number
}): Promise<VncScreenshot> {
  return withVncSession(input, captureScreen)
}

// ---------------------------------------------------------------------------
// Input: KeyEvent / PointerEvent messages and high-level actions.
// ---------------------------------------------------------------------------

export type VncInputAction =
  | { action: "type"; text: string }
  | { action: "key"; key: string }
  | { action: "click" | "double_click"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { action: "move"; x: number; y: number }
  | { action: "scroll"; x: number; y: number; direction: "up" | "down"; amount?: number }
  | { action: "wait"; ms: number }

const KEYSTROKE_DELAY_MS = 12
const ACTION_DELAY_MS = 50
const DOUBLE_CLICK_GAP_MS = 80
const SETTLE_BEFORE_SCREENSHOT_MS = 1_000
const MAX_WAIT_MS = 10_000
const MAX_SCROLL_TICKS = 10

const BUTTON_MASKS = { left: 1, middle: 2, right: 4 } as const
const SCROLL_MASKS = { up: 8, down: 16 } as const

// X11 keysyms. Characters map to their codepoint (Latin-1) or the Unicode
// keysym range; everything else needs a name from this table.
const MODIFIER_KEYSYMS: Record<string, number> = {
  ctrl: 0xffe3,
  control: 0xffe3,
  shift: 0xffe1,
  alt: 0xffe9,
  option: 0xffe9,
  altgr: 0xffea,
  meta: 0xffeb,
  super: 0xffeb,
  win: 0xffeb,
  cmd: 0xffeb,
}

const NAMED_KEYSYMS: Record<string, number> = {
  enter: 0xff0d,
  return: 0xff0d,
  esc: 0xff1b,
  escape: 0xff1b,
  backspace: 0xff08,
  tab: 0xff09,
  space: 0x20,
  delete: 0xffff,
  del: 0xffff,
  insert: 0xff63,
  home: 0xff50,
  end: 0xff57,
  pageup: 0xff55,
  pagedown: 0xff56,
  up: 0xff52,
  down: 0xff54,
  left: 0xff51,
  right: 0xff53,
  printscreen: 0xff61,
  menu: 0xff67,
  plus: 0x2b,
  minus: 0x2d,
}
for (let i = 1; i <= 12; i++) NAMED_KEYSYMS[`f${i}`] = 0xffbe + i - 1

function charKeysym(char: string): number {
  const codepoint = char.codePointAt(0)!
  if (codepoint === 0x0a) return NAMED_KEYSYMS.return!
  if (codepoint === 0x09) return NAMED_KEYSYMS.tab!
  if (codepoint <= 0xff) return codepoint
  return 0x01000000 + codepoint // RFB carries other Unicode at this offset
}

function resolveKeysym(token: string): number {
  const named = MODIFIER_KEYSYMS[token.toLowerCase()] ?? NAMED_KEYSYMS[token.toLowerCase()]
  if (named !== undefined) return named
  if ([...token].length === 1) return charKeysym(token)
  throw new VncError(`unknown key "${token}"`)
}

/** Parse a key combo like "ctrl+alt+t" into modifier keysyms plus the key itself. */
export function parseKeyCombo(combo: string): { modifiers: number[]; key: number } {
  const trimmed = combo.trim()
  if (trimmed === "") throw new VncError("empty key")
  if ([...trimmed].length === 1) return { modifiers: [], key: charKeysym(trimmed) }
  const tokens = trimmed.split("+").map((token) => token.trim())
  // a trailing empty token means a literal "+" was the key, e.g. "ctrl++"
  const key = tokens.pop()!
  const keysym = key === "" ? charKeysym("+") : resolveKeysym(key)
  const modifiers = tokens
    .filter((token) => token !== "")
    .map((token) => {
      const modifier = MODIFIER_KEYSYMS[token.toLowerCase()]
      if (modifier === undefined) throw new VncError(`"${token}" is not a modifier key (use ctrl, shift, alt, or super)`)
      return modifier
    })
  return { modifiers, key: keysym }
}

function keyEvent(send: Send, keysym: number, down: boolean) {
  const msg = Buffer.alloc(8)
  msg[0] = 4
  msg[1] = down ? 1 : 0
  msg.writeUInt32BE(keysym >>> 0, 4)
  send(msg)
}

function pointerEvent(send: Send, mask: number, x: number, y: number) {
  const msg = Buffer.alloc(6)
  msg[0] = 5
  msg[1] = mask
  msg.writeUInt16BE(x, 2)
  msg.writeUInt16BE(y, 4)
  send(msg)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function tapKey(send: Send, keysym: number) {
  keyEvent(send, keysym, true)
  keyEvent(send, keysym, false)
}

async function performAction(conn: VncConnection, action: VncInputAction) {
  const { send, width, height } = conn
  const clampX = (x: number) => Math.max(0, Math.min(Math.round(x), width - 1))
  const clampY = (y: number) => Math.max(0, Math.min(Math.round(y), height - 1))

  switch (action.action) {
    case "type": {
      for (const char of action.text) {
        const codepoint = char.codePointAt(0)!
        if (codepoint < 0x20 && codepoint !== 0x0a && codepoint !== 0x09) continue
        await tapKey(send, charKeysym(char))
        await sleep(KEYSTROKE_DELAY_MS)
      }
      return
    }
    case "key": {
      const { modifiers, key } = parseKeyCombo(action.key)
      for (const modifier of modifiers) keyEvent(send, modifier, true)
      await tapKey(send, key)
      for (const modifier of [...modifiers].reverse()) keyEvent(send, modifier, false)
      return
    }
    case "click":
    case "double_click": {
      const x = clampX(action.x)
      const y = clampY(action.y)
      const mask = BUTTON_MASKS[action.button ?? "left"]
      const clicks = action.action === "double_click" ? 2 : 1
      pointerEvent(send, 0, x, y)
      for (let i = 0; i < clicks; i++) {
        if (i > 0) await sleep(DOUBLE_CLICK_GAP_MS)
        pointerEvent(send, mask, x, y)
        pointerEvent(send, 0, x, y)
      }
      return
    }
    case "move": {
      pointerEvent(send, 0, clampX(action.x), clampY(action.y))
      return
    }
    case "scroll": {
      const x = clampX(action.x)
      const y = clampY(action.y)
      const mask = SCROLL_MASKS[action.direction]
      const ticks = Math.max(1, Math.min(Math.round(action.amount ?? 3), MAX_SCROLL_TICKS))
      pointerEvent(send, 0, x, y)
      for (let i = 0; i < ticks; i++) {
        pointerEvent(send, mask, x, y)
        pointerEvent(send, 0, x, y)
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

function estimateActionsMs(actions: readonly VncInputAction[]) {
  let total = SETTLE_BEFORE_SCREENSHOT_MS
  for (const action of actions) {
    total += 500
    if (action.action === "type") total += action.text.length * KEYSTROKE_DELAY_MS * 2
    if (action.action === "wait") total += Math.min(action.ms, MAX_WAIT_MS)
  }
  return total
}

/**
 * Perform a sequence of input actions over one RFB connection, then capture a
 * screenshot of the resulting screen after a short settle delay.
 */
export function performVncActions(input: {
  url: string
  password?: string
  actions: readonly VncInputAction[]
  timeoutMs?: number
  settleMs?: number
}): Promise<VncScreenshot> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS + estimateActionsMs(input.actions)
  return withVncSession({ url: input.url, password: input.password, timeoutMs }, async (conn) => {
    for (const action of input.actions) {
      await performAction(conn, action)
      await sleep(ACTION_DELAY_MS)
    }
    await sleep(input.settleMs ?? SETTLE_BEFORE_SCREENSHOT_MS)
    return captureScreen(conn)
  })
}
