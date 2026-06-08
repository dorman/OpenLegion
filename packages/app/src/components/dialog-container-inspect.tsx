import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { Spinner } from "@openlegion-ai/ui/spinner"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { ContainerTerminal } from "@/components/container-terminal"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import {
  fetchContainerLogs,
  fetchContainerShell,
  type ContainerInfo,
} from "@/utils/containers"

type InspectTab = "logs" | "shell"

function defaultShellCommand(container: ContainerInfo) {
  const target = container.name ?? container.id
  return `docker exec -i ${target} sh`
}

export function DialogContainerInspect(props: { container: ContainerInfo }) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const [tab, setTab] = createSignal<InspectTab>("logs")
  const [logs, setLogs] = createSignal("")
  const [shellCommand, setShellCommand] = createSignal<string | undefined>()
  const [logsError, setLogsError] = createSignal<string | undefined>()
  const [shellError, setShellError] = createSignal<string | undefined>()
  const [logsLoading, setLogsLoading] = createSignal(true)
  const [autoRefresh, setAutoRefresh] = createSignal(true)

  const running = () => (props.container.status ?? "running") === "running"
  const shellCommandValue = () => shellCommand() ?? defaultShellCommand(props.container)
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

  async function refreshShell() {
    const http = server.current?.http
    if (!http) {
      setShellError(language.t("containers.error.noServer"))
      return
    }

    setShellError(undefined)
    try {
      const shell = await fetchContainerShell(http, props.container.id)
      setShellCommand(shell.command)
    } catch (err) {
      setShellCommand(defaultShellCommand(props.container))
      setShellError(err instanceof Error ? err.message : String(err))
    }
  }

  createEffect(() => {
    void refreshLogs()
    if (!autoRefresh() || !running() || tab() !== "logs") return

    const timer = setInterval(() => {
      void refreshLogs()
    }, 3_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (tab() !== "shell" || !shellReady()) return
    void refreshShell()
  })

  async function copyShellCommand() {
    await navigator.clipboard.writeText(shellCommandValue())
  }

  return (
    <Dialog
      title={language.t("containers.inspect.title", { name: props.container.name ?? props.container.id.slice(0, 12) })}
      description={language.t("containers.inspect.description")}
      size="x-large"
      class="container-inspect-dialog"
    >
      <div class="flex min-h-0 flex-1 flex-col gap-4">
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
            disabled={!shellReady()}
          >
            {language.t("containers.inspect.tab.shell")}
          </ButtonV2>
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
          <Show
            when={shellReady()}
            fallback={
              <div class="rounded-md border border-v2-border-border-base p-4 text-sm text-v2-text-text-muted">
                {running()
                  ? language.t("containers.inspect.shellUnavailable")
                  : language.t("containers.inspect.shellStopped")}
              </div>
            }
          >
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <ContainerTerminal command={shellCommandValue()} active={tab() === "shell"} />
              <div class="flex flex-wrap gap-2">
                <ButtonV2 variant="neutral" size="normal" onClick={() => void copyShellCommand()}>
                  {language.t("containers.inspect.copyShell")}
                </ButtonV2>
              </div>
              <Show when={shellError()}>
                <div class="text-sm text-v2-text-text-muted">{shellError()}</div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.close")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
