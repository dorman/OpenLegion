import { access, appendFile, mkdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"
import { getUserShell, loadShellEnv } from "./shell-env"

export type ContainerRuntimeStatus = {
  docker: boolean
  microvm: boolean
  qemu: boolean
  microvmUrl: string
  microvmRemote: boolean
  arch: "arm64" | "x64"
}

const requiredMicrovmFeatures = ["logs", "shell", "display", "desktop-v2"]

let daemon: ReturnType<typeof spawn> | undefined

// Mirrors resolveSandboxHost() in packages/openlegion: env vars win, then
// ~/.openlegion/sandbox-host.json (written by the Settings UI), then loopback.
// A remote host is one the app cannot start/stop locally.
function sandboxHost(): { url: string; token?: string; remote: boolean } {
  const envUrl = process.env.OPENLEGION_MICROVM_URL?.trim()
  const envToken = process.env.OPENLEGION_MICROVM_TOKEN?.trim()
  let fileUrl: string | undefined
  let fileToken: string | undefined
  try {
    const parsed = JSON.parse(readFileSync(join(homedir(), ".openlegion", "sandbox-host.json"), "utf8")) as {
      url?: unknown
      token?: unknown
    }
    if (typeof parsed.url === "string" && parsed.url.trim()) fileUrl = parsed.url.trim()
    if (typeof parsed.token === "string" && parsed.token.trim()) fileToken = parsed.token.trim()
  } catch {
    // No config file — fall back to env vars / defaults.
  }
  const url = (envUrl || fileUrl || "http://127.0.0.1:7420").replace(/\/+$/, "")
  const token = envToken || fileToken
  return { url, token, remote: !isLoopbackUrl(url) }
}

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === "127.0.0.1" || host === "localhost" || host === "::1"
  } catch {
    return true
  }
}

async function microvmHealth(url: string, token?: string) {
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, { headers, signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { ok: false as const }
    const json = (await response.json()) as { ok?: boolean; features?: string[] }
    const features = json.features ?? []
    const supported = requiredMicrovmFeatures.every((feature) => features.includes(feature))
    return { ok: json.ok === true, supported }
  } catch {
    return { ok: false as const }
  }
}

async function dockerAvailable() {
  return new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["--version"], { stdio: "ignore", env: daemonEnv() })
    child.once("error", () => resolve(false))
    child.once("exit", (code) => resolve(code === 0))
  })
}

const qemuCandidates = [
  "/opt/homebrew/bin/qemu-system-aarch64",
  "/usr/local/bin/qemu-system-aarch64",
  "qemu-system-aarch64",
  "qemu-system-x86_64",
]

async function qemuAvailable() {
  const env = daemonEnv()
  for (const candidate of qemuCandidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(candidate, ["--version"], { stdio: "ignore", env })
      child.once("error", () => resolve(false))
      child.once("exit", (code) => resolve(code === 0))
    })
    if (ok) return true
  }
  return false
}

function daemonEnv() {
  const shell = getUserShell()
  const shellEnv = loadShellEnv(shell)
  if (!shellEnv) return process.env
  const path = [process.env.PATH, shellEnv.PATH].filter(Boolean).join(":")
  return { ...shellEnv, ...process.env, PATH: path }
}

export async function containerRuntimeStatus(): Promise<ContainerRuntimeStatus> {
  const { url, token, remote } = sandboxHost()
  const [docker, qemu, health] = await Promise.all([dockerAvailable(), qemuAvailable(), microvmHealth(url, token)])
  return {
    docker,
    qemu,
    microvm: health.ok === true && health.supported,
    microvmUrl: url,
    microvmRemote: remote,
    arch: process.arch === "arm64" ? "arm64" : "x64",
  }
}

async function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, "../../../..")
}

async function daemonCommand() {
  const binary = process.env.OPENLEGION_MICROVM_BIN
  if (binary) return { cmd: binary, args: [] as string[] }

  if (!app.isPackaged) {
    const root = await repoRoot()
    const main = join(root, "cmd/openlegion-microvm/main.go")
    if (await access(main).then(() => true).catch(() => false)) {
      return { cmd: "go", args: ["run", "./cmd/openlegion-microvm"] }
    }
  }

  return undefined
}

async function killPort(port: string) {
  await new Promise<void>((resolve) => {
    execFile("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve()
        return
      }
      for (const pid of stdout.trim().split("\n")) {
        const value = Number(pid)
        if (!Number.isFinite(value)) continue
        try {
          process.kill(value, "SIGTERM")
        } catch {}
      }
      resolve()
    })
  })
}

async function stopTrackedDaemon() {
  if (!daemon || daemon.killed) return
  daemon.kill()
  daemon = undefined
}

async function restartStaleDaemon(url: string) {
  const port = new URL(url).port || "7420"
  await stopTrackedDaemon()
  await killPort(port)
  await new Promise((resolve) => setTimeout(resolve, 300))
}

export async function ensureMicrovmDaemon() {
  const { url, token, remote } = sandboxHost()
  const health = await microvmHealth(url, token)
  if (health.ok && health.supported) return { ok: true as const, url }

  // A remote daemon's lifecycle is not ours to manage — never spawn a local one
  // to stand in for an unreachable host.
  if (remote) {
    return {
      ok: false as const,
      url,
      error: `remote sandbox daemon at ${url} is not reachable — start the daemon on that host`,
    }
  }

  if (health.ok && !health.supported) await restartStaleDaemon(url)

  if (daemon && !daemon.killed) {
    const current = await microvmHealth(url, token)
    if (current.ok && current.supported) return { ok: true as const, url }
    await restartStaleDaemon(url)
  }

  const command = await daemonCommand()
  if (!command) return { ok: false as const, url, error: "microvm daemon binary is not configured" }

  const root = await repoRoot()
  const logPath = join(homedir(), ".openlegion", "logs", "microvm-daemon.log")
  await mkdir(dirname(logPath), { recursive: true })
  // Pass the configured token through so a locally-spawned daemon enforces the
  // same bearer token the client will present.
  daemon = spawn(command.cmd, command.args, {
    cwd: root,
    env: { ...daemonEnv(), ...(token ? { OPENLEGION_MICROVM_TOKEN: token } : {}) },
    stdio: ["ignore", "ignore", "pipe"],
    detached: false,
  })
  let spawnError = ""
  daemon.stderr?.on("data", (chunk: Buffer) => {
    void appendFile(logPath, chunk)
  })
  daemon.on("error", (error) => {
    spawnError = error.message
  })

  for (let attempt = 0; attempt < 80; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const next = await microvmHealth(url, token)
    if (next.ok && next.supported) return { ok: true as const, url }
    if (daemon.exitCode !== null) break
  }

  if (spawnError) {
    return { ok: false as const, url, error: spawnError }
  }
  return { ok: false as const, url, error: `microvm daemon did not become healthy (see ${logPath})` }
}

export async function stopMicrovmDaemon() {
  await stopTrackedDaemon()
  const { url, remote } = sandboxHost()
  // Only a locally-run daemon has a port we can free; never touch a remote host.
  if (remote) return
  await killPort(new URL(url).port || "7420")
}
