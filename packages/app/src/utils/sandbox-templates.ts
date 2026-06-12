export type SandboxTemplateFormState = {
  kind: "container" | "desktop"
  preset: string
  image: string
  name: string
  command: string
  memoryMb: string
  cpuCores: string
  diskGb: string
  volumeHost: string
  volumeContainer: string
  publish: string
}

export type SandboxTemplate = {
  id: string
  labelKey: string
  descriptionKey: string
  apply: (arch: "arm64" | "x64") => Partial<SandboxTemplateFormState>
}

export const SANDBOX_TEMPLATES: SandboxTemplate[] = [
  {
    id: "alpine-dev",
    labelKey: "containers.templates.alpineDev.label",
    descriptionKey: "containers.templates.alpineDev.description",
    apply: () => ({
      kind: "container",
      preset: "custom",
      image: "alpine:latest",
      name: "alpine-dev",
      command: "sleep 3600",
      memoryMb: "512",
      cpuCores: "1",
      diskGb: "",
      volumeHost: "",
      volumeContainer: "/workspace",
      publish: "",
    }),
  },
  {
    id: "node-bind",
    labelKey: "containers.templates.nodeBind.label",
    descriptionKey: "containers.templates.nodeBind.description",
    apply: () => ({
      kind: "container",
      preset: "custom",
      image: "node:22-alpine",
      name: "node-workspace",
      command: "sleep 3600",
      memoryMb: "2048",
      cpuCores: "2",
      diskGb: "",
      volumeHost: "",
      volumeContainer: "/workspace",
      publish: "",
    }),
  },
  {
    id: "ubuntu-desktop",
    labelKey: "containers.templates.ubuntuDesktop.label",
    descriptionKey: "containers.templates.ubuntuDesktop.description",
    apply: (arch) => ({
      kind: "desktop",
      preset: arch === "arm64" ? "ubuntu-2404-arm64" : "ubuntu-2404-amd64",
      image: "",
      name: "ubuntu-desktop",
      command: "",
      memoryMb: "4096",
      cpuCores: "2",
      diskGb: "24",
      volumeHost: "",
      volumeContainer: "/workspace",
      publish: "",
    }),
  },
]

export function templateById(id: string) {
  return SANDBOX_TEMPLATES.find((item) => item.id === id)
}
