import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { ContainerDisplay } from "@/components/container-display"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { fetchContainerDisplay, type ContainerInfo } from "@/utils/containers"
import { isDesktopWorkload } from "@/utils/container-workload"

function containerLabel(item: ContainerInfo) {
  return item.name ?? item.id.slice(0, 12)
}

export function RunningSandboxesPanel(props: {
  containers: ContainerInfo[]
  onInspect: (container: ContainerInfo) => void
}) {
  const language = useLanguage()
  const server = useServer()
  const running = createMemo(() =>
    props.containers.filter((item) => (item.status ?? "stopped") === "running"),
  )

  const [activeId, setActiveId] = createSignal<string | undefined>()
  const active = createMemo(() => {
    const items = running()
    const selected = items.find((item) => item.id === activeId())
    return selected ?? items[0]
  })

  const [displayUrl, setDisplayUrl] = createSignal<string | undefined>()
  const [displayPassword, setDisplayPassword] = createSignal<string | undefined>()

  createEffect(() => {
    const items = running()
    if (items.length === 0) return
    if (!items.some((item) => item.id === activeId())) {
      setActiveId(items[0]?.id)
    }
  })

  createEffect(() => {
    const item = active()
    const http = server.current?.http
    if (!item || !http || !isDesktopWorkload(item)) {
      setDisplayUrl(undefined)
      setDisplayPassword(undefined)
      return
    }
    void fetchContainerDisplay(http, item.id)
      .then((session) => {
        setDisplayUrl(session.url)
        setDisplayPassword(session.password)
      })
      .catch(() => {
        setDisplayUrl(undefined)
        setDisplayPassword(undefined)
      })
  })

  return (
    <Show when={running().length >= 2}>
      <section class="flex min-h-[320px] flex-col gap-3 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-4">
        <div class="text-sm text-v2-text-text-base">{language.t("containers.workspace.title")}</div>
        <div class="flex flex-wrap gap-2">
          <For each={running()}>
            {(item) => (
              <ButtonV2
                variant={active()?.id === item.id ? "neutral" : "ghost"}
                size="normal"
                onClick={() => setActiveId(item.id)}
              >
                {containerLabel(item)}
              </ButtonV2>
            )}
          </For>
        </div>
        <Show when={active()} keyed>
          {(item) => (
            <div class="flex min-h-0 flex-1 flex-col gap-3">
              <div class="text-xs text-v2-text-text-muted">{item.image}</div>
              <div class="flex flex-wrap gap-2">
                <ButtonV2 variant="ghost" size="normal" onClick={() => props.onInspect(item)}>
                  {language.t("containers.inspect")}
                </ButtonV2>
              </div>
              <Show when={isDesktopWorkload(item) && displayUrl()}>
                {(url) => (
                  <ContainerDisplay url={url()} password={displayPassword()} active={true} compact />
                )}
              </Show>
            </div>
          )}
        </Show>
      </section>
    </Show>
  )
}
