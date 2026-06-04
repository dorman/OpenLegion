import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@openlegion-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~openlegion/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~openlegion/WorkspaceRef", {
  defaultValue: () => undefined,
})
