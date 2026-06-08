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

let daemon: ReturnType<typeof spawn> | undefined

function microvmUrl() {
  return process.env.OPENLEGION_MICROVM_URL ?? "http://127.0.0.1:7420"
}

async function microvmHealthy(url: string) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
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
  const [docker, microvm] = await Promise.all([dockerAvailable(), microvmHealthy(url)])
  return { docker, microvm, microvmUrl: url }
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

export async function ensureMicrovmDaemon() {
  const url = microvmUrl()
  if (await microvmHealthy(url)) return { ok: true as const, url }

  if (daemon && !daemon.killed) {
    if (await microvmHealthy(url)) return { ok: true as const, url }
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
    if (await microvmHealthy(url)) return { ok: true as const, url }
    if (daemon.exitCode !== null) break
  }

  return { ok: false as const, url, error: "microvm daemon did not become healthy" }
}

export async function stopMicrovmDaemon() {
  if (!daemon || daemon.killed) return
  daemon.kill()
  daemon = undefined
}
