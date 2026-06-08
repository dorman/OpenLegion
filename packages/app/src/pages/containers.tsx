import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Spinner } from "@openlegion-ai/ui/spinner"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { Navigate, useNavigate } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { DialogContainerCreate } from "@/components/dialog-container-create"
import { DialogContainerInspect } from "@/components/dialog-container-inspect"
import { DialogContainerOpenSession } from "@/components/dialog-container-open-session"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { openContainerSession } from "@/utils/container-session"
import {
  listContainerWorkspaces,
  upsertContainerWorkspace,
  workspaceForContainer,
  type ContainerWorkspace,
} from "@/utils/container-workspaces"
import {
  createContainer,
  listContainers,
  removeContainer,
  stopContainer,
  type ContainerCreateInput,
  type ContainerInfo,
} from "@/utils/containers"

function containerLabel(item: ContainerInfo) {
  if (item.name) return item.name
  return item.id.slice(0, 12)
}

function containerNetwork(item: ContainerInfo) {
  if (item.runtime === "microvm") return "containers.network.isolated"
  return "containers.network.bridge"
}

function activeAgentWorkspace(workspaces: ContainerWorkspace[]) {
  return workspaces.find((item) => item.sessionId)
}

export default function ContainersPage() {
  const platform = usePlatform()
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const navigate = useNavigate()
  const dialog = useDialog()
  const queryClient = useQueryClient()

  const enabled = createMemo(() => platform.platform === "desktop" && server.isLocal() && !!server.current?.http)

  const containers = useQuery(() => ({
    queryKey: ["containers", server.key],
    enabled: enabled(),
    refetchInterval: 5_000,
    queryFn: async () => {
      const http = server.current?.http
      if (!http) return [] as ContainerInfo[]
      return listContainers(http)
    },
  }))

  const workspaces = useQuery(() => ({
    queryKey: ["container-workspaces", server.key],
    enabled: enabled(),
    queryFn: async () => {
      const http = server.current?.http
      if (!http) return []
      return listContainerWorkspaces(http)
    },
  }))

  const runtime = useQuery(() => ({
    queryKey: ["containers", "runtime"],
    enabled: platform.platform === "desktop",
    queryFn: async () => platform.containerRuntimeStatus?.(),
  }))

  const activeCount = createMemo(
    () => (containers.data ?? []).filter((item) => (item.status ?? "running") === "running").length,
  )

  const agentWorkspace = createMemo(() => activeAgentWorkspace(workspaces.data ?? []))

  if (platform.platform !== "desktop") {
    return <Navigate href="/" />
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["containers"] })
  }

  async function handleCreate(input: ContainerCreateInput) {
    const http = server.current?.http
    if (!http) throw new Error(language.t("containers.error.noServer"))
    const created = await createContainer(http, input)
    const volume = input.volumes?.[0]
    await upsertContainerWorkspace(http, created.id, {
      image: created.image,
      name: created.name,
      runtime: created.runtime,
      hostMount: volume?.host,
      containerMount: volume?.container,
    })
    await refresh()
  }

  async function handleOpenSession(container: ContainerInfo, projectDirectory: string) {
    const http = server.current?.http
    const conn = server.current
    if (!http || !conn) throw new Error(language.t("containers.error.noServer"))

    await openContainerSession({
      http,
      conn,
      container,
      workspace: workspaceForContainer(workspaces.data ?? [], container),
      projectDirectory,
      global,
      layout,
      createClient: serverSDK.createClient,
      navigate,
    }).catch((err) => {
      if (err instanceof Error && err.message.startsWith("Container is not available")) {
        throw new Error(language.t("containers.error.unavailable"))
      }
      throw err
    })
    await queryClient.invalidateQueries({ queryKey: ["container-workspaces"] })
  }

  function showOpenSession(container: ContainerInfo) {
    dialog.show(() => (
      <DialogContainerOpenSession
        container={container}
        workspace={workspaceForContainer(workspaces.data ?? [], container)}
        onOpen={(projectDirectory) => handleOpenSession(container, projectDirectory)}
      />
    ))
  }

  function showInspect(container: ContainerInfo) {
    dialog.show(() => <DialogContainerInspect container={container} />)
  }

  async function handleStop(id: string) {
    const http = server.current?.http
    if (!http) return
    await stopContainer(http, id)
    await refresh()
  }

  async function handleRemove(id: string) {
    const http = server.current?.http
    if (!http) return
    await removeContainer(http, id)
    await refresh()
  }

  async function ensureDaemon() {
    await platform.ensureMicrovmDaemon?.()
    await runtime.refetch()
    await refresh()
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-deep">
      <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-8 py-10">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <h1 class="text-xl text-v2-text-text-base">{language.t("containers.running.title")}</h1>
            <Show when={activeCount() > 0}>
              <span class="desktop-pill desktop-pill-success">
                {language.t("containers.running.active", { count: activeCount() })}
              </span>
            </Show>
          </div>
          <div class="flex flex-wrap gap-2">
            <Show when={platform.ensureMicrovmDaemon !== undefined}>
              <ButtonV2 variant="neutral" onClick={() => void ensureDaemon()}>
                {language.t("containers.ensureDaemon")}
              </ButtonV2>
            </Show>
            <ButtonV2
              onClick={() => dialog.show(() => <DialogContainerCreate onCreate={handleCreate} />)}
              disabled={!enabled()}
            >
              {language.t("containers.new")}
            </ButtonV2>
          </div>
        </header>

        <section class="flex min-h-0 flex-1 flex-col gap-3">
          <Show when={!containers.isLoading} fallback={<div class="flex justify-center p-10"><Spinner /></div>}>
            <Show
              when={(containers.data?.length ?? 0) > 0}
              fallback={<div class="py-10 text-center text-sm text-v2-text-text-muted">{language.t("containers.empty")}</div>}
            >
              <For each={containers.data ?? []}>
                {(item) => (
                  <ContainerCard
                    item={item}
                    workspace={workspaceForContainer(workspaces.data ?? [], item)}
                    language={language}
                    onOpenSession={() => showOpenSession(item)}
                    onInspect={() => showInspect(item)}
                    onStop={() => void handleStop(item.id)}
                    onRemove={() => void handleRemove(item.id)}
                  />
                )}
              </For>
            </Show>
          </Show>
          <Show when={containers.error}>
            <div class="text-sm text-v2-text-text-danger">
              {containers.error instanceof Error ? containers.error.message : String(containers.error)}
            </div>
          </Show>
        </section>

        <section class="desktop-agent-card mt-auto">
          <Show
            when={agentWorkspace()}
            fallback={<div class="text-sm text-v2-text-text-muted">{language.t("containers.agentSession.empty")}</div>}
          >
            {(workspace) => (
              <div class="flex flex-col gap-2">
                <div class="text-sm" style={{ color: "var(--desktop-agent-accent)" }}>
                  {language.t("containers.agentSession.title")} · plan
                </div>
                <p class="text-sm leading-relaxed text-v2-text-text-muted">
                  {workspace().hostMount
                    ? `Workspace mounted at ${workspace().containerMount ?? "/workspace"} from ${workspace().hostMount}`
                    : language.t("containers.agentSession.empty")}
                </p>
              </div>
            )}
          </Show>
        </section>
      </div>
    </div>
  )
}

