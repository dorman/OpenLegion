import { execFile } from "node:child_process"
import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"

export type ContainerRuntimeStatus = {
  docker: boolean
  microvm: boolean
  microvmUrl: string
}

const requiredMicrovmFeatures = ["logs", "shell"]

let daemon: ReturnType<typeof spawn> | undefined

function microvmUrl() {
  return process.env.OPENLEGION_MICROVM_URL ?? "http://127.0.0.1:7420"
}

async function microvmHealth(url: string) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500) })
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
    const child = spawn("docker", ["--version"], { stdio: "ignore" })
    child.once("error", () => resolve(false))
    child.once("exit", (code) => resolve(code === 0))
  })
}

export async function containerRuntimeStatus(): Promise<ContainerRuntimeStatus> {
  const url = microvmUrl()
  const [docker, health] = await Promise.all([dockerAvailable(), microvmHealth(url)])
  return { docker, microvm: health.ok === true, microvmUrl: url }
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
    execFile("lsof", ["-ti", `tcp:${port}`], (error, stdout) => {
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
  const url = microvmUrl()
  const health = await microvmHealth(url)
  if (health.ok && health.supported) return { ok: true as const, url }
  if (health.ok && !health.supported) await restartStaleDaemon(url)

  if (daemon && !daemon.killed) {
    const current = await microvmHealth(url)
    if (current.ok && current.supported) return { ok: true as const, url }
    await restartStaleDaemon(url)
  }

  const command = await daemonCommand()
  if (!command) return { ok: false as const, url, error: "microvm daemon binary is not configured" }

  const root = await repoRoot()
  daemon = spawn(command.cmd, command.args, {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    detached: false,
  })

  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const next = await microvmHealth(url)
    if (next.ok && next.supported) return { ok: true as const, url }
    if (daemon.exitCode !== null) break
  }

  return { ok: false as const, url, error: "microvm daemon did not become healthy" }
}

export async function stopMicrovmDaemon() {
  await stopTrackedDaemon()
  await killPort(new URL(microvmUrl()).port || "7420")
}
