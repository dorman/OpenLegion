import type { ServerConnection } from "@/context/server"
import type { useGlobal } from "@/context/global"
import type { useLayout } from "@/context/layout"
import type { Platform } from "@/context/platform"
import type { useServerSDK } from "@/context/server-sdk"
import { seedPromptDraft } from "@/context/prompt"
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

// The Agents workflow hub offers the three creation runtimes plus three general
// helper flows. Each opens an agent chat seeded with the goal below; the agent
// drives it with the sandbox_* tools (and host-agent docs for the VM).
export type AgentWorkflow = SandboxRuntime | "read-docs" | "debug-net" | "clone-repo"

const AGENT_WORKFLOW_PROMPTS: Record<AgentWorkflow, string> = {
  docker:
    "I want to create a new Docker container sandbox. Help me choose an image and network settings, then create and start it for me using the sandbox tools.",
  kubernetes:
    "I want to create a new Kubernetes sandbox. Help me choose an image, then create it as a workload on the local kind cluster using the sandbox tools.",
  "linux-vm":
    "I want to set up a Linux VM research sandbox on a separate Linux host (a sacrificial tower). Walk me through installing the OpenLegion daemon and Kata on that host with the host-agent scripts, then connecting this app to its daemon.",
  "read-docs": "Help me find and understand something in the OpenLegion docs and repo. Ask me what I'm looking for.",
  "debug-net":
    "Help me debug a network problem in one of my sandboxes. List my sandboxes, then check the affected one's interfaces, routing, and DNS to find where the chain breaks.",
  "clone-repo":
    "Help me clone a git repository into a sandbox and get it set up to work on. Ask me for the repo URL and which sandbox to use.",
}

type SeedSessionDeps = {
  conn: ServerConnection.Any
  platform: Platform
  global: ReturnType<typeof useGlobal>
  layout: ReturnType<typeof useLayout>
  createClient: ReturnType<typeof useServerSDK>["createClient"]
  navigate: (path: string) => void
  pickDirectory: () => Promise<string | undefined>
}

/**
 * Open a fresh host agent session seeded with an opening prompt, then navigate
 * to it. Shared by the New Sandbox chooser and the Agents workflow hub. Mirrors
 * askAgentAboutSandbox but is not tied to an existing sandbox.
 */
async function seedHostSession(deps: SeedSessionDeps, prompt: string) {
  const serverCtx = deps.global.createServerCtx(deps.conn)
  let directory: string | undefined = serverCtx.projects.last() ?? serverCtx.projects.list()[0]?.worktree
  if (!directory) directory = await deps.pickDirectory()
  if (!directory) return undefined

  serverCtx.projects.open(directory)
  serverCtx.projects.touch(directory)
  deps.layout.projects.open(directory)

  const client = deps.createClient({ directory, throwOnError: true })
  const created = await client.session.create({ directory })
  const session = created.data
  if (!session?.id) throw new Error("Failed to create session")

  await seedPromptDraft(deps.platform, directory, session.id, prompt)
  deps.navigate(`/${base64Encode(directory)}/session/${session.id}`)
  return session
}

/** "New sandbox" entry point: pick a runtime, an agent chat guides creation. */
export async function startSandboxSetupSession(input: SeedSessionDeps & { runtime: SandboxRuntime }) {
  return seedHostSession(input, AGENT_WORKFLOW_PROMPTS[input.runtime])
}

/** Agents workflow hub: launch a preset flow as a seeded agent chat. */
export async function startAgentWorkflow(input: SeedSessionDeps & { workflow: AgentWorkflow }) {
  return seedHostSession(input, AGENT_WORKFLOW_PROMPTS[input.workflow])
}