function ContainerCard(props: {
  item: ContainerInfo
  workspace?: ContainerWorkspace
  language: ReturnType<typeof useLanguage>
  onOpenSession: () => void
  onInspect: () => void
  onStop: () => void
  onRemove: () => void
}) {
  const running = () => (props.item.status ?? "running") === "running"

  return (
    <article class="desktop-container-card">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 font-mono text-sm text-v2-text-text-base">{containerLabel(props.item)}</div>
        <span
          classList={{
            "desktop-pill": true,
            "desktop-pill-running": running(),
            "desktop-pill-stopped": !running(),
          }}
        >
          {props.language.t(running() ? "containers.status.running" : "containers.status.stopped")}
        </span>
      </div>
      <div class="text-xs text-v2-text-text-muted">{props.language.t(containerNetwork(props.item))}</div>
      <div class="mt-2 flex flex-wrap gap-2">
        <ButtonV2 variant="ghost" size="normal" onClick={props.onOpenSession}>
          {props.language.t("containers.openSession")}
        </ButtonV2>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onInspect}>
          {props.language.t("containers.inspect")}
        </ButtonV2>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onStop} disabled={!running()}>
          {props.language.t("containers.stop")}
        </ButtonV2>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onRemove}>
          {props.language.t("containers.remove")}
        </ButtonV2>
      </div>
    </article>
  )
}
