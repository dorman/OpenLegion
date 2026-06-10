import type { ContainerInfo } from "@/utils/containers"

export function isDesktopWorkload(container: ContainerInfo) {
  return container.kind === "desktop"
}

export function isAgentCapable(container: ContainerInfo) {
  return !isDesktopWorkload(container)
}

export function workloadKindKey(container: ContainerInfo) {
  return isDesktopWorkload(container) ? "containers.badge.desktop" : "containers.badge.container"
}

export function inspectDefaultTab(container: ContainerInfo): "logs" | "shell" | "display" {
  return isDesktopWorkload(container) ? "display" : "logs"
}
