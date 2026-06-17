import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/**
 * Read/write the persisted sandbox-daemon connection (`~/.openlegion/sandbox-host.json`).
 * This is the file the openlegion client and the Electron main both resolve at
 * call-time, so the Settings UI can repoint the app at a remote research host —
 * with a bearer token — without an app restart.
 */

export type SandboxHostConfig = { url: string; token: string }

function configPath() {
  return join(homedir(), ".openlegion", "sandbox-host.json")
}

export function getSandboxHostConfig(): SandboxHostConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as { url?: unknown; token?: unknown }
    return {
      url: typeof parsed.url === "string" ? parsed.url : "",
      token: typeof parsed.token === "string" ? parsed.token : "",
    }
  } catch {
    return { url: "", token: "" }
  }
}

export function setSandboxHostConfig(config: SandboxHostConfig): void {
  const url = config.url.trim()
  const token = config.token.trim()
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  // Persist only what is set; an empty url falls back to env/loopback on read.
  const payload: Record<string, string> = {}
  if (url) payload.url = url
  if (token) payload.token = token
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}
