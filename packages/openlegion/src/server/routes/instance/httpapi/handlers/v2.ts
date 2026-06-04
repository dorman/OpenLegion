import { SessionV2 } from "@openlegion-ai/core/session"
import { LocationServiceMap } from "@openlegion-ai/core/location-layer"
import { PermissionSaved } from "@openlegion-ai/core/permission/saved"
import { Layer } from "effect"
import { layer as v2LocationLayer } from "../groups/v2/location"
import { messageHandlers } from "./v2/message"
import { modelHandlers } from "./v2/model"
import { providerHandlers } from "./v2/provider"
import { sessionHandlers } from "./v2/session"
import { permissionHandlers, savedPermissionHandlers, sessionPermissionHandlers } from "./v2/permission"
import { fileSystemHandlers } from "./v2/fs"

export const v2Handlers = Layer.mergeAll(
  sessionHandlers,
  messageHandlers,
  modelHandlers,
  providerHandlers,
  permissionHandlers,
  sessionPermissionHandlers,
  savedPermissionHandlers,
  fileSystemHandlers,
).pipe(
  Layer.provide(v2LocationLayer),
  Layer.provide(LocationServiceMap.layer),
  Layer.provide(PermissionSaved.layer),
  Layer.provide(SessionV2.defaultLayer),
)
