import { Schema } from "effect"

export const Runtime = Schema.Literals(["docker", "podman", "microvm"])
export type Runtime = typeof Runtime.Type

export const WorkloadKind = Schema.Literals(["container", "desktop", "kubernetes"])
export type WorkloadKind = typeof WorkloadKind.Type

export const CreateInput = Schema.Struct({
  kind: Schema.optional(WorkloadKind),
  image: Schema.String,
  name: Schema.optional(Schema.String),
  memoryMb: Schema.optional(Schema.Number),
  cpuCores: Schema.optional(Schema.Number),
  diskGb: Schema.optional(Schema.Number),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  ports: Schema.optional(
    Schema.Array(
      Schema.Struct({
        host: Schema.String,
        container: Schema.String,
      }),
    ),
  ),
  volumes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        host: Schema.String,
        container: Schema.String,
        readOnly: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  command: Schema.optional(Schema.Array(Schema.String)),
  // "offline" creates the sandbox with no network from the very first instant
  // (docker `--network none`) — the safe default for malware detonation, where
  // even a brief online window could let a sample phone home.
  network: Schema.optional(Schema.Literals(["online", "offline"])),
}).annotate({ identifier: "ContainerCreateInput" })
export type CreateInput = typeof CreateInput.Type

export const Status = Schema.Literals(["running", "stopped"])
export type Status = typeof Status.Type

// Health of each container/sandbox backend the local server can reach, used to
// drive the runtime status + remediation UI instead of surfacing a raw failure
// when a backend (Docker daemon, sandbox daemon, …) is down.
export const RuntimeStatus = Schema.Struct({
  id: Runtime,
  available: Schema.Boolean,
  detail: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
}).annotate({ identifier: "ContainerRuntimeStatus" })
export type RuntimeStatus = typeof RuntimeStatus.Type

export const RuntimesOutput = Schema.Array(RuntimeStatus).annotate({ identifier: "ContainerRuntimesOutput" })
export type RuntimesOutput = typeof RuntimesOutput.Type

export const Info = Schema.Struct({
  id: Schema.String,
  runtime: Runtime,
  image: Schema.String,
  name: Schema.optional(Schema.String),
  status: Schema.optional(Status),
  kind: Schema.optional(WorkloadKind),
  display: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ContainerInfo" })
export type Info = typeof Info.Type

export const ListOutput = Schema.Array(Info).annotate({ identifier: "ContainerListOutput" })
export type ListOutput = typeof ListOutput.Type

export const LogsOutput = Schema.Struct({
  logs: Schema.String,
}).annotate({ identifier: "ContainerLogsOutput" })
export type LogsOutput = typeof LogsOutput.Type

export const ShellOutput = Schema.Struct({
  command: Schema.String,
  runtime: Runtime,
}).annotate({ identifier: "ContainerShellOutput" })
export type ShellOutput = typeof ShellOutput.Type

export const DisplayOutput = Schema.Struct({
  url: Schema.String,
  kind: Schema.Literals(["vnc-websocket", "cdp"]),
  password: Schema.optional(Schema.String),
}).annotate({ identifier: "ContainerDisplayOutput" })
export type DisplayOutput = typeof DisplayOutput.Type

export const SnapshotOutput = Schema.Struct({
  ref: Schema.String,
  createdAt: Schema.Number,
}).annotate({ identifier: "ContainerSnapshotOutput" })
export type SnapshotOutput = typeof SnapshotOutput.Type

export const SnapshotsOutput = Schema.Array(SnapshotOutput).annotate({ identifier: "ContainerSnapshotsOutput" })
export type SnapshotsOutput = typeof SnapshotsOutput.Type

export const NetworkMode = Schema.Literals(["online", "offline"])
export type NetworkMode = typeof NetworkMode.Type

export const NetworkOutput = Schema.Struct({
  mode: NetworkMode,
  networks: Schema.Array(Schema.String),
}).annotate({ identifier: "ContainerNetworkOutput" })
export type NetworkOutput = typeof NetworkOutput.Type

export const SetNetworkInput = Schema.Struct({
  mode: NetworkMode,
}).annotate({ identifier: "ContainerSetNetworkInput" })
export type SetNetworkInput = typeof SetNetworkInput.Type

export const ComposeInput = Schema.Struct({
  file: Schema.String,
}).annotate({ identifier: "ComposeInput" })
export type ComposeInput = typeof ComposeInput.Type

export const ComposeOutput = Schema.Struct({
  output: Schema.String,
}).annotate({ identifier: "ComposeOutput" })
export type ComposeOutput = typeof ComposeOutput.Type
