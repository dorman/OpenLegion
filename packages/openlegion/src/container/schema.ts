import { Schema } from "effect"

export const Runtime = Schema.Literals(["docker", "podman", "microvm"])
export type Runtime = typeof Runtime.Type

export const WorkloadKind = Schema.Literals(["container", "desktop"])
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
}).annotate({ identifier: "ContainerCreateInput" })
export type CreateInput = typeof CreateInput.Type

export const Status = Schema.Literals(["running", "stopped"])
export type Status = typeof Status.Type

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
  kind: Schema.Literals(["vnc-websocket"]),
  password: Schema.optional(Schema.String),
}).annotate({ identifier: "ContainerDisplayOutput" })
export type DisplayOutput = typeof DisplayOutput.Type

export const ComposeInput = Schema.Struct({
  file: Schema.String,
}).annotate({ identifier: "ComposeInput" })
export type ComposeInput = typeof ComposeInput.Type

export const ComposeOutput = Schema.Struct({
  output: Schema.String,
}).annotate({ identifier: "ComposeOutput" })
export type ComposeOutput = typeof ComposeOutput.Type
