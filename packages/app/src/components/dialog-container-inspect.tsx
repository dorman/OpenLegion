import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { Spinner } from "@openlegion-ai/ui/spinner"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { ContainerBrowser } from "@/components/container-browser"
import { ContainerDisplay } from "@/components/container-display"
import { ContainerTerminal } from "@/components/container-terminal"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import {
  containerIdsMatch,
  fetchContainerDisplay,
  fetchContainerLogs,
  fetchContainerShell,
  listContainers,
  type ContainerDisplayInfo,
  startContainer,
  type ContainerInfo,
} from "@/utils/containers"
import { inspectDefaultTab, isDesktopWorkload } from "@/utils/container-workload"
import { listSandboxAuditEntries } from "@/utils/sandbox-audit"
import { dismissToast, showToast } from "@/utils/toast"

type InspectTab = "logs" | "shell" | "display" | "audit"

const INSPECT_TAB_KEY = "containers.inspect.tab"

function readPersistedTab(containerId: string, fallback: InspectTab) {
  try {
    const raw = localStorage.getItem(`${INSPECT_TAB_KEY}.${containerId}`)
    if (raw === "logs" || raw === "shell" || raw === "display" || raw === "audit") return raw
  } catch {}
  return fallback
}

function writePersistedTab(containerId: string, tab: InspectTab) {
  try {
    localStorage.setItem(`${INSPECT_TAB_KEY}.${containerId}`, tab)
  } catch {}
}

function defaultShellCommand(container: ContainerInfo) {
  const target = container.name ?? container.id
  return `docker exec -i ${target} sh`
}

