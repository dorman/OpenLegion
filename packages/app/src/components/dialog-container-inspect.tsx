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

export function DialogContainerInspect(props: { container: ContainerInfo }) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const dialog = useDialog()
  const [tab, setTab] = createSignal<InspectTab>("logs")
  const [logs, setLogs] = createSignal("")
  const [shellCommand, setShellCommand] = createSignal<string | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(true)
  const [autoRefresh, setAutoRefresh] = createSignal(true)

  const running = () => (props.container.status ?? "running") === "running"
  const shellAvailable = () => !!platform.containerPty && running() && !!shellCommand()

  async function refresh() {
    const http = server.current?.http
    if (!http) {
      setError(language.t("containers.error.noServer"))
      setLoading(false)
      return
    }

    setError(undefined)
    try {
      const [nextLogs, shell] = await Promise.all([
        fetchContainerLogs(http, props.container.id),
        fetchContainerShell(http, props.container.id),
      ])
      setLogs(nextLogs)
      setShellCommand(shell.command)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    void refresh()
    if (!autoRefresh() || !running() || tab() !== "logs") return

    const timer = setInterval(() => {
      void refresh()
    }, 3_000)
    onCleanup(() => clearInterval(timer))
  })

  async function copyShellCommand() {
    const command = shellCommand()
    if (!command) return
    await navigator.clipboard.writeText(command)
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
            disabled={!shellAvailable()}
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
            <ButtonV2 variant="ghost" size="normal" onClick={() => void refresh()} disabled={loading()}>
              {language.t("containers.inspect.refresh")}
            </ButtonV2>
          </div>

          <Show when={loading()} fallback={null}>
            <div class="flex justify-center py-8">
              <Spinner />
            </div>
          </Show>

          <Show when={!loading()}>
            <pre class="max-h-[min(50vh,420px)] min-h-[240px] overflow-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-3 font-mono text-xs leading-relaxed text-v2-text-text-base whitespace-pre-wrap">
              {logs().trim() || language.t("containers.inspect.logsEmpty")}
            </pre>
          </Show>
        </Show>

        <Show
          when={shellAvailable()}
          fallback={
            <Show when={tab() === "shell"}>
              <div class="rounded-md border border-v2-border-border-base p-4 text-sm text-v2-text-text-muted">
                {running()
                  ? language.t("containers.inspect.shellUnavailable")
                  : language.t("containers.inspect.shellStopped")}
              </div>
            </Show>
          }
        >
          <div classList={{ "flex min-h-0 flex-1 flex-col gap-3": true, hidden: tab() !== "shell" }}>
            <ContainerTerminal command={shellCommand()!} active={tab() === "shell"} />
            <div class="flex flex-wrap gap-2">
              <ButtonV2 variant="neutral" size="normal" onClick={() => void copyShellCommand()}>
                {language.t("containers.inspect.copyShell")}
              </ButtonV2>
            </div>
          </div>
        </Show>

        <Show when={error()}>
          <div class="text-sm text-v2-text-text-danger">{error()}</div>
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
