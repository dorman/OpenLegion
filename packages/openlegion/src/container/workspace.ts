import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Global } from "@openlegion-ai/core/global"
import { FSUtil } from "@openlegion-ai/core/fs-util"
import { Runtime } from "./schema"

const file = path.join(Global.Path.data, "container-workspaces.json")

export const Workspace = Schema.Struct({
  containerId: Schema.String,
  image: Schema.String,
  name: Schema.optional(Schema.String),
  runtime: Runtime,
  hostMount: Schema.optional(Schema.String),
  containerMount: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  createdAt: Schema.Number,
}).annotate({ identifier: "ContainerWorkspace" })
export type Workspace = typeof Workspace.Type

export const UpsertPayload = Schema.Struct({
  image: Schema.String,
  name: Schema.optional(Schema.String),
  runtime: Runtime,
  hostMount: Schema.optional(Schema.String),
  containerMount: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
}).annotate({ identifier: "ContainerWorkspaceUpsertPayload" })
export type UpsertPayload = typeof UpsertPayload.Type

export type UpsertInput = UpsertPayload & { containerId: string }

export class WorkspaceError extends Schema.TaggedErrorClass<WorkspaceError>()("ContainerWorkspaceError", {
  message: Schema.String,
}) {}

const StoreSchema = Schema.Record(Schema.String, Workspace)
type Store = typeof StoreSchema.Type

const decodeStore = Schema.decodeUnknownOption(StoreSchema)

export interface Interface {
  readonly list: () => Effect.Effect<Workspace[], WorkspaceError>
  readonly get: (containerId: string) => Effect.Effect<Workspace | undefined, WorkspaceError>
  readonly upsert: (input: UpsertInput) => Effect.Effect<Workspace, WorkspaceError>
  readonly remove: (containerId: string) => Effect.Effect<void, WorkspaceError>
}

export class Service extends Context.Service<Service, Interface>()("@openlegion/ContainerWorkspace") {}

function fail(message: string) {
  return () => new WorkspaceError({ message })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service

    const read = Effect.fn("ContainerWorkspace.read")(function* () {
      const data = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))
      const decoded = decodeStore(data)
      if (decoded._tag === "None") {
        return yield* new WorkspaceError({ message: "Invalid container workspace store" })
      }
      return decoded.value
    })

    const write = Effect.fn("ContainerWorkspace.write")(function* (store: Store) {
      yield* fsys.writeJson(file, store).pipe(Effect.mapError(fail("Failed to write container workspaces")))
    })

    const list = Effect.fn("ContainerWorkspace.list")(function* () {
      const store = yield* read()
      return Object.values(store)
    })

    const get = Effect.fn("ContainerWorkspace.get")(function* (containerId: string) {
      const store = yield* read()
      return store[containerId]
    })

    const upsert = Effect.fn("ContainerWorkspace.upsert")(function* (input: UpsertInput) {
      const store = yield* read()
      const existing = store[input.containerId]
      const next: Workspace = {
        containerId: input.containerId,
        image: input.image,
        name: input.name,
        runtime: input.runtime,
        hostMount: input.hostMount,
        containerMount: input.containerMount,
        sessionId: input.sessionId ?? existing?.sessionId,
        createdAt: existing?.createdAt ?? Date.now(),
      }
      yield* write({ ...store, [input.containerId]: next })
      return next
    })

    const remove = Effect.fn("ContainerWorkspace.remove")(function* (containerId: string) {
      const store = yield* read()
      if (!store[containerId]) return
      const next = { ...store }
      delete next[containerId]
      yield* write(next)
    })

    return Service.of({ list, get, upsert, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer))
