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
  // `docker info` exits non-zero when the daemon is unreachable, so it reflects
  // whether containers can actually run — unlike `docker --version`, which only
  // checks that the CLI is installed and would report Ready while the daemon
  // (Docker Desktop / colima) is stopped.
  return new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["info"], { stdio: "ignore", env: daemonEnv() })
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

  // Reclaim the port before spawning. We only reach here when health isn't
  // ok+supported, so anything still bound to it is stale — either a daemon we
  // spawned earlier or an orphan left by a previous app session whose /health
  // is failing (e.g. Docker is down). Leaving it bound makes the spawn below
  // die with "address already in use" and surface as "did not become healthy".
  await restartStaleDaemon(url)

  const command = await daemonCommand()
  if (!command) return { ok: false as const, url, error: "microvm daemon binary is not configured" }

  const root = await repoRoot()
  const logPath = microvmLogPath()
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

// ---------------------------------------------------------------------------
// Self-healing guardrail
//
// When the local sandbox daemon goes offline while the app is running, the app
// should recover on its own rather than make the user diagnose it. The pieces
// below codify a fixed troubleshooting playbook (recoverMicrovmDaemon) and a
// background watcher (startMicrovmDaemonMonitor) that runs it automatically.
// ---------------------------------------------------------------------------

export type MicrovmRecoveryStep = { step: string; ok: boolean; detail?: string }

export type MicrovmDaemonRecoveryResult = {
  ok: boolean
  url: string
  steps: MicrovmRecoveryStep[]
  error?: string
}

export type MicrovmDaemonStatus = {
  state: "healthy" | "offline" | "recovering" | "recovered" | "unrecoverable"
  url: string
  error?: string
  steps?: MicrovmRecoveryStep[]
}

function microvmLogPath() {
  return join(homedir(), ".openlegion", "logs", "microvm-daemon.log")
}

