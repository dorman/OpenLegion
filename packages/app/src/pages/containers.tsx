import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Spinner } from "@openlegion-ai/ui/spinner"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { useQuery, useQueryClient } from "@tanstack/solid-query"
import { Navigate, useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { DialogChooseRuntime } from "@/components/dialog-choose-runtime"
import { DialogContainerInspect } from "@/components/dialog-container-inspect"
import { DialogContainerOpenSession } from "@/components/dialog-container-open-session"
import {
  DialogContainersOnboarding,
  dismissOnboarding,
  readOnboardingDismissed,
} from "@/components/containers-onboarding"
import { ContainersComposePanel } from "@/components/containers-compose"
import { GuidedEmptyCards } from "@/components/guided-empty-cards"
import { RuntimeStatusPills } from "@/components/runtime-pill"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import {
  askAgentAboutSandbox,
  openContainerSession,
  startSandboxSetupSession,
  type SandboxRuntime,
} from "@/utils/container-session"
import {
  listContainerWorkspaces,
  workspaceForContainer,
  type ContainerWorkspace,
} from "@/utils/container-workspaces"
import {
  listContainers,
  removeContainer,
  startContainer,
  stopContainer,
  type ContainerInfo,
} from "@/utils/containers"
import {
  isAgentCapable,
  isInSandboxAgentCapable,
  isDesktopWorkload,
  workloadKindKey,
  workloadPillClass,
} from "@/utils/container-workload"
import { warningsForWorkspaceHostMount } from "@/utils/sandbox-config-warnings"
import { dismissToast, showToast } from "@/utils/toast"

type StatusFilter = "all" | "running" | "stopped"
type KindFilter = "all" | "container" | "desktop"

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

function matchesFilters(item: ContainerInfo, statusFilter: StatusFilter, kindFilter: KindFilter) {
  const running = (item.status ?? "stopped") === "running"
  if (statusFilter === "running" && !running) return false
  if (statusFilter === "stopped" && running) return false
  if (kindFilter === "container" && isDesktopWorkload(item)) return false
  if (kindFilter === "desktop" && !isDesktopWorkload(item)) return false
  return true
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
  const [ensuringDaemon, setEnsuringDaemon] = createSignal(false)
  const [selectedIds, setSelectedIds] = createSignal<string[]>([])
  const [statusFilter, setStatusFilter] = createSignal<StatusFilter>("all")
  const [kindFilter, setKindFilter] = createSignal<KindFilter>("all")
  const [bulkPending, setBulkPending] = createSignal(false)
  const [startingIds, setStartingIds] = createSignal<string[]>([])
  const [stoppingIds, setStoppingIds] = createSignal<string[]>([])
  let onboardingDismissedThisSession = false

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

  const daemonReady = createMemo(() => runtime.data?.microvm === true)
  // A remote daemon's lifecycle is managed on its host, not from this app.
  const remoteHost = createMemo(() => runtime.data?.microvmRemote === true)
  // host:port of the daemon these sandboxes live on (for the header indicator).
  const daemonHost = createMemo(() => {
    const url = runtime.data?.microvmUrl
    if (!url) return undefined
    try {
      return new URL(url).host
    } catch {
      return url
    }
  })

  const filteredContainers = createMemo(() =>
    (containers.data ?? []).filter((item) => matchesFilters(item, statusFilter(), kindFilter())),
  )

  const activeCount = createMemo(
    () => (containers.data ?? []).filter((item) => (item.status ?? "stopped") === "running").length,
  )

  const agentWorkspace = createMemo(() => activeAgentWorkspace(workspaces.data ?? []))

  const canCreate = createMemo(() => enabled() && runtime.data?.arch !== undefined)

  const allVisibleSelected = createMemo(() => {
    const items = filteredContainers()
    if (items.length === 0) return false
    const selected = new Set(selectedIds())
    return items.every((item) => selected.has(item.id))
  })

  function showCreateDialog() {
    dialog.show(() => <DialogChooseRuntime onChoose={(runtime) => void handleChooseRuntime(runtime)} />)
  }

  // New sandbox creation is agent-guided: picking a runtime opens an agent chat
  // seeded with that runtime's setup goal, rather than a form.
  async function handleChooseRuntime(runtimeKind: SandboxRuntime) {
    const conn = server.current
    if (!conn) throw new Error(language.t("containers.error.noServer"))
    return startSandboxSetupSession({
      conn,
      runtime: runtimeKind,
      platform,
      global,
      layout,
      createClient: serverSDK.createClient,
      navigate,
      pickDirectory: async () => {
        const host = await platform.openDirectoryPickerDialog?.({
          title: language.t("containers.openSession.pickProject"),
        })
        if (!host || Array.isArray(host)) return undefined
        return host
      },
    })
  }

  if (platform.platform !== "desktop") {
    return <Navigate href="/" />
  }

  function markOnboardingDismissed() {
    onboardingDismissedThisSession = true
    void dismissOnboarding(platform.storage)
  }

  function showOnboardingDialog() {
    dialog.show(
      () => (
        <DialogContainersOnboarding
          runtime={() => runtime.data}
          daemonReady={daemonReady}
          sandboxCount={() => containers.data?.length ?? 0}
          onEnsureDaemon={() => void ensureDaemon()}
          onCreate={showCreateDialog}
          ensuringDaemon={ensuringDaemon}
        />
      ),
      markOnboardingDismissed,
    )
  }

  // First launch after install: open the get-started guide until it is
  // dismissed. Closing the dialog marks it dismissed; the header's
  // "Get started" button reopens it anytime. The flag read is async (desktop
  // storage goes over IPC), so bail out if the page unmounted in the meantime
  // rather than opening the dialog over whatever the user navigated to.
  onMount(() => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void readOnboardingDismissed(platform.storage).then(async (dismissed) => {
      if (cancelled || onboardingDismissedThisSession || dismissed) return
      const stillDismissed = await readOnboardingDismissed(platform.storage)
      if (cancelled || onboardingDismissedThisSession || stillDismissed) return
      showOnboardingDialog()
    })
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["containers"] })
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

  async function handleAskAgent(container: ContainerInfo) {
    const conn = server.current
    if (!conn) throw new Error(language.t("containers.error.noServer"))
    return askAgentAboutSandbox({
      conn,
      container,
      platform,
      global,
      layout,
      createClient: serverSDK.createClient,
      navigate,
      pickDirectory: async () => {
        const host = await platform.openDirectoryPickerDialog?.({
          title: language.t("containers.openSession.pickProject"),
        })
        if (!host || Array.isArray(host)) return undefined
        return host
      },
    })
  }

  function showInspect(container: ContainerInfo) {
    dialog.show(() => (
      <DialogContainerInspect container={container} onStart={refresh} onAskAgent={() => handleAskAgent(container)} />
    ))
  }

  async function handleStart(id: string) {
    const http = server.current?.http
    if (!http || startingIds().includes(id)) return
    setStartingIds((current) => [...current, id])
    const toastId = showToast({
      variant: "loading",
      title: language.t("containers.start.inProgress"),
    })
    try {
      await startContainer(http, id)
      await refresh()
      dismissToast(toastId)
      showToast({
        variant: "success",
        title: language.t("containers.started"),
      })
    } catch (err) {
      dismissToast(toastId)
      showToast({
        variant: "error",
        title: language.t("containers.start.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStartingIds((current) => current.filter((item) => item !== id))
    }
  }

  async function handleStop(id: string) {
    const http = server.current?.http
    if (!http || stoppingIds().includes(id)) return
    setStoppingIds((current) => [...current, id])
    const toastId = showToast({
      variant: "loading",
      title: language.t("containers.stop.inProgress"),
    })
    try {
      await stopContainer(http, id)
      await refresh()
      dismissToast(toastId)
      showToast({
        variant: "success",
        title: language.t("containers.stopped"),
      })
    } catch (err) {
      dismissToast(toastId)
      showToast({
        variant: "error",
        title: language.t("containers.stop.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStoppingIds((current) => current.filter((item) => item !== id))
    }
  }

  async function handleRemove(id: string) {
    const http = server.current?.http
    if (!http) return
    await removeContainer(http, id)
    setSelectedIds((current) => current.filter((item) => item !== id))
    await refresh()
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected()) {
      const visible = new Set(filteredContainers().map((item) => item.id))
      setSelectedIds((current) => current.filter((item) => !visible.has(item)))
      return
    }
    const next = new Set(selectedIds())
    for (const item of filteredContainers()) next.add(item.id)
    setSelectedIds([...next])
  }

  async function runBulk(action: "start" | "stop" | "remove") {
    const http = server.current?.http
    const ids = selectedIds()
    if (!http || ids.length === 0 || bulkPending()) return

    setBulkPending(true)
    if (action === "start") setStartingIds((current) => [...new Set([...current, ...ids])])
    if (action === "stop") setStoppingIds((current) => [...new Set([...current, ...ids])])
    try {
      for (const id of ids) {
        if (action === "start") await startContainer(http, id)
        if (action === "stop") await stopContainer(http, id)
        if (action === "remove") await removeContainer(http, id)
      }
      if (action === "remove") setSelectedIds([])
      await refresh()
      showToast({
        variant: "success",
        title: language.t(`containers.bulk.${action}Done`, { count: ids.length }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t(`containers.bulk.${action}Failed`),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBulkPending(false)
      if (action === "start") setStartingIds((current) => current.filter((item) => !ids.includes(item)))
      if (action === "stop") setStoppingIds((current) => current.filter((item) => !ids.includes(item)))
    }
  }

  async function ensureDaemon() {
    if (ensuringDaemon()) return
    setEnsuringDaemon(true)
    try {
      const result = await platform.ensureMicrovmDaemon?.()
      if (!result) {
        showToast({
          variant: "error",
          title: language.t("containers.ensureDaemon.failed"),
          description: "Desktop sandbox controls are unavailable.",
        })
        return
      }
      if (!result.ok) {
        showToast({
          variant: "error",
          title: language.t("containers.ensureDaemon.failed"),
          description: result.error,
        })
        return
      }
      showToast({
        variant: "success",
        title: language.t("containers.ensureDaemon.ready"),
        description: result.url,
      })
      await runtime.refetch()
      await refresh()
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("containers.ensureDaemon.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setEnsuringDaemon(false)
    }
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-v2-background-bg-deep">
      <div class="mx-auto flex w-full max-w-7xl flex-1 items-stretch gap-6 px-8 py-10">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
          <header class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <h1 class="text-xl text-v2-text-text-base">{language.t("containers.title")}</h1>
              <Show when={activeCount() > 0}>
                <span class="desktop-pill desktop-pill-success">
                  {language.t("containers.running.active", { count: activeCount() })}
                </span>
              </Show>
              {/* Where these sandboxes live: the local daemon or a connected
                  research host (the micro-VM daemon URL the app is pointed at). */}
              <Show when={runtime.data}>
                <span
                  classList={{
                    "desktop-pill": true,
                    "desktop-pill-success": remoteHost() && daemonReady(),
                    "desktop-pill-stopped": remoteHost() && !daemonReady(),
                  }}
                  title={runtime.data?.microvmUrl}
                >
                  {remoteHost()
                    ? language.t("containers.host.remote", { host: daemonHost() ?? "" })
                    : language.t("containers.host.local")}
                </span>
              </Show>
            </div>
            <div class="flex flex-wrap gap-2">
              <ButtonV2 variant="ghost" onClick={() => showOnboardingDialog()}>
                {language.t("containers.onboarding.open")}
              </ButtonV2>
              <Show when={platform.ensureMicrovmDaemon !== undefined && !remoteHost()}>
                <ButtonV2 variant="neutral" onClick={() => void ensureDaemon()} disabled={ensuringDaemon()}>
                  {ensuringDaemon()
                    ? language.t("containers.ensureDaemon.starting")
                    : language.t("containers.ensureDaemon")}
                </ButtonV2>
              </Show>
              <ButtonV2 onClick={() => showCreateDialog()} disabled={!canCreate()}>
                {language.t("containers.new")}
              </ButtonV2>
            </div>
          </header>

          <ContainersComposePanel onChanged={refresh} />

          <section class="flex min-h-0 flex-1 flex-col gap-3">
            <Show
              when={!containers.isLoading}
              fallback={
                <div class="flex justify-center p-10">
                  <Spinner />
                </div>
              }
            >
              <Show
                when={(containers.data?.length ?? 0) > 0}
                fallback={
                  <div class="flex flex-col gap-4 py-4">
                    <div class="text-center">
                      <h2 class="text-sm font-medium text-v2-text-text-base">{language.t("containers.empty.title")}</h2>
                      <p class="mt-1 text-sm text-v2-text-text-muted">{language.t("containers.empty")}</p>
                    </div>
                    <GuidedEmptyCards
                      actions={[
                        {
                          titleKey: "containers.empty.createSandbox.title",
                          descriptionKey: "containers.empty.createSandbox.description",
                          actionKey: "containers.empty.createSandbox.action",
                          onClick: showCreateDialog,
                          disabled: !canCreate(),
                        },
                        {
                          titleKey: "containers.empty.startDaemon.title",
                          descriptionKey: "containers.empty.startDaemon.description",
                          actionKey: "containers.empty.startDaemon.action",
                          onClick: () => void ensureDaemon(),
                          disabled: ensuringDaemon() || daemonReady(),
                        },
                        {
                          titleKey: "containers.empty.openSession.title",
                          descriptionKey: "containers.empty.openSession.description",
                          actionKey: "containers.empty.openSession.action",
                          onClick: () => navigate("/agents"),
                        },
                      ]}
                    />
                  </div>
                }
              >
                <Show
                  when={filteredContainers().length > 0}
                  fallback={
                    <div class="py-10 text-center text-sm text-v2-text-text-muted">
                      {language.t("containers.filter.noResults")}
                    </div>
                  }
                >
                  {/* Responsive card grid: one column on narrow windows, up to
                      three across once there's room beside the sidebar. */}
                  <div class="grid min-h-0 grid-cols-1 content-start gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
                    <For each={filteredContainers()}>
                      {(item) => (
                        <ContainerCard
                          item={item}
                          workspace={workspaceForContainer(workspaces.data ?? [], item)}
                          selected={selectedIds().includes(item.id)}
                          starting={startingIds().includes(item.id)}
                          stopping={stoppingIds().includes(item.id)}
                          language={language}
                          onToggleSelected={() => toggleSelected(item.id)}
                          onOpenSession={() => showOpenSession(item)}
                          onAskAgent={() => void handleAskAgent(item)}
                          onInspect={() => showInspect(item)}
                          onStart={() => void handleStart(item.id)}
                          onStop={() => void handleStop(item.id)}
                          onRemove={() => void handleRemove(item.id)}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Show>
            <Show when={containers.error}>
              <div class="text-sm text-v2-text-text-danger">
                {containers.error instanceof Error ? containers.error.message : String(containers.error)}
              </div>
            </Show>
          </section>
        </div>

        <aside class="flex w-64 shrink-0 flex-col gap-4">
          <Show when={runtime.data}>
            {(status) => (
              <div class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-4">
                <div class="text-sm text-v2-text-text-muted">{language.t("containers.runtime.title")}</div>
                <RuntimeStatusPills status={status()} />
                <Show when={!daemonReady()}>
                  <p class="text-sm text-v2-text-text-muted">{language.t("containers.description")}</p>
                </Show>
              </div>
            )}
          </Show>

          <section class="desktop-agent-card">
            <Show
              when={agentWorkspace()}
              fallback={
                <div class="text-sm text-v2-text-text-muted">{language.t("containers.agentSession.empty")}</div>
              }
            >
              {(workspace) => (
                <div class="flex flex-col gap-2">
                  <div class="desktop-agent-accent text-sm font-medium">
                    {language.t("containers.agentSession.title")}
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

          <Show when={(containers.data?.length ?? 0) > 0}>
            <div class="flex flex-col gap-3 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-4">
              <label class="flex flex-col gap-1 text-sm">
                <span class="text-v2-text-text-muted">{language.t("containers.filter.status")}</span>
                <select
                  class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                  value={statusFilter()}
                  onChange={(event) => setStatusFilter(event.currentTarget.value as StatusFilter)}
                >
                  <option value="all">{language.t("containers.filter.status.all")}</option>
                  <option value="running">{language.t("containers.filter.status.running")}</option>
                  <option value="stopped">{language.t("containers.filter.status.stopped")}</option>
                </select>
              </label>
              <label class="flex flex-col gap-1 text-sm">
                <span class="text-v2-text-text-muted">{language.t("containers.filter.kind")}</span>
                <select
                  class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                  value={kindFilter()}
                  onChange={(event) => setKindFilter(event.currentTarget.value as KindFilter)}
                >
                  <option value="all">{language.t("containers.filter.kind.all")}</option>
                  <option value="container">{language.t("containers.filter.kind.container")}</option>
                  <option value="desktop">{language.t("containers.filter.kind.desktop")}</option>
                </select>
              </label>

              <label class="flex items-center gap-2 text-sm text-v2-text-text-muted">
                <input type="checkbox" checked={allVisibleSelected()} onChange={() => toggleSelectAllVisible()} />
                {language.t("containers.bulk.selectAll")}
              </label>
              <Show when={selectedIds().length > 0}>
                <div class="flex flex-col items-start gap-2">
                  <span class="text-sm text-v2-text-text-muted">
                    {language.t("containers.bulk.selected", { count: selectedIds().length })}
                  </span>
                  <div class="flex flex-wrap gap-2">
                    <ButtonV2
                      variant="ghost"
                      size="normal"
                      disabled={bulkPending()}
                      onClick={() => void runBulk("start")}
                    >
                      {language.t("containers.bulk.start")}
                    </ButtonV2>
                    <ButtonV2
                      variant="ghost"
                      size="normal"
                      disabled={bulkPending()}
                      onClick={() => void runBulk("stop")}
                    >
                      {language.t("containers.bulk.stop")}
                    </ButtonV2>
                    <ButtonV2
                      variant="ghost"
                      size="normal"
                      disabled={bulkPending()}
                      onClick={() => void runBulk("remove")}
                    >
                      {language.t("containers.bulk.remove")}
                    </ButtonV2>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </aside>
      </div>
    </div>
  )
}

function ContainerCard(props: {
  item: ContainerInfo
  workspace?: ContainerWorkspace
  selected: boolean
  starting: boolean
  stopping: boolean
  language: ReturnType<typeof useLanguage>
  onToggleSelected: () => void
  onOpenSession: () => void
  onAskAgent: () => void
  onInspect: () => void
  onStart: () => void
  onStop: () => void
  onRemove: () => void
}) {
  const running = () => (props.item.status ?? "stopped") === "running"
  const inSandboxAgent = () => isInSandboxAgentCapable(props.item)
  const hostAgent = () => isAgentCapable(props.item)
  const warnings = createMemo(() => warningsForWorkspaceHostMount(props.workspace?.hostMount))

  return (
    <article class="desktop-container-card">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            class="mt-1"
            checked={props.selected}
            onChange={() => props.onToggleSelected()}
            aria-label={containerLabel(props.item)}
          />
          <div class="min-w-0 font-mono text-sm text-v2-text-text-base">{containerLabel(props.item)}</div>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <span class={workloadPillClass(props.item)}>{props.language.t(workloadKindKey(props.item))}</span>
          <Show when={props.workspace?.sessionId}>
            <span class="desktop-pill desktop-pill-success">{props.language.t("containers.badge.agentLinked")}</span>
          </Show>
          <Show when={warnings().length > 0}>
            <span class="desktop-pill desktop-pill-stopped">{props.language.t("containers.warnings.badge")}</span>
          </Show>
          <span
            classList={{
              "desktop-pill": true,
              "desktop-pill-running": running(),
              "desktop-pill-stopped": !running(),
            }}
          >
            {props.language.t(
              props.stopping && running()
                ? "containers.status.stopping"
                : props.starting && !running()
                  ? "containers.status.starting"
                  : running()
                    ? "containers.status.running"
                    : "containers.status.stopped",
            )}
          </span>
        </div>
      </div>
      <div class="text-xs text-v2-text-text-muted">
        {props.item.image}
        <span class="mx-2">·</span>
        {props.language.t(containerNetwork(props.item))}
      </div>
      <Show when={warnings().length > 0}>
        <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-v2-text-text-muted">
          <For each={warnings()}>{(warning) => <li>{props.language.t(warning.messageKey)}</li>}</For>
        </ul>
      </Show>
      <Show when={!inSandboxAgent()}>
        <p class="mt-2 text-xs leading-relaxed text-v2-text-text-muted">
          {props.language.t(hostAgent() ? "containers.desktop.hostAgentHint" : "containers.desktop.agentHint")}
        </p>
      </Show>
      <div class="mt-2 flex flex-wrap gap-2">
        <ButtonV2 variant="ghost" size="normal" onClick={props.onOpenSession} disabled={!inSandboxAgent()}>
          {props.language.t("containers.openSession")}
        </ButtonV2>
        <Show when={hostAgent()}>
          <ButtonV2 variant="ghost" size="normal" onClick={props.onAskAgent} disabled={!running()}>
            {props.language.t("containers.askAgent")}
          </ButtonV2>
        </Show>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onInspect}>
          {props.language.t("containers.inspect")}
        </ButtonV2>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onStart} disabled={running() || props.starting}>
          {props.language.t(props.starting ? "containers.starting" : "containers.start")}
        </ButtonV2>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onStop} disabled={!running() || props.stopping}>
          {props.language.t(props.stopping ? "containers.stopping" : "containers.stop")}
        </ButtonV2>
        <ButtonV2 variant="ghost" size="normal" onClick={props.onRemove}>
          {props.language.t("containers.remove")}
        </ButtonV2>
      </div>
    </article>
  )
}
