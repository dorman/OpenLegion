import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { Spinner } from "@openlegion-ai/ui/spinner"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createStore } from "solid-js/store"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform, type DesktopImageDownloadProgress } from "@/context/platform"
import { presetById, presetsForArch } from "@/utils/desktop-presets"
import type { ContainerCreateInput } from "@/utils/containers"
import { warningsForCreateInput } from "@/utils/sandbox-config-warnings"
import { SANDBOX_TEMPLATES, type SandboxTemplateFormState } from "@/utils/sandbox-templates"

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function FormSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="desktop-form-section">
      <h3 class="desktop-form-section-title">{props.title}</h3>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  )
}

const defaultFormState = (): SandboxTemplateFormState => ({
  kind: "container",
  preset: "custom",
  image: "alpine:latest",
  name: "",
  command: "sleep 3600",
  memoryMb: "2048",
  cpuCores: "2",
  diskGb: "24",
  volumeHost: "",
  volumeContainer: "/workspace",
  publish: "",
})

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
  const [downloadProgress, setDownloadProgress] = createSignal<DesktopImageDownloadProgress | undefined>()
  const [downloadElapsedSec, setDownloadElapsedSec] = createSignal(0)
  const [downloadFailed, setDownloadFailed] = createSignal(false)
  const [store, setStore] = createStore(defaultFormState())
  let downloadAbort: AbortController | undefined

  const arch = createMemo((): "arm64" | "x64" => props.arch ?? "arm64")

  const desktopPresets = createMemo(() => presetsForArch(arch()))

  const selectedPreset = createMemo(() => presetById(store.preset))

  const selectedPresetLabel = createMemo(() => {
    const preset = selectedPreset()
    return preset ? language.t(preset.labelKey) : ""
  })

  const configWarnings = createMemo(() =>
    store.kind === "container"
      ? warningsForCreateInput({ volumeHost: store.volumeHost })
      : [],
  )

  onCleanup(() => {
    downloadAbort?.abort()
    void platform.cancelDesktopImageDownload?.()
  })

  createEffect(() => {
    if (!downloading()) {
      setDownloadElapsedSec(0)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      setDownloadElapsedSec(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  function applyTemplate(templateId: string) {
    const template = SANDBOX_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setStore({ ...defaultFormState(), ...template.apply(arch()) })
    setError(undefined)
    setDownloadFailed(false)
  }

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

  function cancelDownload() {
    downloadAbort?.abort()
    void platform.cancelDesktopImageDownload?.()
    setDownloading(false)
    setDownloadProgress(undefined)
    setDownloadFailed(true)
    setError(language.t("containers.create.preset.downloadCancelled"))
  }

  async function resolveDesktopImage() {
    if (store.preset === "custom") return store.image.trim()
    const ensure = platform.ensureDesktopImage
    if (!ensure) throw new Error(language.t("containers.create.preset.downloadUnavailable"))

    downloadAbort?.abort()
    downloadAbort = new AbortController()
    setDownloading(true)
    setDownloadFailed(false)
    setDownloadProgress(undefined)
    setError(undefined)

    try {
      const result = await ensure(store.preset, {
        onProgress: (progress) => setDownloadProgress(progress),
        signal: downloadAbort.signal,
      })
      if (result.cancelled) {
        throw new Error(language.t("containers.create.preset.downloadCancelled"))
      }
      if (!result.ok || !result.path) {
        throw new Error(result.error ?? language.t("containers.create.preset.downloadFailed"))
      }
      return result.path
    } catch (err) {
      setDownloadFailed(true)
      throw err
    } finally {
      setDownloading(false)
      setDownloadProgress(undefined)
      downloadAbort = undefined
    }
  }

  const downloadStatusMessage = createMemo(() => {
    const distro = selectedPresetLabel()
    const progress = downloadProgress()
    if (!progress) return language.t("containers.create.preset.downloadingChecking", { distro })

    switch (progress.phase) {
      case "cached":
        return language.t("containers.create.preset.downloadingCached", { distro })
      case "downloading":
        return language.t("containers.create.preset.downloading", { distro })
      case "finishing":
        return language.t("containers.create.preset.downloadingFinishing", { distro })
      default:
        return language.t("containers.create.preset.downloadingChecking", { distro })
    }
  })

  function parseResource(value: string) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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

      const memoryMb = parseResource(store.memoryMb)
      const cpuCores = parseResource(store.cpuCores)
      const diskGb = parseResource(store.diskGb)
      const image = store.kind === "desktop" ? await resolveDesktopImage() : store.image.trim()
      if (!image) throw new Error(language.t("containers.create.imageRequired"))

      await props.onCreate({
        kind: store.kind,
        image,
        name: store.name.trim() || undefined,
        memoryMb: store.kind === "desktop" ? memoryMb : undefined,
        cpuCores,
        diskGb: store.kind === "desktop" ? diskGb : undefined,
        command:
          (store.kind === "container" || store.kind === "kubernetes") && command.length > 0 ? command : undefined,
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
        <FormSection title={language.t("containers.templates.title")}>
          <div class="flex flex-wrap gap-2">
            <For each={SANDBOX_TEMPLATES}>
              {(template) => (
                <ButtonV2 variant="neutral" size="normal" onClick={() => applyTemplate(template.id)}>
                  {language.t(template.labelKey)}
                </ButtonV2>
              )}
            </For>
          </div>
          <p class="text-xs leading-relaxed text-v2-text-text-muted">
            {language.t("containers.templates.hint")}
          </p>
        </FormSection>

        <FormSection title={language.t("containers.create.section.workload")}>
          <label class="flex flex-col gap-1 text-sm">
            <span class="text-v2-text-text-muted">{language.t("containers.create.kind")}</span>
            <select
              class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              value={store.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value as "container" | "desktop" | "kubernetes"
                setStore("kind", kind)
                if (kind === "desktop") setStore({ image: "", preset: "custom" })
                if ((kind === "container" || kind === "kubernetes") && !store.image.trim())
                  setStore("image", "alpine:latest")
              }}
            >
              <option value="container">{language.t("containers.create.kind.container")}</option>
              <option value="desktop">{language.t("containers.create.kind.desktop")}</option>
              <option value="kubernetes">{language.t("containers.create.kind.kubernetes")}</option>
            </select>
          </label>
          <Show when={store.kind === "desktop"}>
            <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t("containers.create.desktopHint")}</p>
          </Show>
          <Show when={store.kind === "kubernetes"}>
            <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t("containers.create.kubernetesHint")}</p>
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

            <Show when={store.preset !== "custom" && !downloading()}>
              <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t("containers.create.preset.downloadHint")}</p>
              <p class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-xs leading-relaxed text-v2-text-text-muted">
                {language.t("containers.create.preset.downloadNotice", { distro: selectedPresetLabel() })}
              </p>
            </Show>

            <Show when={downloading() || downloadFailed()}>
              <div
                class="flex flex-col gap-3 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-3"
                role="status"
                aria-live="polite"
              >
                <Show
                  when={downloading()}
                  fallback={
                    <p class="text-sm text-v2-text-text-muted">{language.t("containers.create.preset.downloadFailed")}</p>
                  }
                >
                  <div class="flex items-start gap-2 text-sm text-v2-text-text-base">
                    <Spinner class="mt-0.5 shrink-0" />
                    <div class="flex min-w-0 flex-col gap-1">
                      <p class="font-medium">{downloadStatusMessage()}</p>
                      <Show when={(downloadProgress()?.downloadedMb ?? 0) > 0}>
                        <p class="text-xs text-v2-text-text-muted">
                          {language.t("containers.create.preset.downloadingProgress", {
                            downloaded: downloadProgress()?.downloadedMb ?? 0,
                          })}
                        </p>
                      </Show>
                      <p class="text-xs text-v2-text-text-muted">
                        {language.t("containers.create.preset.downloadingElapsed", {
                          elapsed: formatElapsed(downloadElapsedSec()),
                        })}
                      </p>
                      <p class="text-xs leading-relaxed text-v2-text-text-muted">
                        {language.t("containers.create.preset.downloadingReassurance")}
                      </p>
                    </div>
                  </div>
                </Show>
                <div class="flex flex-wrap gap-2">
                  <Show when={downloading()}>
                    <ButtonV2 variant="neutral" size="normal" onClick={() => cancelDownload()}>
                      {language.t("containers.create.preset.downloadCancel")}
                    </ButtonV2>
                  </Show>
                  <Show when={downloadFailed() && store.preset !== "custom"}>
                    <ButtonV2 size="normal" onClick={() => void submit()} disabled={pending()}>
                      {language.t("containers.create.preset.downloadRetry")}
                    </ButtonV2>
                  </Show>
                </div>
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
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.cpuCores")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.cpuCores}
                onInput={(event) => setStore("cpuCores", event.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.diskGb")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.diskGb}
                onInput={(event) => setStore("diskGb", event.currentTarget.value)}
              />
            </label>
          </FormSection>
        </Show>

        <Show when={store.kind === "kubernetes"}>
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

          <FormSection title={language.t("containers.create.section.resources")}>
            <label class="flex flex-col gap-1 text-sm">
              <span class="text-v2-text-text-muted">{language.t("containers.create.cpuCores")}</span>
              <input
                class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
                value={store.cpuCores}
                onInput={(event) => setStore("cpuCores", event.currentTarget.value)}
              />
            </label>
          </FormSection>

          <FormSection title={language.t("containers.create.section.security")}>
            <ul class="list-disc space-y-1 pl-5 text-xs leading-relaxed text-v2-text-text-muted">
              <li>{language.t("containers.create.security.nonRoot")}</li>
              <li>{language.t("containers.create.security.noSecrets")}</li>
              <li>{language.t("containers.create.security.pinDigest")}</li>
              <li>{language.t("containers.create.security.minimal")}</li>
            </ul>
          </FormSection>
        </Show>

        <Show when={configWarnings().length > 0}>
          <div class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-3">
            <p class="text-sm font-medium text-v2-text-text-base">{language.t("containers.warnings.title")}</p>
            <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-v2-text-text-muted">
              <For each={configWarnings()}>
                {(warning) => <li>{language.t(warning.messageKey)}</li>}
              </For>
            </ul>
          </div>
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
            ((store.kind === "container" || store.kind === "kubernetes") && !store.image.trim()) ||
            (store.kind === "desktop" && store.preset === "custom" && !store.image.trim())
          }
        >
          {downloading()
            ? language.t("containers.create.preset.downloadingSubmit")
            : language.t("containers.create.submit")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
