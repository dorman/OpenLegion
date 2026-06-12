import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@openlegion-ai/core/event"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@openlegion-ai/core/installation/version"
import * as Log from "@openlegion-ai/core/util/log"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Container } from "@/container"
import { Service as ContainerWorkspace, UpsertPayload } from "@/container/workspace"
import { RootHttpApi } from "../api"
import { ContainerApiError, GlobalUpgradeInput } from "../groups/global"
import { HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"

const log = Log.create({ service: "server" })

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function parseBody(body: string) {
  try {
    return JSON.parse(body || "{}") as unknown
  } catch {
    return undefined
  }
}

function eventResponse() {
  log.info("global event connected")
  const events = Stream.callback<GlobalBusEvent>((queue) => {
    const handler = (event: GlobalBusEvent) => Queue.offerUnsafe(queue, event)
    return Effect.acquireRelease(
      Effect.sync(() => GlobalBus.on("event", handler)),
      () => Effect.sync(() => GlobalBus.off("event", handler)),
    )
  })
  const heartbeat = Stream.tick("10 seconds").pipe(
    Stream.drop(1),
    Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
  )

  return HttpServerResponse.stream(
    Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
      Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
      Stream.map(eventData),
      Stream.pipeThroughChannel(Sse.encode()),
      Stream.encodeText,
      Stream.ensuring(Effect.sync(() => log.info("global event disconnected"))),
    ),
    {
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const container = yield* Container.Service
    const workspaces = yield* ContainerWorkspace
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()

    const mapContainerError = <A, R>(effect: Effect.Effect<A, Container.Error, R>) =>
      effect.pipe(
        Effect.mapError((error) => new ContainerApiError({ name: error._tag, data: { message: error.message } })),
      )

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return {
          status: 400,
          body: { success: false as const, error: "Unknown installation method" },
        }
      }
      const target = ctx.payload.target || (yield* installation.latest(method))
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ status: 200, body: { success: true as const, version: target } }),
        Effect.catch((err) =>
          Effect.succeed({
            status: 500,
            body: {
              success: false as const,
              error: err instanceof Error ? err.message : String(err),
            },
          }),
        ),
      )
      if (!result.body.success) return result
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return result
    })

    const containers = Effect.fn("GlobalHttpApi.containers")(function* () {
      return yield* mapContainerError(container.list())
    })

    const containerCreate = Effect.fn("GlobalHttpApi.containerCreate")(function* (ctx: {
      payload: typeof Container.CreateInput.Type
    }) {
      return yield* mapContainerError(container.create(ctx.payload))
    })

    const containerStart = Effect.fn("GlobalHttpApi.containerStart")(function* (ctx: { params: { id: string } }) {
      yield* mapContainerError(container.start(ctx.params.id))
      return HttpApiSchema.NoContent.make()
    })

    const containerStop = Effect.fn("GlobalHttpApi.containerStop")(function* (ctx: { params: { id: string } }) {
      yield* mapContainerError(container.stop(ctx.params.id))
      return HttpApiSchema.NoContent.make()
    })

    const containerRemove = Effect.fn("GlobalHttpApi.containerRemove")(function* (ctx: { params: { id: string } }) {
      yield* mapContainerError(container.remove(ctx.params.id))
      yield* workspaces
        .remove(ctx.params.id)
        .pipe(
          Effect.mapError(
            () => new ContainerApiError({ name: "WorkspaceRemoveFailed", data: { message: "Failed to remove workspace metadata" } }),
          ),
        )
      return HttpApiSchema.NoContent.make()
    })

    const containerLogs = Effect.fn("GlobalHttpApi.containerLogs")(function* (ctx: {
      params: { id: string }
      query: { tail?: number }
    }) {
      return yield* mapContainerError(container.logs(ctx.params.id, { tail: ctx.query.tail }))
    })

    const containerShell = Effect.fn("GlobalHttpApi.containerShell")(function* (ctx: { params: { id: string } }) {
      return yield* mapContainerError(container.shell(ctx.params.id))
    })

    const containerDisplay = Effect.fn("GlobalHttpApi.containerDisplay")(function* (ctx: { params: { id: string } }) {
      return yield* mapContainerError(container.display(ctx.params.id))
    })

    const containerWorkspaces = Effect.fn("GlobalHttpApi.containerWorkspaces")(function* () {
      return yield* workspaces.list().pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const containerWorkspaceUpsert = Effect.fn("GlobalHttpApi.containerWorkspaceUpsert")(function* (ctx: {
      params: { containerId: string }
      payload: typeof UpsertPayload.Type
    }) {
      return yield* workspaces
        .upsert({ containerId: ctx.params.containerId, ...ctx.payload })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const composeUp = Effect.fn("GlobalHttpApi.composeUp")(function* (ctx: { payload: { file: string } }) {
      return yield* mapContainerError(container.composeUp(ctx.payload.file))
    })

    const composeDown = Effect.fn("GlobalHttpApi.composeDown")(function* (ctx: { payload: { file: string } }) {
      return yield* mapContainerError(container.composeDown(ctx.payload.file))
    })

    const upgradeRaw = Effect.fn("GlobalHttpApi.upgradeRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const json = parseBody(body)
      if (json === undefined) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const payload = yield* Schema.decodeUnknownEffect(GlobalUpgradeInput)(json).pipe(
        Effect.map((payload) => ({ valid: true as const, payload })),
        Effect.catch(() => Effect.succeed({ valid: false as const })),
      )
      if (!payload.valid) {
        return HttpServerResponse.jsonUnsafe({ success: false, error: "Invalid request body" }, { status: 400 })
      }
      const result = yield* upgrade({ payload: payload.payload })
      return HttpServerResponse.jsonUnsafe(result.body, { status: result.status })
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handle("containers", containers)
      .handle("containerCreate", containerCreate)
      .handle("containerStart", containerStart)
      .handle("containerStop", containerStop)
      .handle("containerLogs", containerLogs)
      .handle("containerShell", containerShell)
      .handle("containerDisplay", containerDisplay)
      .handle("containerRemove", containerRemove)
      .handle("containerWorkspaces", containerWorkspaces)
      .handle("containerWorkspaceUpsert", containerWorkspaceUpsert)
      .handle("composeUp", composeUp)
      .handle("composeDown", composeDown)
      .handleRaw("upgrade", upgradeRaw)
  }),
)
