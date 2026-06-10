import * as pty from "@lydell/node-pty"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { write as writeLog } from "./logging"

type Session = {
  proc: pty.IPty
}

const sessions = new Map<string, Session>()

export function parseContainerExec(command: string) {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 4) return
  const runtime = tokens[0]
  if (runtime !== "docker" && runtime !== "podman") return
  if (tokens[1] !== "exec") return

  let index = 2
  while (index < tokens.length && tokens[index].startsWith("-")) index++

  const containerId = tokens[index]
  const shell = tokens.slice(index + 1)
  if (!containerId || shell.length === 0) return

  return { runtime, containerId, shell }
}

function unquoteShellArg(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

export function parseSerialConsoleCommand(command: string) {
  const trimmed = command.trim()

  const socatMatch = trimmed.match(/^socat\s+STDIO,raw,echo=0\s+UNIX-CONNECT:(.+)$/)
  if (socatMatch) {
    const socket = unquoteShellArg(socatMatch[1]!)
    if (!socket) return
    return { runtime: "socat", args: ["STDIO,raw,echo=0", `UNIX-CONNECT:${socket}`] }
  }

  const ncMatch = trimmed.match(/^nc\s+-U\s+(.+)$/)
  if (ncMatch) {
    const socket = unquoteShellArg(ncMatch[1]!)
    if (!socket) return
    return { runtime: "nc", args: ["-U", socket] }
  }
}

function ptyOptions(input: { cols: number; rows: number }) {
  return {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: homedir(),
    env: process.env,
  }
}

export function createContainerPty(input: {
  command: string
  cols: number
  rows: number
  onData: (data: string) => void
  onExit: (code: number) => void
}) {
  const parsed = parseContainerExec(input.command)
  const serial = parsed ? undefined : parseSerialConsoleCommand(input.command)
  if (!parsed && !serial) throw new Error("Unsupported container shell command")

  const id = randomUUID()
  const mode = parsed ? "container-exec" : "serial-console"
  writeLog("pty", "spawning session", {
    id,
    mode,
    runtime: parsed?.runtime ?? serial?.runtime,
    containerId: parsed?.containerId,
    command: input.command,
  })
  const proc = parsed
    ? pty.spawn(parsed.runtime, ["exec", "-i", "-t", parsed.containerId, ...parsed.shell], ptyOptions(input))
    : pty.spawn(serial!.runtime, serial!.args, ptyOptions(input))

  sessions.set(id, { proc })
  proc.onData(input.onData)
  proc.onExit(({ exitCode }) => {
    sessions.delete(id)
    input.onExit(exitCode ?? 0)
  })

  return id
}

export function writeContainerPty(id: string, data: string) {
  sessions.get(id)?.proc.write(data)
}

export function resizeContainerPty(id: string, cols: number, rows: number) {
  sessions.get(id)?.proc.resize(cols, rows)
}

export function closeContainerPty(id: string) {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.proc.kill()
}

export function closeAllContainerPtys() {
  for (const id of [...sessions.keys()]) closeContainerPty(id)
}
