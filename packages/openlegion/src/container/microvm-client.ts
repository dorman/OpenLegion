import { withTransientReadRetry } from "@/util/effect-http-client"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { CreateInput, type Info } from "./schema"

const defaultBaseUrl = () => process.env.OPENLEGION_MICROVM_URL ?? "http://127.0.0.1:7420"

const VmInfo = Schema.Struct({
  id: Schema.String,
  image: Schema.String,
  name: Schema.optional(Schema.String),
})

const VmList = Schema.Array(VmInfo)

export interface Interface {
  readonly health: () => Effect.Effect<boolean>
  readonly create: (input: typeof CreateInput.Type) => Effect.Effect<Info, string>
  readonly list: () => Effect.Effect<Array<Info>, string>
}

export class Service extends Context.Service<Service, Interface>()("@openlegion/Container/MicroVMClient") {}

function toInfo(item: typeof VmInfo.Type): Info {
  return {
    id: item.id,
    runtime: "microvm",
    image: item.image,
    name: item.name,
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  return fallback
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
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
        return yield* http.execute(request).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(VmInfo)),
          Effect.map(toInfo),
        )
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

    return Service.of({ health, create, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FetchHttpClient.layer))