async function logRecovery(message: string) {
  try {
    const path = microvmLogPath()
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${new Date().toISOString()} [recovery] ${message}\n`)
  } catch {
    // Logging is best-effort; never let it break recovery.
  }
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: daemonEnv(), timeout: timeoutMs }, (error) => resolve(!error))
  })
}

async function commandExists(name: string): Promise<boolean> {
  return runCommand("which", [name], 4000)
}

async function waitForDocker(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await dockerAvailable()) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

// Best-effort attempt to bring up a local container runtime. Tries colima first
// (the engine this app expects on a dev box), then Docker Desktop on macOS.
// Only ever starts a runtime that is already installed.
async function tryStartContainerRuntime(): Promise<MicrovmRecoveryStep> {
  // Prefer colima when it's installed (the engine this app expects on a dev
  // box). Only fall back to Docker Desktop when colima isn't present, so a
  // colima user doesn't get Docker Desktop launched unexpectedly.
  if (await commandExists("colima")) {
    await logRecovery("container runtime down — starting colima")
    await runCommand("colima", ["start"], 180_000)
    if (await waitForDocker(20_000)) return { step: "container-runtime", ok: true, detail: "started colima" }
    return { step: "container-runtime", ok: false, detail: "colima did not become ready" }
  }
  if (process.platform === "darwin") {
    await logRecovery("container runtime down — launching Docker Desktop")
    await runCommand("open", ["-a", "Docker"], 10_000)
    if (await waitForDocker(60_000)) return { step: "container-runtime", ok: true, detail: "started Docker Desktop" }
  }
  return { step: "container-runtime", ok: false, detail: "no container runtime could be started automatically" }
}

let recovery: Promise<MicrovmDaemonRecoveryResult> | undefined

/**
 * Self-healing troubleshooting routine for the local sandbox daemon. Runs a
 * fixed, ordered playbook so the app can recover on its own when the daemon is
 * offline, instead of the user having to diagnose it:
 *   1. Re-probe health — bail early if it is actually fine.
 *   2. Ensure the container runtime (Docker) is reachable; start colima or
 *      Docker Desktop if it is not.
 *   3. Reclaim a stuck port / clear a dead daemon and (re)spawn it — delegated
 *      to ensureMicrovmDaemon, which already frees the port before spawning.
 *   4. Re-verify health. Every step is appended to the daemon log.
 * Remote daemons are never touched — their lifecycle is not ours to manage.
 * Concurrent callers (manual button + background monitor) share one run.
 */
export async function recoverMicrovmDaemon(): Promise<MicrovmDaemonRecoveryResult> {
  if (recovery) return recovery
  recovery = runRecovery().finally(() => {
    recovery = undefined
  })
  return recovery
}

async function runRecovery(): Promise<MicrovmDaemonRecoveryResult> {
  const { url, token, remote } = sandboxHost()
  const steps: MicrovmRecoveryStep[] = []
  const add = async (step: MicrovmRecoveryStep) => {
    steps.push(step)
    await logRecovery(`${step.step}: ${step.ok ? "ok" : "failed"}${step.detail ? ` — ${step.detail}` : ""}`)
  }

  const initial = await microvmHealth(url, token)
  if (initial.ok && initial.supported) {
    return { ok: true, url, steps: [{ step: "health", ok: true, detail: "already healthy" }] }
  }

  if (remote) {
    return {
      ok: false,
      url,
      steps,
      error: `remote sandbox daemon at ${url} is unreachable — start the daemon on that host`,
    }
  }

  await logRecovery("daemon offline — starting recovery")

  if (await dockerAvailable()) {
    await add({ step: "container-runtime", ok: true, detail: "docker reachable" })
  } else {
    await add(await tryStartContainerRuntime())
  }

  const ensured = await ensureMicrovmDaemon()
  await add({ step: "daemon", ok: ensured.ok, detail: ensured.ok ? ensured.url : ensured.error })

  if (ensured.ok) {
    await logRecovery("recovery succeeded")
    return { ok: true, url, steps }
  }
  await logRecovery("recovery failed")
  return { ok: false, url, steps, error: ensured.error ?? "sandbox daemon did not recover" }
}

let monitorTimer: ReturnType<typeof setInterval> | undefined

/**
 * Background guardrail: periodically probes the local daemon's health and, once
 * it has been offline for two consecutive checks, automatically runs
 * recoverMicrovmDaemon(). Debounces transient blips and backs off between
 * attempts so an unrecoverable cause does not spin the routine. State
 * transitions are reported through onStatus so the UI can react. Remote hosts
 * are ignored — the app does not manage their lifecycle.
 */
export function startMicrovmDaemonMonitor(opts?: {
  intervalMs?: number
  onStatus?: (status: MicrovmDaemonStatus) => void
}) {
  if (monitorTimer) return
  const interval = opts?.intervalMs ?? 30_000
  const backoffMs = 5 * 60_000
  let misses = 0
  let lastAttempt = 0
  let wasHealthy = false

  const tick = async () => {
    const { url, token, remote } = sandboxHost()
    if (remote) return

    const health = await microvmHealth(url, token)
    if (health.ok && health.supported) {
      misses = 0
      if (!wasHealthy) opts?.onStatus?.({ state: "healthy", url })
      wasHealthy = true
      return
    }

    misses++
    if (wasHealthy) opts?.onStatus?.({ state: "offline", url })
    wasHealthy = false

    // Require ~2 consecutive misses before acting, skip while a recovery is
    // already running, and honor the backoff window between attempts.
    if (misses < 2 || recovery) return
    if (Date.now() - lastAttempt < backoffMs) return
    lastAttempt = Date.now()

    opts?.onStatus?.({ state: "recovering", url })
    const result = await recoverMicrovmDaemon()
    if (result.ok) {
      misses = 0
      wasHealthy = true
      opts?.onStatus?.({ state: "recovered", url, steps: result.steps })
    } else {
      opts?.onStatus?.({ state: "unrecoverable", url, error: result.error, steps: result.steps })
    }
  }

  monitorTimer = setInterval(() => void tick(), interval)
}

export function stopMicrovmDaemonMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = undefined
  }
}
