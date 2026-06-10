import { createWriteStream } from "node:fs"
import { access, mkdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"

export type EnsureDesktopImageResult = {
  ok: boolean
  path?: string
  error?: string
}

const PRESETS: Record<string, { filename: string; url: string }> = {
  "ubuntu-2404-arm64": {
    filename: "ubuntu-24.04.3-live-server-arm64.iso",
    url: "https://cdimage.ubuntu.com/releases/24.04/release/ubuntu-24.04.3-live-server-arm64.iso",
  },
  "ubuntu-2404-amd64": {
    filename: "ubuntu-24.04.3-live-server-amd64.iso",
    url: "https://cdimage.ubuntu.com/releases/24.04/release/ubuntu-24.04.3-live-server-amd64.iso",
  },
}

export function desktopImagesDir() {
  return join(homedir(), ".openlegion", "images")
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function ensureDesktopImage(presetId: string): Promise<EnsureDesktopImageResult> {
  const preset = PRESETS[presetId]
  if (!preset) return { ok: false, error: `Unknown desktop image preset: ${presetId}` }

  const dir = desktopImagesDir()
  await mkdir(dir, { recursive: true })
  const dest = join(dir, preset.filename)

  if (await exists(dest)) {
    const info = await stat(dest)
    if (info.size > 0) return { ok: true, path: dest }
  }

  try {
    const response = await fetch(preset.url)
    if (!response.ok || !response.body) {
      return { ok: false, error: `Failed to download ${preset.filename} (${response.status})` }
    }

    const tmp = `${dest}.partial`
    await pipeline(Readable.fromWeb(response.body as import("stream/web").ReadableStream), createWriteStream(tmp))
    const { rename } = await import("node:fs/promises")
    await rename(tmp, dest)
    return { ok: true, path: dest }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
