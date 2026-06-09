import { withTransientReadRetry } from "@/util/effect-http-client"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CreateInput, type Info } from "./schema"

const defaultBaseUrl = () => process.env.OPENLEGION_MICROVM_URL ?? "http://127.0.0.1:7420"

const VmInfo = Schema.Struct({
  id: Schema.String,
  image: Schema.String,
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(["running", "stopped"])),
  kind: Schema.optional(Schema.Literals(["container", "desktop"])),
  display: Schema.optional(Schema.Boolean),
})

const VmList = Schema.Array(VmInfo)

const LogsResponse = Schema.Struct({
  logs: Schema.String,
})

const ShellResponse = Schema.Struct({
  command: Schema.String,
  runtime: Schema.String,
})

const DisplayResponse = Schema.Struct({
  url: Schema.String,
  kind: Schema.Literals(["vnc-websocket"]),
  password: Schema.optional(Schema.String),
})

const ErrorResponse = Schema.Struct({
  error: Schema.String,
})

export interface Interface {
  readonly health: () => Effect.Effect<boolean>
  readonly create: (input: typeof CreateInput.Type) => Effect.Effect<Info, string>
  readonly list: () => Effect.Effect<Array<Info>, string>
  readonly start: (id: string) => Effect.Effect<void, string>
  readonly stop: (id: string) => Effect.Effect<void, string>
  readonly remove: (id: string) => Effect.Effect<void, string>
  readonly logs: (id: string, tail: number) => Effect.Effect<{ logs: string }, string>
  readonly shell: (id: string) => Effect.Effect<{ command: string; runtime: "docker" | "podman" | "microvm" }, string>
  readonly display: (id: string) => Effect.Effect<{ url: string; kind: "vnc-websocket"; password?: string }, string>
}

export class Service extends Context.Service<Service, Interface>()("@openlegion/Container/MicroVMClient") {}

function toInfo(item: typeof VmInfo.Type): Info {
  return {
    id: item.id,
    runtime: "microvm",
    image: item.image,
    name: item.name,
    status: item.status,
    kind: item.kind,
    display: item.display,
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  return fallback
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = withTransientReadRetry(yield* HttpClient.HttpClient)
    const http = HttpClient.filterStatusOk(client)
    const baseUrl = defaultBaseUrl().replace(/\/$/, "")

    const health = Effect.fnUntraced(function* () {
      return yield* HttpClientRequest.get(`${baseUrl}/health`).pipe(
        http.execute,
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      )
    })

    const create = Effect.fnUntraced(function* (input: typeof CreateInput.Type) {
      return yield* Effect.gen(function* () {
        const request = yield* HttpClientRequest.post(`${baseUrl}/vms`).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.schemaBodyJson(CreateInput)(input),
        )
        const response = yield* client.execute(request)
        if (response.status < 200 || response.status >= 300) {
          const body = yield* HttpClientResponse.schemaBodyJson(ErrorResponse)(response).pipe(
            Effect.catch(() => Effect.succeed({ error: `Failed to create microvm (${response.status})` })),
          )
          return yield* Effect.fail(body.error)
        }
        return yield* HttpClientResponse.schemaBodyJson(VmInfo)(response).pipe(Effect.map(toInfo))
      }).pipe(Effect.mapError((error) => errorMessage(error, "Failed to create microvm")))
    })

    const list = Effect.fnUntraced(function* () {
      return yield* HttpClientRequest.get(`${baseUrl}/vms`).pipe(
        HttpClientRequest.acceptJson,
        http.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(VmList)),
        Effect.map((items) => items.map(toInfo)),
        Effect.mapError((error) => errorMessage(error, "Failed to list microvms")),
      )
    })

    const start = Effect.fnUntraced(function* (id: string) {
      return yield* HttpClientRequest.post(`${baseUrl}/vms/${encodeURIComponent(id)}/start`).pipe(
        http.execute,
        Effect.asVoid,
        Effect.mapError((error) => errorMessage(error, "Failed to start microvm")),
      )
    })

    const stop = Effect.fnUntraced(function* (id: string) {
      return yield* HttpClientRequest.post(`${baseUrl}/vms/${encodeURIComponent(id)}/stop`).pipe(
        http.execute,
        Effect.asVoid,
        Effect.mapError((error) => errorMessage(error, "Failed to stop microvm")),
      )
    })

    const remove = Effect.fnUntraced(function* (id: string) {
      return yield* HttpClientRequest.delete(`${baseUrl}/vms/${encodeURIComponent(id)}`).pipe(
        http.execute,
        Effect.asVoid,
        Effect.mapError((error) => errorMessage(error, "Failed to remove microvm")),
      )
    })

    const logs = Effect.fnUntraced(function* (id: string, tail: number) {
      const query = tail > 0 ? `?tail=${encodeURIComponent(String(tail))}` : ""
      return yield* HttpClientRequest.get(`${baseUrl}/vms/${encodeURIComponent(id)}/logs${query}`).pipe(
        HttpClientRequest.acceptJson,
        http.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(LogsResponse)),
        Effect.mapError((error) => errorMessage(error, "Failed to fetch microvm logs")),
      )
    })

    const shell = Effect.fnUntraced(function* (id: string) {
      return yield* HttpClientRequest.get(`${baseUrl}/vms/${encodeURIComponent(id)}/shell`).pipe(
        HttpClientRequest.acceptJson,
        http.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ShellResponse)),
        Effect.map((item) => ({
          command: item.command,
          runtime: item.runtime === "podman" ? ("podman" as const) : ("microvm" as const),
        })),
        Effect.mapError((error) => errorMessage(error, "Failed to resolve microvm shell command")),
      )
    })

    const display = Effect.fnUntraced(function* (id: string) {
      return yield* Effect.gen(function* () {
        const response = yield* HttpClientRequest.get(`${baseUrl}/vms/${encodeURIComponent(id)}/display`).pipe(
          HttpClientRequest.acceptJson,
          client.execute,
        )
        if (response.status < 200 || response.status >= 300) {
          const body = yield* HttpClientResponse.schemaBodyJson(ErrorResponse)(response).pipe(
            Effect.catch(() => Effect.succeed({ error: "display is not available for this workload" })),
          )
          return yield* Effect.fail(body.error)
        }
        return yield* HttpClientResponse.schemaBodyJson(DisplayResponse)(response)
      }).pipe(Effect.mapError((error) => errorMessage(error, "Failed to resolve microvm display")))
    })

    return Service.of({ health, create, list, start, stop, remove, logs, shell, display })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))
