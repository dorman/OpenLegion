import path from "path"
import { Option, Schema } from "effect"
import { Runtime, WorkloadKind } from "./schema"

export const SESSION_CONTAINER_KEY = "openlegion.container"

/**
 * Marks a session as dedicated to assisting with a sandbox. Unlike
 * SESSION_CONTAINER (which runs the session's tools inside a container), the
 * session runs on the host and operates on the sandbox via the sandbox_*
 * tools; the prompt loop injects the sandbox's live state each turn.
 */
export const SESSION_SANDBOX_KEY = "openlegion.sandbox"

export const SessionSandbox = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  image: Schema.optional(Schema.String),
  runtime: Schema.optional(Runtime),
  kind: Schema.optional(WorkloadKind),
}).annotate({ identifier: "SessionSandbox" })
export type SessionSandbox = typeof SessionSandbox.Type

const decodeSandbox = Schema.decodeUnknownOption(SessionSandbox)

export function sessionSandbox(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined
  return Option.getOrUndefined(decodeSandbox(metadata[SESSION_SANDBOX_KEY]))
}

/**
 * Marks a session as a guided workflow (started from the New Sandbox chooser or
 * the Agents workflow hub). The prompt loop injects step-by-step guidance for
 * the chosen flow so the agent drives it consistently.
 */
export const SESSION_WORKFLOW_KEY = "openlegion.workflow"

export const SESSION_WORKFLOWS = ["docker", "kubernetes", "linux-vm", "read-docs", "debug-net", "clone-repo"] as const
export type SessionWorkflow = (typeof SESSION_WORKFLOWS)[number]

export function sessionWorkflow(metadata?: Record<string, unknown>): SessionWorkflow | undefined {
  const value = metadata?.[SESSION_WORKFLOW_KEY]
  return typeof value === "string" && (SESSION_WORKFLOWS as readonly string[]).includes(value)
    ? (value as SessionWorkflow)
    : undefined
}

export const SessionContainer = Schema.Struct({
  id: Schema.String,
  runtime: Runtime,
  hostMount: Schema.String,
  containerMount: Schema.String,
}).annotate({ identifier: "SessionContainer" })
export type SessionContainer = typeof SessionContainer.Type

const decode = Schema.decodeUnknownOption(SessionContainer)

export function sessionContainer(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined
  return Option.getOrUndefined(decode(metadata[SESSION_CONTAINER_KEY]))
}

export function hostPathInContainerMount(hostPath: string, container: SessionContainer) {
  const host = path.resolve(hostPath)
  const mount = path.resolve(container.hostMount)
  if (host === mount) return true
  const prefix = mount.endsWith(path.sep) ? mount : mount + path.sep
  return host.startsWith(prefix)
}

export function hostPathToContainerPath(hostCwd: string, container: SessionContainer) {
  const host = path.resolve(hostCwd)
  const mount = path.resolve(container.hostMount)
  if (host === mount) return container.containerMount
  const prefix = mount.endsWith(path.sep) ? mount : mount + path.sep
  if (!host.startsWith(prefix)) return container.containerMount
  const rel = path.relative(mount, host)
  return path.posix.join(container.containerMount, ...rel.split(path.sep))
}

export function containerCli(runtime: SessionContainer["runtime"]) {
  return runtime === "podman" ? "podman" : "docker"
}

export function containerExecArgs(input: {
  container: SessionContainer
  containerCwd: string
  command: string
}) {
  return {
    bin: containerCli(input.container.runtime),
    args: ["exec", "-w", input.containerCwd, input.container.id, "sh", "-lc", input.command],
  }
}
