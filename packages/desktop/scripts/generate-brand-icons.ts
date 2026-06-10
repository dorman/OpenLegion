#!/usr/bin/env bun
/**
 * Regenerate desktop + favicon assets from packages/ui/src/assets/brand/openlegion-mark.png
 * Requires macOS `sips` and `iconutil`.
 */
import { $ } from "bun"
import { copyFile, mkdir, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const brandDir = path.resolve(root, "../ui/src/assets/brand")
const master = path.join(brandDir, "openlegion-mark.png")
const faviconDir = path.resolve(root, "../ui/src/assets/favicon")

const channels = ["dev", "beta", "prod"] as const

const pngSizes: Array<{ name: string; size: number }> = [
  { name: "32x32.png", size: 32 },
  { name: "64x64.png", size: 64 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "Square30x30Logo.png", size: 30 },
  { name: "Square44x44Logo.png", size: 44 },
  { name: "Square71x71Logo.png", size: 71 },
  { name: "Square89x89Logo.png", size: 89 },
  { name: "Square107x107Logo.png", size: 107 },
  { name: "Square142x142Logo.png", size: 142 },
  { name: "Square150x150Logo.png", size: 150 },
  { name: "Square284x284Logo.png", size: 284 },
  { name: "Square310x310Logo.png", size: 310 },
  { name: "StoreLogo.png", size: 50 },
]

async function resize(input: string, output: string, size: number) {
  await $`sips -z ${size} ${size} ${input} --out ${output}`.quiet()
}

async function buildIcns(input: string, output: string) {
  const iconset = output.replace(/\.icns$/, ".iconset")
  await rm(iconset, { recursive: true, force: true })
  await mkdir(iconset, { recursive: true })

  const iconsetSizes = [
    { file: "icon_16x16.png", size: 16 },
    { file: "icon_16x16@2x.png", size: 32 },
    { file: "icon_32x32.png", size: 32 },
    { file: "icon_32x32@2x.png", size: 64 },
    { file: "icon_128x128.png", size: 128 },
    { file: "icon_128x128@2x.png", size: 256 },
    { file: "icon_256x256.png", size: 256 },
    { file: "icon_256x256@2x.png", size: 512 },
    { file: "icon_512x512.png", size: 512 },
    { file: "icon_512x512@2x.png", size: 1024 },
  ]

  for (const entry of iconsetSizes) {
    await resize(input, path.join(iconset, entry.file), entry.size)
  }

  await $`iconutil -c icns ${iconset} -o ${output}`.quiet()
  await rm(iconset, { recursive: true, force: true })
}

async function buildChannel(channel: (typeof channels)[number]) {
  const dest = path.join(root, "icons", channel)
  await mkdir(dest, { recursive: true })

  await resize(master, path.join(dest, "icon.png"), 1024)
  await resize(master, path.join(dest, "dock.png"), 256)

  for (const entry of pngSizes) {
    await resize(master, path.join(dest, entry.name), entry.size)
  }

  await buildIcns(path.join(dest, "icon.png"), path.join(dest, "icon.icns"))
  await resize(path.join(dest, "icon.png"), path.join(dest, "icon.ico"), 256)
}

await resize(master, path.join(faviconDir, "favicon-96x96-v3.png"), 96)
await resize(master, path.join(faviconDir, "favicon-96x96.png"), 96)
await resize(master, path.join(faviconDir, "apple-touch-icon-v3.png"), 180)
await resize(master, path.join(faviconDir, "web-app-manifest-192x192.png"), 192)
await resize(master, path.join(faviconDir, "web-app-manifest-512x512.png"), 512)

for (const channel of channels) {
  await buildChannel(channel)
  console.log(`Generated ${channel} icons`)
}

// Keep legacy tracked filenames in sync so cold starts / cached bundles cannot fall back
// to the old green archer artwork still referenced in older logo.tsx builds.
const logo = path.join(brandDir, "openlegion-logo.png")
await copyFile(master, path.join(brandDir, "openlegion-icon.png"))
await copyFile(logo, path.join(brandDir, "openlegion-wordmark.png"))

async function writeBase64Module(png: string, out: string) {
  const bytes = await Bun.file(png).arrayBuffer()
  const b64 = Buffer.from(bytes).toString("base64")
  await Bun.write(out, `export default "data:image/png;base64,${b64}"\n`)
}

await writeBase64Module(master, path.join(brandDir, "openlegion-mark.base64.ts"))
await writeBase64Module(logo, path.join(brandDir, "openlegion-logo.base64.ts"))

console.log("Favicon PNGs updated in packages/ui/src/assets/favicon")
console.log("Synced openlegion-icon.png, openlegion-wordmark.png, and inline base64 logo modules")
