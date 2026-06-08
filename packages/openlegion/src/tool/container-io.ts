import { Effect } from "effect"
import { hostPathToContainerPath, sessionContainer } from "@/container/session"

export { hostPathInContainerMount } from "@/container/session"
import type { Session } from "@/session/session"
import type * as Tool from "./tool"

export function resolveSessionContainer(sessions: Session.Interface, ctx: Tool.Context) {
  return sessions.get(ctx.sessionID).pipe(
    Effect.orDie,
    Effect.map((info) => sessionContainer(info.metadata)),
  )
}

export function containerPermissionMetadata(container?: ReturnType<typeof sessionContainer>) {
  if (!container) return {}
  return {
    containerId: container.id,
    containerRuntime: container.runtime,
  }
}

export function toContainerPath(hostPath: string, container: NonNullable<ReturnType<typeof sessionContainer>>) {
  return hostPathToContainerPath(hostPath, container)
}
