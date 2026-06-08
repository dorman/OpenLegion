import * as pty from "@lydell/node-pty"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"

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

export function createContainerPty(input: {
  command: string
  cols: number
  rows: number
  onData: (data: string) => void
  onExit: (code: number) => void
}) {
  const parsed = parseContainerExec(input.command)
  if (!parsed) throw new Error("Unsupported container shell command")

  const id = randomUUID()
  const proc = pty.spawn(parsed.runtime, ["exec", "-i", "-t", parsed.containerId, ...parsed.shell], {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: homedir(),
    env: process.env,
  })

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
