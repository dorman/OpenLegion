import { describe, expect, test } from "bun:test"
import {
  downloadablePresets,
  pickLatestIsoFilename,
  presetById,
  presetsForArch,
  resolveDownloadablePreset,
} from "./desktop-presets"

describe("desktop-presets", () => {
  test("filters presets by host architecture", () => {
    const arm64 = presetsForArch("arm64")
    const x64 = presetsForArch("x64")

    expect(arm64.some((item) => item.id === "custom")).toBe(true)
    expect(x64.some((item) => item.id === "custom")).toBe(true)
    expect(arm64.every((item) => !item.arch || item.arch === "arm64")).toBe(true)
    expect(x64.every((item) => !item.arch || item.arch === "x64")).toBe(true)
    expect(arm64.some((item) => item.id === "ubuntu-2404-amd64")).toBe(false)
    expect(x64.some((item) => item.id === "ubuntu-2404-arm64")).toBe(false)
  })

  test("rejects presets for the wrong host architecture", () => {
    const hostArch = "arm64"
    const wrong = resolveDownloadablePreset("ubuntu-2404-amd64", hostArch)
    const match = resolveDownloadablePreset("ubuntu-2404-arm64", hostArch)

    expect(wrong.ok).toBe(false)
    expect(wrong.error).toContain("arm64")
    expect(match.ok).toBe(true)
  })

  test("includes multiple downloadable distros per architecture", () => {
    const arm64 = downloadablePresets().filter((item) => item.arch === "arm64")
    const x64 = downloadablePresets().filter((item) => item.arch === "x64")

    expect(arm64.length).toBeGreaterThanOrEqual(5)
    expect(x64.length).toBeGreaterThanOrEqual(5)
    expect(presetById("debian-13-arm64")?.url).toContain("/debian-cd/13.5.0/")
    expect(presetById("fedora-42-amd64")?.isoDirectory).toContain("fedoraproject.org")
  })

  test("picks the latest Fedora compose from a directory listing", () => {
    const html = `
      <a href="Fedora-Server-netinst-aarch64-42-1.1.iso">older</a>
      <a href="Fedora-Server-netinst-aarch64-42-1.2.iso">newer</a>
    `

    expect(pickLatestIsoFilename(html, "Fedora-Server-netinst-aarch64-42-")).toBe(
      "Fedora-Server-netinst-aarch64-42-1.2.iso",
    )
  })
})
