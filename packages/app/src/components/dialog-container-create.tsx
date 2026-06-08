import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createStore } from "solid-js/store"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { ContainerCreateInput } from "@/utils/containers"

export function DialogContainerCreate(props: {
  onCreate: (input: ContainerCreateInput) => Promise<unknown>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [error, setError] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal(false)
  const [store, setStore] = createStore({
    kind: "container" as "container" | "desktop",
    image: "alpine:latest",
    name: "",
    command: "sleep 3600",
    memoryMb: "2048",
    volumeHost: "",
    volumeContainer: "/workspace",
    publish: "",
  })

  async function pickVolume() {
    const host = await platform.openDirectoryPickerDialog?.({
      title: language.t("containers.create.pickVolume"),
    })
    if (!host || Array.isArray(host)) return
    setStore("volumeHost", host)
  }

  async function submit() {
    setError(undefined)
    setPending(true)
    try {
      const command = store.command
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
      const ports = store.publish
        .split(",")
        .map((item) => item.trim())
        .flatMap((item) => {
          const [host, container] = item.split(":")
          if (!host || !container) return []
          return [{ host, container }]
        })

      const memoryMb = Number(store.memoryMb)
      await props.onCreate({
        kind: store.kind,
        image: store.image.trim(),
        name: store.name.trim() || undefined,
        memoryMb: store.kind === "desktop" && Number.isFinite(memoryMb) && memoryMb > 0 ? memoryMb : undefined,
        command: store.kind === "container" && command.length > 0 ? command : undefined,
        ports: ports.length > 0 ? ports : undefined,
        volumes:
          store.kind === "container" && store.volumeHost.trim() && store.volumeContainer.trim()
            ? [{ host: store.volumeHost.trim(), container: store.volumeContainer.trim() }]
            : undefined,
      })
      dialog.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      title={language.t("containers.create.title")}
      description={language.t("containers.create.description")}
      size="large"
      fit
      class="container-create-dialog"
    >
      <div class="container-create-dialog-body flex flex-col gap-4 px-4 pb-2">
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-v2-text-text-muted">{language.t("containers.create.kind")}</span>
          <select
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
            value={store.kind}
            onChange={(event) => setStore("kind", event.currentTarget.value as "container" | "desktop")}
          >
            <option value="container">{language.t("containers.create.kind.container")}</option>
            <option value="desktop">{language.t("containers.create.kind.desktop")}</option>
          </select>
        </label>

        <Show when={store.kind === "desktop"}>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-v2-text-text-muted">{language.t("containers.create.memory")}</span>
            <input
              class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              value={store.memoryMb}
              onInput={(event) => setStore("memoryMb", event.currentTarget.value)}
            />
          </label>
        </Show>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-v2-text-text-muted">{language.t("containers.create.image")}</span>
          <input
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
            value={store.image}
            onInput={(event) => setStore("image", event.currentTarget.value)}
          />
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-v2-text-text-muted">{language.t("containers.create.name")}</span>
          <input
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
            value={store.name}
            onInput={(event) => setStore("name", event.currentTarget.value)}
          />
        </label>

        <Show when={store.kind === "container"}>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-v2-text-text-muted">{language.t("containers.create.command")}</span>
            <input
              class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              value={store.command}
              onInput={(event) => setStore("command", event.currentTarget.value)}
            />
          </label>
        </Show>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-v2-text-text-muted">{language.t("containers.create.publish")}</span>
          <input
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
            placeholder="8080:80"
            value={store.publish}
            onInput={(event) => setStore("publish", event.currentTarget.value)}
          />
        </label>

        <Show when={store.kind === "container"}>
        <div class="flex flex-col gap-2 text-sm">
          <span class="text-v2-text-text-muted">{language.t("containers.create.volume")}</span>
          <div class="flex gap-2">
            <input
              class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              placeholder="/host/path"
              value={store.volumeHost}
              onInput={(event) => setStore("volumeHost", event.currentTarget.value)}
            />
            <ButtonV2 variant="neutral" onClick={() => void pickVolume()}>
              {language.t("containers.create.browse")}
            </ButtonV2>
          </div>
          <input
            class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
            placeholder="/workspace"
            value={store.volumeContainer}
            onInput={(event) => setStore("volumeContainer", event.currentTarget.value)}
          />
        </div>
        </Show>

        <Show when={error()}>
          <p class="text-sm text-v2-text-text-danger">{error()}</p>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()} disabled={pending()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          onClick={() => void submit()}
          disabled={pending() || (store.kind === "container" && !store.image.trim())}
        >
          {language.t("containers.create.submit")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
