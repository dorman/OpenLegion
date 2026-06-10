import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { Spinner } from "@openlegion-ai/ui/spinner"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { presetsForArch } from "@/utils/desktop-presets"
import type { ContainerCreateInput } from "@/utils/containers"

function FormSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="desktop-form-section">
      <h3 class="desktop-form-section-title">{props.title}</h3>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  )
}

export function DialogContainerCreate(props: {
  onCreate: (input: ContainerCreateInput) => Promise<unknown>
  arch?: "arm64" | "x64"
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [error, setError] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal(false)
  const [downloading, setDownloading] = createSignal(false)
  const [store, setStore] = createStore({
    kind: "container" as "container" | "desktop",
    preset: "custom",
    image: "alpine:latest",
    name: "",
    command: "sleep 3600",
    memoryMb: "2048",
    volumeHost: "",
    volumeContainer: "/workspace",
    publish: "",
  })

  const arch = createMemo((): "arm64" | "x64" => props.arch ?? "arm64")

  const desktopPresets = createMemo(() => presetsForArch(arch()))

  async function pickDiskImage() {
    const file = await platform.openFilePickerDialog?.({
      title: language.t("containers.create.pickDiskImage"),
      accept: ["iso", "qcow2"],
    })
    if (!file || Array.isArray(file)) return
    setStore({ preset: "custom", image: file })
  }

  async function pickVolume() {
    const host = await platform.openDirectoryPickerDialog?.({
      title: language.t("containers.create.pickVolume"),
    })
    if (!host || Array.isArray(host)) return
    setStore("volumeHost", host)
  }

  async function resolveDesktopImage() {
    if (store.preset === "custom") return store.image.trim()
    const ensure = platform.ensureDesktopImage
    if (!ensure) throw new Error(language.t("containers.create.preset.downloadUnavailable"))
    setDownloading(true)
    try {
      const result = await ensure(store.preset)
      if (!result.ok || !result.path) throw new Error(result.error ?? language.t("containers.create.preset.downloadFailed"))
      return result.path
    } finally {
      setDownloading(false)
    }
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
      const image = store.kind === "desktop" ? await resolveDesktopImage() : store.image.trim()
      if (!image) throw new Error(language.t("containers.create.imageRequired"))

      await props.onCreate({
        kind: store.kind,
        image,
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
        <FormSection title={language.t("containers.create.section.workload")}>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-v2-text-text-muted">{language.t("containers.create.kind")}</span>
            <select
              class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              value={store.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value as "container" | "desktop"
                setStore("kind", kind)
                if (kind === "desktop") setStore({ image: "", preset: "custom" })
                if (kind === "container" && !store.image.trim()) setStore("image", "alpine:latest")
              }}
            >
              <option value="container">{language.t("containers.create.kind.container")}</option>
              <option value="desktop">{language.t("containers.create.kind.desktop")}</option>
            </select>
          </label>
          <Show when={store.kind === "desktop"}>
            <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t("containers.create.desktopHint")}</p>
          </Show>
        </FormSection>

        <Show when={store.kind === "desktop"}>
          <FormSection title={language.t("containers.create.section.installer")}>
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.preset")}</span>
              <select
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.preset}
                onChange={(event) => {
                  const preset = event.currentTarget.value
                  setStore({ preset, image: preset === "custom" ? store.image : "" })
                }}
              >
                <For each={desktopPresets()}>
                  {(preset) => <option value={preset.id}>{language.t(preset.labelKey)}</option>}
                </For>
              </select>
            </label>

            <Show when={store.preset === "custom"}>
              <label class="flex flex-col gap-1 text-sm">
                <span class="text-v2-text-text-muted">{language.t("containers.create.diskImage")}</span>
                <div class="flex gap-2">
                  <input
                    class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                    placeholder="/Users/you/Downloads/ubuntu.iso"
                    value={store.image}
                    onInput={(event) => setStore("image", event.currentTarget.value)}
                  />
                  <ButtonV2 variant="neutral" onClick={() => void pickDiskImage()}>
                    {language.t("containers.create.pickDiskImage")}
                  </ButtonV2>
                </div>
                <span class="text-xs text-v2-text-text-muted">{language.t("containers.create.diskImageHint")}</span>
              </label>
            </Show>

            <Show when={store.preset !== "custom"}>
              <p class="text-xs text-v2-text-text-muted">{language.t("containers.create.preset.downloadHint")}</p>
            </Show>

            <Show when={downloading()}>
              <div class="flex items-center gap-2 text-sm text-v2-text-text-muted">
                <Spinner />
                {language.t("containers.create.preset.downloading")}
              </div>
            </Show>
          </FormSection>

          <FormSection title={language.t("containers.create.section.resources")}>
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.memory")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.memoryMb}
                onInput={(event) => setStore("memoryMb", event.currentTarget.value)}
              />
            </label>
          </FormSection>
        </Show>

        <Show when={store.kind === "container"}>
          <FormSection title={language.t("containers.create.section.runtime")}>
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.image")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.image}
                onInput={(event) => setStore("image", event.currentTarget.value)}
              />
            </label>

            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.command")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.command}
                onInput={(event) => setStore("command", event.currentTarget.value)}
              />
            </label>

            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.publish")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                placeholder="8080:80"
                value={store.publish}
                onInput={(event) => setStore("publish", event.currentTarget.value)}
              />
            </label>

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
          </FormSection>
        </Show>

        <FormSection title={language.t("containers.create.section.general")}>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-v2-text-text-muted">{language.t("containers.create.name")}</span>
            <input
              class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              value={store.name}
              onInput={(event) => setStore("name", event.currentTarget.value)}
            />
          </label>
        </FormSection>

        <Show when={error()}>
          <p class="text-sm text-v2-text-text-danger">{error()}</p>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()} disabled={pending() || downloading()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          onClick={() => void submit()}
          disabled={
            pending() ||
            downloading() ||
            (store.kind === "container" && !store.image.trim()) ||
            (store.kind === "desktop" && store.preset === "custom" && !store.image.trim())
          }
        >
          {language.t("containers.create.submit")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
