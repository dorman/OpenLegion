import { Config } from "@/config/config"
import { ConfigV1 } from "@openlegion-ai/core/v1/config/config"
import { EventV2 } from "@openlegion-ai/core/event"
import { InstanceDisposed } from "@/server/event"
import "@openlegion-ai/core/account"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { CreateInput, Info, ListOutput, LogsOutput, ShellOutput } from "@/container/schema"
import { UpsertPayload, Workspace } from "@/container/workspace"
import { described } from "./metadata"

const ContainerID = Schema.String

const ContainerLogsQuery = Schema.Struct({
  tail: Schema.optional(Schema.NumberFromString),
})

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const SyncEventSchemas = EventV2.registry
  .values()
  .flatMap((definition) => {
    if (!definition.sync) return []
    return [
      Schema.Struct({
        type: Schema.Literal("sync"),
        name: Schema.Literal(EventV2.versionedType(definition.type, definition.sync.version)),
        id: Schema.String,
        seq: Schema.Finite,
        aggregateID: Schema.Literal(definition.sync.aggregate),
        data: definition.data,
      }).annotate({ identifier: `SyncEvent.${definition.type}` }),
    ]
  })
  .toArray()

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([
    ...EventV2.registry
      .values()
      .map((definition) =>
        Schema.Struct({ id: Schema.String, type: Schema.Literal(definition.type), properties: definition.data }),
      )
      .toArray(),
    InstanceDisposed,
    ...SyncEventSchemas,
  ]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
  containers: "/global/containers",
  containerStop: "/global/containers/:id/stop",
  containerLogs: "/global/containers/:id/logs",
  containerShell: "/global/containers/:id/shell",
  containerRemove: "/global/containers/:id",
  containerWorkspaces: "/global/container-workspaces",
  containerWorkspace: "/global/container-workspaces/:containerId",
} as const

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenLegion server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenLegion system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(ConfigV1.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenLegion configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: ConfigV1.Info,
        success: described(ConfigV1.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenLegion configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenLegion instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: [HttpApiSchema.NoContent, GlobalUpgradeInput],
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade openlegion",
          description: "Upgrade openlegion to the specified version or latest if not specified.",
        }),
      ),
      HttpApiEndpoint.get("containers", GlobalPaths.containers, {
        success: described(ListOutput, "Sandbox containers"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containers.list",
          summary: "List containers",
          description: "List sandbox containers managed by the local runtime.",
        }),
      ),
      HttpApiEndpoint.post("containerCreate", GlobalPaths.containers, {
        payload: CreateInput,
        success: described(Info, "Created container"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containers.create",
          summary: "Create container",
          description: "Create and start a sandbox container.",
        }),
      ),
      HttpApiEndpoint.post("containerStop", GlobalPaths.containerStop, {
        params: { id: ContainerID },
        success: HttpApiSchema.NoContent,
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containers.stop",
          summary: "Stop container",
          description: "Stop a sandbox container by id.",
        }),
      ),
      HttpApiEndpoint.get("containerLogs", GlobalPaths.containerLogs, {
        params: { id: ContainerID },
        query: ContainerLogsQuery,
        success: described(LogsOutput, "Container logs"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containers.logs",
          summary: "Container logs",
          description: "Fetch recent stdout/stderr logs for a sandbox container.",
        }),
      ),
      HttpApiEndpoint.get("containerShell", GlobalPaths.containerShell, {
        params: { id: ContainerID },
        success: described(ShellOutput, "Container shell command"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containers.shell",
          summary: "Container shell command",
          description: "Resolve the local command used to open an interactive shell in a sandbox container.",
        }),
      ),
      HttpApiEndpoint.delete("containerRemove", GlobalPaths.containerRemove, {
        params: { id: ContainerID },
        success: HttpApiSchema.NoContent,
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containers.remove",
          summary: "Remove container",
          description: "Remove a sandbox container and its isolation boundary.",
        }),
      ),
      HttpApiEndpoint.get("containerWorkspaces", GlobalPaths.containerWorkspaces, {
        success: described(Schema.Array(Workspace), "Container workspaces"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containerWorkspaces.list",
          summary: "List container workspaces",
          description: "List persisted container workspace metadata used to link sandboxes to agent sessions.",
        }),
      ),
      HttpApiEndpoint.put("containerWorkspaceUpsert", GlobalPaths.containerWorkspace, {
        params: { containerId: ContainerID },
        payload: UpsertPayload,
        success: described(Workspace, "Container workspace"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.containerWorkspaces.upsert",
          summary: "Upsert container workspace",
          description: "Create or update workspace metadata for a sandbox container.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
