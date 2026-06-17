import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Resolves which sandbox daemon to talk to (and the bearer token to present).
 *
 * Precedence: the `OPENLEGION_MICROVM_URL` / `OPENLEGION_MICROVM_TOKEN` env vars
 * win, then `~/.openlegion/sandbox-host.json` (written by the desktop Settings
 * UI), then the local loopback default. The file is read on every call so the
 * UI can repoint the app at a remote research host without a restart.
 */

export type SandboxHost = { url: string; token?: string }

const DEFAULT_URL = "http://127.0.0.1:7420"

export function sandboxHostConfigPath(): string {
  return join(homedir(), ".openlegion", "sandbox-host.json")
}

export function resolveSandboxHost(): SandboxHost {
  const envUrl = process.env.OPENLEGION_MICROVM_URL?.trim()
  const envToken = process.env.OPENLEGION_MICROVM_TOKEN?.trim()

  let fileUrl: string | undefined
  let fileToken: string | undefined
  try {
    const parsed = JSON.parse(readFileSync(sandboxHostConfigPath(), "utf8")) as { url?: unknown; token?: unknown }
    if (typeof parsed.url === "string" && parsed.url.trim()) fileUrl = parsed.url.trim()
    if (typeof parsed.token === "string" && parsed.token.trim()) fileToken = parsed.token.trim()
  } catch {
    // No config file (or unreadable/invalid) — fall back to env vars / defaults.
  }

  const url = (envUrl || fileUrl || DEFAULT_URL).replace(/\/+$/, "")
  const token = envToken || fileToken
  return token ? { url, token } : { url }
}
