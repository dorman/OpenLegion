import path from "path"
import { Option, Schema } from "effect"
import { Runtime } from "./schema"

export const SESSION_CONTAINER_KEY = "openlegion.container"

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
