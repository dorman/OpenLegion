import { createWriteStream, type WriteStream } from "node:fs"
import { access, mkdir, readdir, stat, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable, Transform } from "node:stream"
import type { WebContents } from "electron"
import {
  isDirectoryDownloadPreset,
  pickLatestIsoFilename,
  resolveDownloadablePreset,
  type DesktopImageArch,
  type DownloadableDesktopImagePreset,
} from "@openlegion-ai/app/desktop-presets"
import { write as writeLog } from "./logging"

export type DesktopImageDownloadPhase = "checking" | "cached" | "downloading" | "finishing"

export type DesktopImageDownloadProgress = {
  presetId: string
  phase: DesktopImageDownloadPhase
  downloadedMb?: number
  filename?: string
}

export type EnsureDesktopImageResult = {
  ok: boolean
  path?: string
  error?: string
  cancelled?: boolean
}

let activeDownloadAbort: AbortController | undefined

export function cancelDesktopImageDownload() {
  activeDownloadAbort?.abort()
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}

export function desktopImagesDir() {
  return join(homedir(), ".openlegion", "images")
}

function hostArch(): DesktopImageArch {
  return process.arch === "arm64" ? "arm64" : "x64"
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findCachedDirectoryIso(dir: string, prefix: string) {
  const entries = await readdir(dir).catch(() => [] as string[])
  let latest: string | undefined

  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(".iso")) continue
    const path = join(dir, entry)
    const info = await stat(path)
    if (info.size <= 0) continue
    if (!latest || entry > latest) latest = entry
  }

  return latest
}

async function resolveDirectoryDownload(preset: DownloadableDesktopImagePreset & { isoDirectory: string; isoPrefix: string }) {
  const response = await fetch(preset.isoDirectory)
  if (!response.ok) {
    throw new Error(`Failed to list ${preset.isoDirectory} (${response.status})`)
  }

  const filename = pickLatestIsoFilename(await response.text(), preset.isoPrefix)
  if (!filename) {
    throw new Error(`No ISO found in ${preset.isoDirectory} matching ${preset.isoPrefix}`)
  }

  return { url: new URL(filename, preset.isoDirectory).toString(), filename }
}

async function resolvePresetDownload(dir: string, preset: DownloadableDesktopImagePreset) {
  if (!isDirectoryDownloadPreset(preset)) {
    return { url: preset.url, filename: preset.filename }
  }

  const cached = await findCachedDirectoryIso(dir, preset.isoPrefix)
  if (cached) return { url: "", filename: cached }

  return resolveDirectoryDownload(preset)
}

function emitProgress(
  send: ((progress: DesktopImageDownloadProgress) => void) | undefined,
  progress: DesktopImageDownloadProgress,
) {
  send?.(progress)
}

function progressLogger(
  presetId: string,
  filename: string,
  onChunk: (downloadedMb: number) => void,
) {
  let downloaded = 0
  let lastLoggedMb = 0
  let lastUiMb = 0
  return new Transform({
    transform(chunk, _encoding, callback) {
      downloaded += chunk.length
      const mb = Math.floor(downloaded / (1024 * 1024))
      if (mb >= lastLoggedMb + 100) {
        lastLoggedMb = mb
        writeLog("desktop-image", "download progress", { presetId, filename, downloadedMb: mb }, "info")
      }
      if (mb >= lastUiMb + 5) {
        lastUiMb = mb
        onChunk(mb)
      }
      callback(null, chunk)
    },
    flush(callback) {
      const mb = Math.max(1, Math.floor(downloaded / (1024 * 1024)))
      onChunk(mb)
      callback()
    },
  })
}

