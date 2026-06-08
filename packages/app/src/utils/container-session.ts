import type { ServerConnection } from "@/context/server"
import type { useGlobal } from "@/context/global"
import type { useLayout } from "@/context/layout"
import type { useServerSDK } from "@/context/server-sdk"
import { base64Encode } from "@openlegion-ai/core/util/encode"
import { ensureContainerAvailable, type ContainerInfo } from "@/utils/containers"
import {
  containerSessionMetadata,
  DEFAULT_CONTAINER_MOUNT,
  type ContainerWorkspace,
  upsertContainerWorkspace,
} from "@/utils/container-workspaces"

type OpenContainerSessionInput = {
  http: ServerConnection.HttpBase
  conn: ServerConnection.Any
  container: ContainerInfo
  workspace?: ContainerWorkspace
  projectDirectory: string
  global: ReturnType<typeof useGlobal>
  layout: ReturnType<typeof useLayout>
  createClient: ReturnType<typeof useServerSDK>["createClient"]
  navigate: (path: string) => void
}

export async function openContainerSession(input: OpenContainerSessionInput) {
  const container = await ensureContainerAvailable(input.http, input.container.id)

  const hostMount = input.workspace?.hostMount ?? input.projectDirectory
  const containerMount = input.workspace?.containerMount ?? DEFAULT_CONTAINER_MOUNT

  const workspace = await upsertContainerWorkspace(input.http, container.id, {
    image: container.image,
    name: container.name ?? input.workspace?.name,
    runtime: container.runtime,
    hostMount,
    containerMount,
    sessionId: input.workspace?.sessionId,
  })

  const server = input.global.createServerCtx(input.conn)
  server.projects.open(input.projectDirectory)
  server.projects.touch(input.projectDirectory)
  input.layout.projects.open(input.projectDirectory)

  const client = input.createClient({
    directory: input.projectDirectory,
    throwOnError: true,
  })

  if (workspace.sessionId) {
    const existing = await client.session
      .get({ sessionID: workspace.sessionId, directory: input.projectDirectory })
      .then((result) => result.data)
      .catch(() => undefined)
    if (existing?.id) {
      input.navigate(`/${base64Encode(input.projectDirectory)}/session/${existing.id}`)
      return existing
    }
  }

  const created = await client.session.create({
    directory: input.projectDirectory,
    metadata: containerSessionMetadata(container, { hostMount, containerMount }),
  })

  const session = created.data
  if (!session?.id) throw new Error("Failed to create session")

  await upsertContainerWorkspace(input.http, container.id, {
    image: container.image,
    name: container.name ?? input.workspace?.name,
    runtime: container.runtime,
    hostMount,
    containerMount,
    sessionId: session.id,
  })

  input.navigate(`/${base64Encode(input.projectDirectory)}/session/${session.id}`)
  return session
}
