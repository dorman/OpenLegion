import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { SandboxTerminal } from "@/components/session/sandbox-terminal"
import {
  containerIdsMatch,
  fetchContainerLogs,
  fetchContainerShell,
  getContainerNetwork,
  listContainersSafe,
  listRuntimesSafe,
  setContainerNetwork,
  snapshotContainer,
  startContainer,
  stopContainer,
  type ContainerInfo,
  type ContainerRuntime,
  type NetworkMode,
  type NetworkState,
  type RuntimeBackendStatus,
} from "@/utils/containers"
import { linkedSandboxFromMetadata, type LinkedSandboxContext } from "@/utils/container-workspaces"
import { capabilitiesFor, runtimeForKind } from "@/utils/sandbox-capabilities"
import { showToast } from "@/utils/toast"

export function SessionSandboxPanel(props: { metadata?: Record<string, unknown> }) {
  const language = useLanguage()
  const server = useServer()
  const queryClient = useQueryClient()
  const [logsText, setLogsText] = createSignal<string | undefined>(undefined)
  const [logsLoading, setLogsLoading] = createSignal(false)
  const [actionPending, setActionPending] = createSignal(false)
  const [shellCommand, setShellCommand] = createSignal<string | undefined>(undefined)
  const [shellLoading, setShellLoading] = createSignal(false)
  const [snapshotting, setSnapshotting] = createSignal(false)
  const [networkPending, setNetworkPending] = createSignal(false)

  const linked = createMemo(() => linkedSandboxFromMetadata(props.metadata))

  const http = createMemo(() => server.current?.http)

  const containers = createQuery(() => ({
    queryKey: ["containers", server.key],
    queryFn: () => listContainersSafe(http()!),
    enabled: !!http() && !!linked(),
    refetchInterval: 5_000,
    // Start with data so reading `.data` never suspends the surrounding route
    // while the first fetch is in flight (the panel renders inside a Suspense
    // boundary). See listContainersSafe for the matching error handling.
    initialData: [] as ContainerInfo[],
    // initialData marks the query "success", and the app-wide default is
    // refetchOnMount:false — without this the first real fetch wouldn't happen
    // until refetchInterval fired, leaving stale [] data on open.
    refetchOnMount: "always",
  }))

  const caps = createMemo(() => capabilitiesFor(linked()?.kind))
  const backend = createMemo(() => runtimeForKind(linked()?.kind, linked()?.runtime))

  const runtimes = createQuery(() => ({
    queryKey: ["runtimes", server.key],
    queryFn: () => listRuntimesSafe(http()!),
    enabled: !!http() && !!linked(),
    refetchInterval: 10_000,
    initialData: [] as RuntimeBackendStatus[],
    refetchOnMount: "always",
  }))

  // The backend this sandbox needs, when we have a reading that says it's down.
  const runtimeDown = createMemo(() => {
    const status = (runtimes.data ?? []).find((r) => r.id === backend())
    return status && !status.available ? status : undefined
  })

  const live = createMemo((): ContainerInfo | undefined => {
    const item = linked()
    if (!item) return undefined
    return (containers.data ?? []).find((c) => containerIdsMatch(c.id, item.id))
  })

  const running = createMemo(() => (live()?.status ?? "stopped") === "running")

  // Network isolation state for the linked sandbox. initialData + a
  // never-throwing queryFn keep this from suspending the route (see the
  // containers query note); enabled only once the sandbox actually exists.
  const network = createQuery(() => ({
    queryKey: ["container-network", server.key, linked()?.id],
    queryFn: () =>
      getContainerNetwork(http()!, linked()!.id).catch(
        () => ({ mode: "online", networks: [] }) as NetworkState,
      ),
    enabled: !!http() && !!live() && caps().networkIsolation,
    initialData: { mode: "online", networks: [] } as NetworkState,
    refetchOnMount: "always",
  }))
  const offline = createMemo(() => network.data?.mode === "offline")
  const pendingSetup = createMemo(() => {
    const item = linked()
    return !!item && item.id.startsWith("setup-") && !live()
  })

  createEffect(
    on(running, (isRunning) => {
      if (!isRunning) {
        setShellCommand(undefined)
        return
      }
      if (shellCommand()) return
      const conn = http()
      const item = linked()
      if (!conn || !item) return
      fetchContainerShell(conn, item.id)
        .then((info) => setShellCommand(info.command))
        .catch(() => {})
    }),
  )

  async function handleStart() {
    const conn = http()
    const item = linked()
    if (!conn || !item || actionPending()) return
    setActionPending(true)
    try {
      await startContainer(conn, item.id)
      await queryClient.invalidateQueries({ queryKey: ["containers", server.key] })
      showToast({ variant: "success", icon: "circle-check", title: "Sandbox started" })
    } catch (err) {
      showToast({ title: "Failed to start", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setActionPending(false)
    }
  }

  async function handleStop() {
    const conn = http()
    const item = linked()
    if (!conn || !item || actionPending()) return
    setActionPending(true)
    try {
      await stopContainer(conn, item.id)
      await queryClient.invalidateQueries({ queryKey: ["containers", server.key] })
      showToast({ variant: "success", icon: "circle-check", title: "Sandbox stopped" })
    } catch (err) {
      showToast({ title: "Failed to stop", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setActionPending(false)
    }
  }

  async function handleFetchLogs() {
    const conn = http()
    const item = linked()
    if (!conn || !item) return
    setLogsLoading(true)
    try {
      const logs = await fetchContainerLogs(conn, item.id, 50)
      setLogsText(logs || "(no logs)")
    } catch (err) {
      setLogsText(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLogsLoading(false)
    }
  }

  async function handleOpenShell() {
    const conn = http()
    const item = linked()
    if (!conn || !item || shellLoading()) return
    if (shellCommand()) {
      setShellCommand(undefined)
      return
    }
    setShellLoading(true)
    try {
      const info = await fetchContainerShell(conn, item.id)
      setShellCommand(info.command)
    } catch (err) {
      showToast({ title: "Failed to open shell", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setShellLoading(false)
    }
  }

  async function handleSnapshot() {
    const conn = http()
    const item = linked()
    if (!conn || !item || snapshotting()) return
    setSnapshotting(true)
    try {
      const snap = await snapshotContainer(conn, item.id)
      await queryClient.invalidateQueries({ queryKey: ["container-snapshots", server.key, item.id] })
      showToast({ variant: "success", icon: "circle-check", title: "Snapshot captured", description: snap.ref })
    } catch (err) {
      showToast({ title: "Failed to snapshot", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSnapshotting(false)
    }
  }

  async function handleSetNetwork(mode: NetworkMode) {
    const conn = http()
    const item = linked()
    if (!conn || !item || networkPending()) return
    setNetworkPending(true)
    try {
      await setContainerNetwork(conn, item.id, mode)
      await queryClient.invalidateQueries({ queryKey: ["container-network", server.key, item.id] })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: mode === "offline" ? "Sandbox isolated" : "Network restored",
      })
    } catch (err) {
      showToast({ title: "Failed to change network", description: err instanceof Error ? err.message : String(err) })
    } finally {
      setNetworkPending(false)
    }
  }

  const kindLabel = (item: LinkedSandboxContext) => {
    if (item.kind === "desktop") return "Desktop VM"
    if (item.kind === "kubernetes") return "Kubernetes"
    return "Container"
  }

  const runtimeLabel = (id: ContainerRuntime) =>
    id === "microvm" ? language.t("sandbox.runtime.microvm.label") : id === "podman" ? "Podman" : "Docker"
  const runtimeRemediation = (id: ContainerRuntime) => language.t(`sandbox.runtime.${id}.unavailable`)

  return (
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Show
        when={linked()}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-v2-text-text-muted">
            <p>No sandbox linked</p>
            <p class="text-xs">Start a sandbox session from the Sandboxes page to see controls here.</p>
          </div>
        }
      >
        {(item) => (
          <>
            <Show when={runtimeDown()}>
              {(status) => (
                <section class="flex items-start gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-deep p-3">
                  <div class="flex flex-col gap-1">
                    <h4 class="text-sm font-medium text-v2-text-text-base">
                      {language.t("sandbox.runtime.unavailable.title", { runtime: runtimeLabel(status().id) })}
                    </h4>
                    <p class="text-xs text-v2-text-text-muted">{runtimeRemediation(status().id)}</p>
                  </div>
                </section>
              )}
            </Show>

            <section class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-3">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-medium text-v2-text-text-base">{item().label}</h3>
                <span
                  classList={{
                    "desktop-pill": true,
                    "desktop-pill-success": running(),
                    "desktop-pill-stopped": !running() && !pendingSetup(),
                    "desktop-pill-container": pendingSetup(),
                  }}
                >
                  {pendingSetup() ? "Setting up" : running() ? "Running" : "Stopped"}
                </span>
              </div>

              <div class="flex flex-col gap-1 text-xs text-v2-text-text-muted">
                <Row label="Type" value={kindLabel(item())} />
                <Row label="Runtime" value={item().runtime ?? "unknown"} />
                <Show when={!pendingSetup()}>
                  <Row label="ID" value={item().id.slice(0, 16)} />
                </Show>
                <Show when={live()?.image}>
                  <Row label="Image" value={live()!.image} />
                </Show>
              </div>

              <Show when={pendingSetup()}>
                <p class="text-xs text-v2-text-text-muted">
                  Send the prompt below to have the agent create and configure this sandbox for you.
                </p>
              </Show>
            </section>

            <Show when={!pendingSetup()}>
              <section class="flex flex-col gap-2">
                <h4 class="text-xs font-medium uppercase tracking-wide text-v2-text-text-muted">Actions</h4>
                <div class="flex flex-wrap gap-2">
                  <Show
                    when={running()}
                    fallback={
                      <ButtonV2
                        variant="accent"
                        size="small"
                        onClick={() => void handleStart()}
                        disabled={actionPending() || !live()}
                      >
                        {actionPending() ? "Starting..." : "Start"}
                      </ButtonV2>
                    }
                  >
                    <ButtonV2
                      variant="neutral"
                      size="small"
                      onClick={() => void handleStop()}
                      disabled={actionPending()}
                    >
                      {actionPending() ? "Stopping..." : "Stop"}
                    </ButtonV2>
                  </Show>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    onClick={() => void handleFetchLogs()}
                    disabled={logsLoading() || !live()}
                  >
                    {logsLoading() ? "Loading..." : "View logs"}
                  </ButtonV2>
                  <Show when={caps().exec}>
                    <ButtonV2
                      variant={shellCommand() ? "neutral" : "ghost"}
                      size="small"
                      onClick={() => void handleOpenShell()}
                      disabled={shellLoading() || !running()}
                    >
                      {shellLoading() ? "Opening..." : shellCommand() ? "Close shell" : "Shell"}
                    </ButtonV2>
                  </Show>
                  <Show when={caps().snapshot}>
                    <ButtonV2
                      variant="ghost"
                      size="small"
                      onClick={() => void handleSnapshot()}
                      disabled={snapshotting() || !live()}
                    >
                      {snapshotting() ? "Snapshotting..." : "Snapshot"}
                    </ButtonV2>
                  </Show>
                </div>
              </section>

              <Show when={caps().networkIsolation && !!live()}>
                <section class="flex flex-col gap-2">
                  <h4 class="text-xs font-medium uppercase tracking-wide text-v2-text-text-muted">Network</h4>
                  <div class="flex items-center justify-between gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-3">
                    <div class="flex flex-col gap-0.5">
                      <span class="text-sm text-v2-text-text-base">{offline() ? "Isolated" : "Online"}</span>
                      <span class="text-xs text-v2-text-text-muted">
                        {offline()
                          ? "No network access — the sandbox is cut off from everything."
                          : "The sandbox can reach the network."}
                      </span>
                    </div>
                    <ButtonV2
                      variant={offline() ? "accent" : "neutral"}
                      size="small"
                      onClick={() => void handleSetNetwork(offline() ? "online" : "offline")}
                      disabled={networkPending()}
                    >
                      {networkPending() ? "..." : offline() ? "Go online" : "Isolate"}
                    </ButtonV2>
                  </div>
                </section>
              </Show>
            </Show>

            <Show when={shellCommand()}>
              {(cmd) => (
                <section class="flex min-h-0 flex-1 flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <h4 class="text-xs font-medium uppercase tracking-wide text-v2-text-text-muted">Terminal</h4>
                    <ButtonV2 variant="ghost" size="small" onClick={() => setShellCommand(undefined)}>
                      Close
                    </ButtonV2>
                  </div>
                  <SandboxTerminal command={cmd()} />
                </section>
              )}
            </Show>

            <Show when={!shellCommand() && logsText() !== undefined}>
              <section class="flex min-h-0 flex-1 flex-col gap-2">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-medium uppercase tracking-wide text-v2-text-text-muted">
                    Logs (last 50 lines)
                  </h4>
                  <ButtonV2 variant="ghost" size="small" onClick={() => setLogsText(undefined)}>
                    Close
                  </ButtonV2>
                </div>
                <pre class="min-h-0 flex-1 overflow-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-deep p-2 font-mono text-[11px] leading-relaxed text-v2-text-text-muted">
                  {logsText()}
                </pre>
              </section>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function Row(props: { label: string; value: string }) {
  return (
    <div class="flex justify-between gap-2">
      <span class="shrink-0 text-v2-text-text-faint">{props.label}</span>
      <span class="truncate text-right text-v2-text-text-muted">{props.value}</span>
    </div>
  )
}
