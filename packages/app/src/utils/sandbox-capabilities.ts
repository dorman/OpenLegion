import type { ContainerRuntime } from "./containers"

// The unified sandbox model: three backends (Docker/Podman containers, Kata
// micro-VM desktops, Kubernetes pods) exposed through one lifecycle. Rather
// than assume every sandbox is a container, the UI reads these capability
// flags and only shows controls the underlying engine can actually honor.

export type SandboxKind = "container" | "desktop" | "kubernetes"

export type SandboxCapabilities = {
  logs: boolean
  /** Interactive shell / exec into the running sandbox. */
  exec: boolean
  /** A graphical display (VNC/CDP) is available. */
  display: boolean
  /** Point-in-time snapshot + revert. */
  snapshot: boolean
  /** Per-sandbox network isolation (offline / restricted egress). */
  networkIsolation: boolean
}

/** The backend a workload kind runs on, when the sandbox metadata omits it. */
export function runtimeForKind(
  kind: SandboxKind | undefined,
  runtime: ContainerRuntime | undefined,
): ContainerRuntime {
  if (runtime) return runtime
  if (kind === "desktop") return "microvm"
  return "docker"
}

export function capabilitiesFor(kind: SandboxKind | undefined): SandboxCapabilities {
  switch (kind) {
    // Kata micro-VM desktop: a real VM with a graphical display. Snapshots and
    // network isolation aren't wired up in the microvm backend yet (it returns
    // NotSupported), so leave those controls off until it is.
    case "desktop":
      return { logs: true, exec: true, display: true, snapshot: false, networkIsolation: false }
    // Kubernetes pods: no image-level snapshot; isolation is via NetworkPolicy;
    // no built-in graphical display.
    case "kubernetes":
      return { logs: true, exec: true, display: false, snapshot: false, networkIsolation: true }
    // Docker/Podman container (default): snapshot via commit, isolation via
    // network mode, display when the image runs one.
    case "container":
    default:
      return { logs: true, exec: true, display: true, snapshot: true, networkIsolation: true }
  }
}
