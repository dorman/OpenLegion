import { Catalog } from "@openlegion-ai/core/catalog"
import { Location } from "@openlegion-ai/core/location"
import { LocationServiceMap } from "@openlegion-ai/core/location-layer"
import { FileSystem } from "@openlegion-ai/core/filesystem"
import { PermissionV2 } from "@openlegion-ai/core/permission"
import { ProjectReference } from "@openlegion-ai/core/project-reference"
import { AbsolutePath } from "@openlegion-ai/core/schema"
import { PluginBoot } from "@openlegion-ai/core/plugin/boot"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "V2LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

export class V2LocationMiddleware extends HttpApiMiddleware.Service<
  V2LocationMiddleware,
  {
    provides:
      | Catalog.Service
      | PluginBoot.Service
      | PermissionV2.Service
      | ProjectReference.Service
      | FileSystem.Service
  }
>()("@openlegion/ExperimentalHttpApiV2Location") {}

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  return {
    directory: AbsolutePath.make(
      query.get("location[directory]") || request.headers["x-openlegion-directory"] || process.cwd(),
    ),
    workspaceID: query.get("location[workspace]") || request.headers["x-openlegion-workspace"],
  }
}

export const layer = Layer.effect(
  V2LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return V2LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(ref(request))))
      }),
    )
  }),
)
