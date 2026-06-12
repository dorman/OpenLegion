import type { ConfigPermissionV1 } from "./permission"

export const PermissionPresetID = {
  strict: "strict",
  dev: "dev",
} as const

export type PermissionPresetID = (typeof PermissionPresetID)[keyof typeof PermissionPresetID]

export type PermissionPreset = {
  id: PermissionPresetID
  label: string
  description: string
  permission: ConfigPermissionV1.Info
}

const strictPermission: ConfigPermissionV1.Info = {
  webfetch: "ask",
  websearch: "ask",
  bash: "ask",
  external_directory: "ask",
  sandbox: {
    "create *": "ask",
    "start *": "ask",
    "stop *": "ask",
    "delete *": "ask",
    "exec *": "ask",
  },
}

const devPermission: ConfigPermissionV1.Info = {
  webfetch: "allow",
  websearch: "allow",
  bash: "allow",
  external_directory: "ask",
  sandbox: {
    "create *": "ask",
    "start *": "allow",
    "stop *": "ask",
    "delete *": "ask",
    "exec *": "allow",
  },
}

export const permissionPresets: PermissionPreset[] = [
  {
    id: PermissionPresetID.strict,
    label: "Strict",
    description: "Prompt before network access, host mounts, shell commands, and sandbox changes.",
    permission: strictPermission,
  },
  {
    id: PermissionPresetID.dev,
    label: "Dev",
    description: "Allow routine network and shell work; still prompt for mounts and destructive sandbox actions.",
    permission: devPermission,
  },
]

export function permissionPreset(id: PermissionPresetID) {
  const item = permissionPresets.find((entry) => entry.id === id)
  if (!item) throw new Error(`unknown permission preset: ${id}`)
  return item
}

export function isPermissionPresetID(value: string): value is PermissionPresetID {
  return value === PermissionPresetID.strict || value === PermissionPresetID.dev
}
