import {
  isPermissionPresetID,
  permissionPreset,
  permissionPresets,
  PermissionPresetID,
  type PermissionPreset,
} from "@openlegion-ai/core/v1/config/permission-preset"
import { PermissionV1 } from "@openlegion-ai/core/v1/permission"
import { Permission } from "./index"

export { isPermissionPresetID, permissionPreset, permissionPresets, PermissionPresetID, type PermissionPreset }

export function ruleset(id: PermissionPresetID): PermissionV1.Ruleset {
  return Permission.fromConfig(permissionPreset(id).permission)
}
