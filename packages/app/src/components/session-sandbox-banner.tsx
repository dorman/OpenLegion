import { Button } from "@openlegion-ai/ui/button"
import { Icon } from "@openlegion-ai/ui/icon"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { containerIdsMatch, listContainersSafe, startContainer, type ContainerInfo } from "@/utils/containers"
import { linkedSandboxFromMetadata } from "@/utils/container-workspaces"
import { showToast } from "@/utils/toast"

export function SessionSandboxBanner(props: {
  sessionID: string
  metadata?: Record<string, unknown>
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const server = useServer()
  const queryClient = useQueryClient()

  const linked = createMemo(() => linkedSandboxFromMetadata(props.metadata))
  const http = createMemo(() => {
    const conn = server.current
    if (!conn?.http) return undefined
    return conn.http
  })

  const containers = createQuery(() => ({
    queryKey: ["containers", server.key],
    queryFn: () => listContainersSafe(http()!),
    enabled: !!http() && !!linked(),
    refetchInterval: 10_000,
    // Start with data so reading `.data` never suspends the surrounding route
    // while the first fetch is in flight (the banner renders in the composer
    // region). See listContainersSafe for the matching error handling.
    initialData: [] as ContainerInfo[],
  }))

  const live = createMemo(() => {
    const item = linked()
    if (!item) return undefined
    return (containers.data ?? []).find((container) => containerIdsMatch(container.id, item.id))
  })

  const stopped = createMemo(() => {
    const item = linked()
    if (!item || containers.isLoading) return false
    const container = live()
    if (!container) return true
    return (container.status ?? "stopped") !== "running"
  })

  async function restart() {
    const conn = http()
    const item = linked()
    if (!conn || !item) return
    try {
      await startContainer(conn, item.id)
      await queryClient.invalidateQueries({ queryKey: ["containers", server.key] })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.sandbox.banner.restarted"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  async function unlink() {
    const item = linked()
    if (!item) return
    const metadata = { ...(props.metadata ?? {}) }
    delete metadata["openlegion.container"]
    delete metadata["openlegion.sandbox"]
    try {
      await sdk.client.session.update({
        sessionID: props.sessionID,
        directory: sdk.directory,
        metadata,
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("session.sandbox.banner.unlinked"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    }
  }

  const pendingSetup = createMemo(() => linked()?.id.startsWith("setup-") && !live())

  return (
    <Show when={linked() && stopped() && !pendingSetup()}>
      <div class="mb-2 flex flex-wrap items-center gap-3 rounded-md border border-border-weak-base bg-background-base px-3 py-2 text-13-regular text-text-base">
        <Icon name="warning" size="small" class="shrink-0 text-text-weak" />
        <span class="min-w-0 flex-1">
          {live()
            ? language.t("session.sandbox.banner.stopped", { label: linked()!.label })
            : language.t("session.sandbox.banner.missing", { label: linked()!.label })}
        </span>
        <div class="flex items-center gap-2">
          <Show when={live()}>
            <Button size="small" variant="secondary" onClick={() => void restart()}>
              {language.t("session.sandbox.banner.restart")}
            </Button>
          </Show>
          <Button size="small" variant="ghost" onClick={() => void unlink()}>
            {language.t("session.sandbox.banner.unlink")}
          </Button>
        </div>
      </div>
    </Show>
  )
}