export function DialogContainerInspect(props: {
  container: ContainerInfo
  onStart?: () => Promise<void>
  onAskAgent?: () => Promise<unknown>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const defaultTab = inspectDefaultTab(props.container)
  const [tab, setTabState] = createSignal<InspectTab>(readPersistedTab(props.container.id, defaultTab))
  const setTab = (next: InspectTab) => {
    setTabState(next)
    writePersistedTab(props.container.id, next)
  }
  const [logs, setLogs] = createSignal("")
  const [shellCommand, setShellCommand] = createSignal<string | undefined>()
  const [logsError, setLogsError] = createSignal<string | undefined>()
  const [shellError, setShellError] = createSignal<string | undefined>()
  const [display, setDisplay] = createSignal<ContainerDisplayInfo | undefined>()
  const [displayError, setDisplayError] = createSignal<string | undefined>()
  const [displayLoading, setDisplayLoading] = createSignal(false)
  const [logsLoading, setLogsLoading] = createSignal(true)
  const [autoRefresh, setAutoRefresh] = createSignal(true)
  const [starting, setStarting] = createSignal(false)
  const [askingAgent, setAskingAgent] = createSignal(false)
  const [displayFullscreen, setDisplayFullscreen] = createSignal(false)
  const [status, setStatus] = createSignal<ContainerInfo["status"]>(props.container.status ?? "stopped")

  const auditEntries = createMemo(() => listSandboxAuditEntries(props.container.id))

  const running = () => (status() ?? "stopped") === "running"
  const displayCapable = () => props.container.display === true || props.container.kind === "desktop"
  const shellCommandValue = () => {
    const command = shellCommand()
    if (command) return command
    if (!running()) return ""
    if (isDesktopWorkload(props.container)) return ""
    return defaultShellCommand(props.container)
  }
  const shellReady = () => running() && !!platform.containerPty
  async function refreshLogs() {
    const http = server.current?.http
    if (!http) {
      setLogsError(language.t("containers.error.noServer"))
      setLogsLoading(false)
      return
    }

    setLogsError(undefined)
    try {
      setLogs(await fetchContainerLogs(http, props.container.id))
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err))
    } finally {
      setLogsLoading(false)
    }
  }

  async function refreshContainerStatus() {
    const http = server.current?.http
    if (!http) return

    const containers = await listContainers(http).catch(() => [] as ContainerInfo[])
    const latest = containers.find((item) => containerIdsMatch(item.id, props.container.id))
    if (latest) setStatus(latest.status ?? "stopped")
  }

  async function handleStart() {
    const http = server.current?.http
    if (!http) return

    setStarting(true)
    setShellError(undefined)
    const toastId = showToast({
      variant: "loading",
      title: language.t("containers.start.inProgress"),
    })
    try {
      await startContainer(http, props.container.id)
      await props.onStart?.()
      await refreshContainerStatus()
      if (running()) {
        await refreshShell()
        showToast({
          variant: "success",
          title: language.t("containers.started"),
        })
        return
      }
      setShellError(language.t("containers.inspect.shellStopped"))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setShellError(message)
      showToast({
        variant: "error",
        title: language.t("containers.start.failed"),
        description: message,
      })
    } finally {
      dismissToast(toastId)
      setStarting(false)
    }
  }

  async function refreshShell() {
    const http = server.current?.http
    if (!http) {
      setShellError(language.t("containers.error.noServer"))
      return
    }

    await refreshContainerStatus()
    if (!running()) {
      setShellCommand(undefined)
      setShellError(language.t("containers.inspect.shellStopped"))
      return
    }

    setShellError(undefined)
    try {
      const shell = await fetchContainerShell(http, props.container.id)
      setShellCommand(shell.command)
    } catch (err) {
      setShellCommand(undefined)
      setShellError(err instanceof Error ? err.message : String(err))
    }
  }

  onMount(() => {
    void refreshContainerStatus()
  })

  createEffect(() => {
    void refreshLogs()
    if (!autoRefresh() || !running() || tab() !== "logs") return

    const timer = setInterval(() => {
      void refreshLogs()
    }, 3_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (tab() !== "shell") return
    void refreshShell()
  })

  async function refreshDisplay() {
    const http = server.current?.http
    if (!http) {
      setDisplayError(language.t("containers.error.noServer"))
      return
    }

    await refreshContainerStatus()
    if (!running()) {
      setDisplay(undefined)
      setDisplayError(language.t("containers.inspect.displayStopped"))
      return
    }
    if (!displayCapable()) {
      setDisplay(undefined)
      setDisplayError(language.t("containers.inspect.displayHowTo"))
      return
    }

    setDisplayLoading(true)
    setDisplayError(undefined)
    try {
      setDisplay(await fetchContainerDisplay(http, props.container.id))
    } catch (err) {
      setDisplay(undefined)
      setDisplayError(err instanceof Error ? err.message : String(err))
    } finally {
      setDisplayLoading(false)
    }
  }

  createEffect(() => {
    if (tab() !== "display") return
    console.info("[openlegion:desktop-display] inspect tab opened", {
      containerId: props.container.id,
      kind: props.container.kind,
    })
    void refreshDisplay()
  })

  async function copyShellCommand() {
    await navigator.clipboard.writeText(shellCommandValue())
  }

  async function copyLogs() {
    const text = logs().trim() || language.t("containers.inspect.logsEmpty")
    await navigator.clipboard.writeText(text)
    showToast({ variant: "success", title: language.t("containers.inspect.copyLogsDone") })
  }

  return (
    <Dialog
      title={language.t("containers.inspect.title", { name: props.container.name ?? props.container.id.slice(0, 12) })}
      description={language.t("containers.inspect.description")}
      size="large"
      fit
      class="container-inspect-dialog"
    >
      <div class="container-inspect-dialog-body flex min-h-0 flex-1 flex-col gap-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-2">
            <ButtonV2
              variant={tab() === "logs" ? "neutral" : "ghost"}
              size="normal"
              onClick={() => setTab("logs")}
            >
              {language.t("containers.inspect.tab.logs")}
            </ButtonV2>
            <ButtonV2
              variant={tab() === "shell" ? "neutral" : "ghost"}
              size="normal"
              onClick={() => setTab("shell")}
              disabled={!platform.containerPty}
            >
              {language.t("containers.inspect.tab.shell")}
            </ButtonV2>
            <ButtonV2
              variant={tab() === "display" ? "neutral" : "ghost"}
              size="normal"
              onClick={() => setTab("display")}
            >
              {language.t("containers.inspect.tab.display")}
            </ButtonV2>
            <ButtonV2
              variant={tab() === "audit" ? "neutral" : "ghost"}
              size="normal"
              onClick={() => setTab("audit")}
            >
              {language.t("containers.inspect.tab.audit")}
            </ButtonV2>
          </div>
          <Show when={!running()}>
            <ButtonV2 size="normal" onClick={() => void handleStart()} disabled={starting()}>
              {language.t(starting() ? "containers.starting" : "containers.start")}
            </ButtonV2>
          </Show>
        </div>

        <Show when={tab() === "logs"}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-sm text-v2-text-text-muted">
              <input
                type="checkbox"
                checked={autoRefresh()}
                disabled={!running()}
                onChange={(event) => setAutoRefresh(event.currentTarget.checked)}
              />
              {language.t("containers.inspect.autoRefresh")}
            </label>
            <ButtonV2 variant="ghost" size="normal" onClick={() => void refreshLogs()} disabled={logsLoading()}>
              {language.t("containers.inspect.refresh")}
            </ButtonV2>
            <ButtonV2 variant="ghost" size="normal" onClick={() => void copyLogs()} disabled={logsLoading()}>
              {language.t("containers.inspect.copyLogs")}
            </ButtonV2>
          </div>

          <Show when={logsLoading()} fallback={null}>
            <div class="flex justify-center py-8">
              <Spinner />
            </div>
          </Show>

          <Show when={!logsLoading()}>
            <pre class="max-h-[min(50vh,420px)] min-h-[240px] overflow-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-3 font-mono text-xs leading-relaxed text-v2-text-text-base whitespace-pre-wrap">
              {logs().trim() || language.t("containers.inspect.logsEmpty")}
            </pre>
          </Show>

          <Show when={logsError()}>
            <div class="text-sm text-v2-text-text-danger">{logsError()}</div>
          </Show>
        </Show>

        <Show when={tab() === "shell"}>
          <Show when={isDesktopWorkload(props.container)}>
            <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t("containers.inspect.desktopShellHint")}</p>
          </Show>
          <Show
            when={platform.containerPty}
            fallback={
              <div class="rounded-md border border-v2-border-border-base p-4 text-sm text-v2-text-text-muted">
                {language.t("containers.inspect.shellUnavailable")}
              </div>
            }
          >
            <Show
              when={shellReady()}
              fallback={
                <div class="rounded-md border border-v2-border-border-base p-4 text-sm text-v2-text-text-muted">
                  {shellError() ?? language.t("containers.inspect.shellStopped")}
                </div>
              }
            >
              <div class="flex min-h-0 flex-1 flex-col gap-3">
                <Show when={shellCommandValue()} fallback={null}>
                  {(command) => <ContainerTerminal command={command()} active={tab() === "shell"} />}
                </Show>
                <div class="flex flex-wrap gap-2">
                  <ButtonV2 variant="neutral" size="normal" onClick={() => void copyShellCommand()}>
                    {language.t("containers.inspect.copyShell")}
                  </ButtonV2>
                </div>
              </div>
            </Show>
            <Show when={shellError() && running()}>
              <div class="text-sm text-v2-text-text-muted">{shellError()}</div>
            </Show>
          </Show>
        </Show>

        <Show when={tab() === "display"}>
          <Show when={displayLoading()}>
            <div class="flex justify-center py-8">
              <Spinner />
            </div>
          </Show>
          <Show when={!displayLoading() && display()}>
            {(session) => (
              <div class="flex min-h-0 flex-1 flex-col gap-2">
                <p class="text-xs text-v2-text-text-muted">{language.t("containers.inspect.displayFocus")}</p>
                <p class="text-xs text-v2-text-text-muted">{language.t("containers.inspect.displayMonitor")}</p>
                <div class="flex flex-wrap gap-2">
                  <ButtonV2 variant="ghost" size="normal" onClick={() => void refreshDisplay()}>
                    {language.t("containers.inspect.displayRefresh")}
                  </ButtonV2>
                  <ButtonV2 variant="ghost" size="normal" onClick={() => setDisplayFullscreen((value) => !value)}>
                    {displayFullscreen()
                      ? language.t("containers.inspect.exitFullscreen")
                      : language.t("containers.inspect.fullscreen")}
                  </ButtonV2>
                </div>
                <Show
                  when={session().kind === "cdp"}
                  fallback={
                    <ContainerDisplay
                      url={session().url}
                      password={session().password}
                      active={tab() === "display"}
                      fullscreen={displayFullscreen()}
                    />
                  }
                >
                  <ContainerBrowser
                    url={session().url}
                    password={session().password}
                    active={tab() === "display"}
                    fullscreen={displayFullscreen()}
                  />
                </Show>
              </div>
            )}
          </Show>
          <Show when={!displayLoading() && !display()}>
            <div class="rounded-md border border-v2-border-border-base p-4 text-sm text-v2-text-text-muted">
              {displayError() ?? language.t("containers.inspect.displayUnavailable")}
            </div>
            <Show when={!displayCapable()}>
              <p class="text-sm text-v2-text-text-muted">{language.t("containers.inspect.displayHowTo")}</p>
            </Show>
          </Show>
        </Show>

        <Show when={tab() === "audit"}>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.inspect.audit.description")}</p>
          <Show
            when={auditEntries().length > 0}
            fallback={
              <div class="rounded-md border border-v2-border-border-base p-4 text-sm text-v2-text-text-muted">
                {language.t("containers.inspect.audit.empty")}
              </div>
            }
          >
            <ul class="max-h-[min(50vh,420px)] overflow-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-3 text-xs">
              <For each={auditEntries()}>
                {(entry) => (
                  <li class="border-b border-v2-border-border-base py-2 last:border-b-0">
                    <div class="font-mono text-v2-text-text-base">{entry.action}</div>
                    <Show when={entry.detail}>
                      <div class="text-v2-text-text-muted">{entry.detail}</div>
                    </Show>
                    <div class="text-v2-text-text-faint">
                      {new Date(entry.at).toLocaleString()}
                      {entry.outcome ? ` · ${entry.outcome}` : ""}
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </div>

      <DialogFooter>
        <Show when={props.onAskAgent}>
          {(onAskAgent) => (
            <ButtonV2
              variant="neutral"
              disabled={askingAgent()}
              onClick={() => {
                setAskingAgent(true)
                onAskAgent()()
                  .then((opened) => {
                    if (opened) dialog.close()
                  })
                  .catch((err) => {
                    showToast({
                      title: language.t("containers.inspect.askAgentFailed"),
                      description: err instanceof Error ? err.message : String(err),
                    })
                  })
                  .finally(() => setAskingAgent(false))
              }}
            >
              {language.t("containers.inspect.askAgent")}
            </ButtonV2>
          )}
        </Show>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
