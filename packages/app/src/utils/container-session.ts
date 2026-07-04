import type { ServerConnection } from "@/context/server"
import type { useGlobal } from "@/context/global"
import type { useLayout } from "@/context/layout"
import type { Platform } from "@/context/platform"
import type { useServerSDK } from "@/context/server-sdk"
import { seedPromptDraft } from "@/context/prompt"
import { templateById } from "@/utils/sandbox-templates"
import { base64Encode } from "@openlegion-ai/core/util/encode"
import { ensureContainerAvailable, type ContainerInfo } from "@/utils/containers"
import {
  containerSessionMetadata,
  DEFAULT_CONTAINER_MOUNT,
  SESSION_SANDBOX_KEY,
  sessionContainerFromMetadata,
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

  const hostMount = input.projectDirectory
  const containerMount = input.workspace?.containerMount ?? DEFAULT_CONTAINER_MOUNT
  const metadata = containerSessionMetadata(container, { hostMount, containerMount })

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
      const current = sessionContainerFromMetadata(existing.metadata)
      if (
        current?.hostMount !== hostMount ||
        current.containerMount !== containerMount ||
        current.id !== container.id ||
        current.runtime !== container.runtime
      ) {
        await client.session.update({
          sessionID: existing.id,
          directory: input.projectDirectory,
          metadata,
        })
      }
      input.navigate(`/${base64Encode(input.projectDirectory)}/session/${existing.id}`)
      return existing
    }
  }

  const created = await client.session.create({
    directory: input.projectDirectory,
    metadata,
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

type AskAgentInput = {
  conn: ServerConnection.Any
  container: ContainerInfo
  platform: Platform
  global: ReturnType<typeof useGlobal>
  layout: ReturnType<typeof useLayout>
  createClient: ReturnType<typeof useServerSDK>["createClient"]
  navigate: (path: string) => void
  pickDirectory: () => Promise<string | undefined>
}

/**
 * Marks the session as dedicated to a sandbox. The server reads this key
 * (SESSION_SANDBOX_KEY in the openlegion package) and injects the sandbox's
 * live state into the system prompt on every turn.
 */
function sandboxSessionMetadata(container: ContainerInfo) {
  return {
    [SESSION_SANDBOX_KEY]: {
      id: container.id,
      ...(container.name ? { name: container.name } : {}),
      ...(container.image ? { image: container.image } : {}),
      runtime: container.runtime,
      ...(container.kind ? { kind: container.kind } : {}),
    },
  }
}

function sandboxDraft(container: ContainerInfo) {
  const label = container.name ?? container.id.slice(0, 12)
  return `Help me with my sandbox "${label}". `
}

/**
 * Open a host agent session pre-scoped to a sandbox: the prompt is seeded
 * with the sandbox's identity so the agent can operate on it with the
 * sandbox_* tools. Unlike openContainerSession, the agent runs on the host
 * rather than inside the container.
 */
export async function askAgentAboutSandbox(input: AskAgentInput) {
  const serverCtx = input.global.createServerCtx(input.conn)
  let directory: string | undefined = serverCtx.projects.last() ?? serverCtx.projects.list()[0]?.worktree
  if (!directory) directory = await input.pickDirectory()
  if (!directory) return undefined

  serverCtx.projects.open(directory)
  serverCtx.projects.touch(directory)
  input.layout.projects.open(directory)

  const client = input.createClient({ directory, throwOnError: true })
  const created = await client.session.create({ directory, metadata: sandboxSessionMetadata(input.container) })
  const session = created.data
  if (!session?.id) throw new Error("Failed to create session")

  await seedPromptDraft(input.platform, directory, session.id, sandboxDraft(input.container))
  input.navigate(`/${base64Encode(directory)}/session/${session.id}`)
  return session
}

export type SandboxRuntime = "docker" | "kubernetes" | "linux-vm"

type StartSandboxSetupInput = {
  conn: ServerConnection.Any
  // A curated template id (see sandbox-templates.ts). Creation is agent-guided
  // (no forms): the template picks a runtime and seeds a workflow-specific
  // prompt so the agent provisions the right environment via the sandbox tools.
  templateId: string
  platform: Platform
  global: ReturnType<typeof useGlobal>
  layout: ReturnType<typeof useLayout>
  createClient: ReturnType<typeof useServerSDK>["createClient"]
  navigate: (path: string) => void
}

/**
 * Start an agent chat to create a sandbox of the chosen runtime. This is the
 * "New sandbox" entry point: instead of a form, it opens a host agent session
 * seeded with a runtime-specific goal so the agent guides the user through
 * setup. No project directory picker is shown — the session is not tied to a
 * specific codebase; the last-used project is reused if available, otherwise
 * the user's home directory is used as a neutral default.
 */
export async function startSandboxSetupSession(input: StartSandboxSetupInput) {
  const template = templateById(input.templateId)
  if (!template) throw new Error(`Unknown sandbox template: ${input.templateId}`)

  const serverCtx = input.global.createServerCtx(input.conn)
  let directory: string | undefined = serverCtx.projects.last() ?? serverCtx.projects.list()[0]?.worktree
  if (!directory) directory = await input.platform.getHomeDirectory?.()
  if (!directory) throw new Error("Could not determine a project directory for the session")

  serverCtx.projects.open(directory)
  serverCtx.projects.touch(directory)
  input.layout.projects.open(directory)

  const kindMap: Record<SandboxRuntime, "container" | "desktop" | "kubernetes"> = {
    docker: "container",
    kubernetes: "kubernetes",
    "linux-vm": "desktop",
  }
  const client = input.createClient({ directory, throwOnError: true })
  const created = await client.session.create({
    directory,
    metadata: {
      [SESSION_SANDBOX_KEY]: {
        id: `setup-${template.id}-${Date.now()}`,
        name: template.sandboxName,
        runtime: template.runtime === "linux-vm" ? "microvm" : "docker",
        kind: kindMap[template.runtime],
      },
    },
  })
  const session = created.data
  if (!session?.id) throw new Error("Failed to create session")

  await seedPromptDraft(input.platform, directory, session.id, template.prompt)
  input.navigate(`/${base64Encode(directory)}/session/${session.id}`)
  return session
}
