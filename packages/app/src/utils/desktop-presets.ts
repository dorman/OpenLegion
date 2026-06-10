export type DesktopImagePreset = {
  id: string
  labelKey: string
  filename?: string
  url?: string
  arch?: "arm64" | "x64"
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
]

export function presetById(id: string) {
  return DESKTOP_IMAGE_PRESETS.find((item) => item.id === id)
}

export function presetsForArch(arch: "arm64" | "x64") {
  return DESKTOP_IMAGE_PRESETS.filter((item) => item.id === "custom" || !item.arch || item.arch === arch)
}
