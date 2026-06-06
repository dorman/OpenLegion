import { Schema } from "effect"

export const Runtime = Schema.Literals(["docker", "podman", "microvm"])
export type Runtime = typeof Runtime.Type

export const CreateInput = Schema.Struct({
  image: Schema.String,
  name: Schema.optional(Schema.String),
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

export const Info = Schema.Struct({
  id: Schema.String,
  runtime: Runtime,
  image: Schema.String,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "ContainerInfo" })
export type Info = typeof Info.Type

export const ListOutput = Schema.Array(Info).annotate({ identifier: "ContainerListOutput" })
export type ListOutput = typeof ListOutput.Type
