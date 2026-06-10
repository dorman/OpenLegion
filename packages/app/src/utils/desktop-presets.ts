export type DesktopImageArch = "arm64" | "x64"

export type DesktopImagePreset = {
  id: string
  labelKey: string
  filename?: string
  url?: string
  isoDirectory?: string
  isoPrefix?: string
  arch?: DesktopImageArch
}

export const DESKTOP_IMAGE_PRESETS: DesktopImagePreset[] = [
  {
    id: "custom",
    labelKey: "containers.create.preset.custom",
  },
  {
    id: "ubuntu-2404-arm64",
    labelKey: "containers.create.preset.ubuntu2404Arm64",
    filename: "ubuntu-24.04.3-live-server-arm64.iso",
    url: "https://cdimage.ubuntu.com/releases/24.04/release/ubuntu-24.04.3-live-server-arm64.iso",
    arch: "arm64",
  },
  {
    id: "ubuntu-2404-amd64",
    labelKey: "containers.create.preset.ubuntu2404Amd64",
    filename: "ubuntu-24.04.3-live-server-amd64.iso",
    url: "https://cdimage.ubuntu.com/releases/24.04/release/ubuntu-24.04.3-live-server-amd64.iso",
    arch: "x64",
  },
  {
    id: "debian-13-arm64",
    labelKey: "containers.create.preset.debian13Arm64",
    filename: "debian-13.5.0-arm64-netinst.iso",
    url: "https://cdimage.debian.org/debian-cd/13.5.0/arm64/iso-cd/debian-13.5.0-arm64-netinst.iso",
    arch: "arm64",
  },
  {
    id: "debian-13-amd64",
    labelKey: "containers.create.preset.debian13Amd64",
    filename: "debian-13.5.0-amd64-netinst.iso",
    url: "https://cdimage.debian.org/debian-cd/13.5.0/amd64/iso-cd/debian-13.5.0-amd64-netinst.iso",
    arch: "x64",
  },
  {
    id: "fedora-42-arm64",
    labelKey: "containers.create.preset.fedora42Arm64",
    isoDirectory: "https://download.fedoraproject.org/pub/fedora/linux/releases/42/Server/aarch64/iso/",
    isoPrefix: "Fedora-Server-netinst-aarch64-42-",
    arch: "arm64",
  },
  {
    id: "fedora-42-amd64",
    labelKey: "containers.create.preset.fedora42Amd64",
    isoDirectory: "https://download.fedoraproject.org/pub/fedora/linux/releases/42/Server/x86_64/iso/",
    isoPrefix: "Fedora-Server-netinst-x86_64-42-",
    arch: "x64",
  },
  {
    id: "rocky-9-arm64",
    labelKey: "containers.create.preset.rocky9Arm64",
    filename: "Rocky-9-latest-aarch64-minimal.iso",
    url: "https://download.rockylinux.org/pub/rocky/9/isos/aarch64/Rocky-9-latest-aarch64-minimal.iso",
    arch: "arm64",
  },
  {
    id: "rocky-9-amd64",
    labelKey: "containers.create.preset.rocky9Amd64",
    filename: "Rocky-9-latest-x86_64-minimal.iso",
    url: "https://download.rockylinux.org/pub/rocky/9/isos/x86_64/Rocky-9-latest-x86_64-minimal.iso",
    arch: "x64",
  },
  {
    id: "alma-9-arm64",
    labelKey: "containers.create.preset.alma9Arm64",
    filename: "AlmaLinux-9-latest-aarch64-minimal.iso",
    url: "https://repo.almalinux.org/almalinux/9/isos/aarch64/AlmaLinux-9-latest-aarch64-minimal.iso",
    arch: "arm64",
  },
  {
    id: "alma-9-amd64",
    labelKey: "containers.create.preset.alma9Amd64",
    filename: "AlmaLinux-9-latest-x86_64-minimal.iso",
    url: "https://repo.almalinux.org/almalinux/9/isos/x86_64/AlmaLinux-9-latest-x86_64-minimal.iso",
    arch: "x64",
  },
]

export function presetById(id: string) {
  return DESKTOP_IMAGE_PRESETS.find((item) => item.id === id)
}

export function presetsForArch(arch: DesktopImageArch) {
  return DESKTOP_IMAGE_PRESETS.filter((item) => item.id === "custom" || !item.arch || item.arch === arch)
}

export function downloadablePresets() {
  return DESKTOP_IMAGE_PRESETS.filter(
    (item) =>
      item.id !== "custom" &&
      ((item.filename && item.url) || (item.isoDirectory && item.isoPrefix)),
  )
}

export type DirectDownloadDesktopImagePreset = DesktopImagePreset & {
  filename: string
  url: string
}

export type DirectoryDownloadDesktopImagePreset = DesktopImagePreset & {
  isoDirectory: string
  isoPrefix: string
}

export type DownloadableDesktopImagePreset = DirectDownloadDesktopImagePreset | DirectoryDownloadDesktopImagePreset

export function isDirectoryDownloadPreset(
  preset: DownloadableDesktopImagePreset,
): preset is DirectoryDownloadDesktopImagePreset {
  return "isoDirectory" in preset && "isoPrefix" in preset
}

export function pickLatestIsoFilename(html: string, prefix: string) {
  const matches = [...html.matchAll(new RegExp(`href="(${prefix}[^"]+\\.iso)"`, "gi"))].map((match) => match[1])
  if (matches.length === 0) return undefined
  return matches.sort().at(-1)
}

export function resolveDownloadablePreset(id: string, hostArch: DesktopImageArch) {
  const preset = presetById(id)
  const direct = preset?.filename && preset.url
  const directory = preset?.isoDirectory && preset.isoPrefix
  if (!direct && !directory) {
    return { ok: false as const, error: `Unknown desktop image preset: ${id}` }
  }
  if (preset.arch && preset.arch !== hostArch) {
    return {
      ok: false as const,
      error: `Preset ${id} is for ${preset.arch}, but this machine is ${hostArch}`,
    }
  }
  return { ok: true as const, preset: preset as DownloadableDesktopImagePreset }
}