export async function ensureDesktopImage(
  presetId: string,
  sender?: WebContents,
  signal?: AbortSignal,
): Promise<EnsureDesktopImageResult> {
  activeDownloadAbort?.abort()
  const abort = new AbortController()
  activeDownloadAbort = abort
  const combinedSignal = signal
    ? AbortSignal.any([signal, abort.signal])
    : abort.signal

  const send = sender
    ? (progress: DesktopImageDownloadProgress) => {
        if (!sender.isDestroyed()) sender.send("desktop-image-download-progress", progress)
      }
    : undefined

  try {
    return await ensureDesktopImageInner(presetId, send, combinedSignal)
  } finally {
    if (activeDownloadAbort === abort) activeDownloadAbort = undefined
  }
}

async function ensureDesktopImageInner(
  presetId: string,
  send: ((progress: DesktopImageDownloadProgress) => void) | undefined,
  signal: AbortSignal,
): Promise<EnsureDesktopImageResult> {
  emitProgress(send, { presetId, phase: "checking" })

  const resolved = resolveDownloadablePreset(presetId, hostArch())
  if (!resolved.ok) return resolved
  const preset = resolved.preset

  const dir = desktopImagesDir()
  await mkdir(dir, { recursive: true })

  let download: { url: string; filename: string }
  try {
    download = await resolvePresetDownload(dir, preset)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeLog("desktop-image", "failed to resolve installer image", { presetId, error: message }, "error")
    return { ok: false, error: message }
  }

  const dest = join(dir, download.filename)

  if (await exists(dest)) {
    const info = await stat(dest)
    if (info.size > 0) {
      writeLog("desktop-image", "using cached installer image", { presetId, path: dest, bytes: info.size })
      emitProgress(send, {
        presetId,
        phase: "cached",
        filename: download.filename,
        downloadedMb: Math.floor(info.size / (1024 * 1024)),
      })
      return { ok: true, path: dest }
    }
  }

  if (!download.url) {
    if (!isDirectoryDownloadPreset(preset)) {
      return { ok: false, error: `Installer image ${download.filename} is missing or empty` }
    }
    try {
      download = await resolveDirectoryDownload(preset)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeLog("desktop-image", "failed to resolve installer image", { presetId, error: message }, "error")
      return { ok: false, error: message }
    }
  }

  const started = Date.now()
  writeLog("desktop-image", "downloading installer image", {
    presetId,
    arch: preset.arch ?? hostArch(),
    filename: download.filename,
    url: download.url,
    dest,
  })
  emitProgress(send, { presetId, phase: "downloading", filename: download.filename, downloadedMb: 0 })

  let tmpStream: WriteStream | undefined
  try {
    if (signal.aborted) {
      return { ok: false, cancelled: true, error: "Download cancelled" }
    }

    const response = await fetch(download.url, { signal })
    if (!response.ok || !response.body) {
      const error = `Failed to download ${download.filename} (${response.status})`
      writeLog("desktop-image", "download failed", { presetId, filename: download.filename, status: response.status }, "error")
      return { ok: false, error }
    }

    const tmp = `${dest}.partial`
    tmpStream = createWriteStream(tmp)
    const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream)
    await pipeline(
      source,
      progressLogger(presetId, download.filename, (downloadedMb) => {
        emitProgress(send, { presetId, phase: "downloading", filename: download.filename, downloadedMb })
      }),
      tmpStream,
    )
    emitProgress(send, { presetId, phase: "finishing", filename: download.filename })
    const { rename } = await import("node:fs/promises")
    await rename(tmp, dest)
    const info = await stat(dest)
    writeLog("desktop-image", "download complete", {
      presetId,
      path: dest,
      bytes: info.size,
      durationMs: Date.now() - started,
    })
    return { ok: true, path: dest }
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      writeLog("desktop-image", "download cancelled", { presetId, filename: download.filename }, "info")
      return { ok: false, cancelled: true, error: "Download cancelled" }
    }
    const message = error instanceof Error ? error.message : String(error)
    writeLog(
      "desktop-image",
      "download failed",
      { presetId, filename: download.filename, error: message, durationMs: Date.now() - started },
      "error",
    )
    return { ok: false, error: message }
  } finally {
    tmpStream?.destroy()
    await unlink(`${dest}.partial`).catch(() => undefined)
  }
}
