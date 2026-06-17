import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { ContainerCreateInput } from "@/utils/containers"
import { warningsForCreateInput } from "@/utils/sandbox-config-warnings"
import { SANDBOX_TEMPLATES, type SandboxTemplateFormState } from "@/utils/sandbox-templates"

// Linux VM desktops are no longer created in-app; they run as Kata micro-VMs on a
// dedicated research host. These point at the setup guide in the repo.
const HOST_AGENT_GUIDE_URL = "https://github.com/dorman/OpenLegion/tree/dev/host-agent"
const DAEMON_README_URL = "https://github.com/dorman/OpenLegion/tree/dev/cmd/openlegion-microvm"

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
  const [store, setStore] = createStore(defaultFormState())

  const arch = createMemo((): "arm64" | "x64" => props.arch ?? "arm64")

  const configWarnings = createMemo(() =>
    store.kind === "container"
      ? warningsForCreateInput({ volumeHost: store.volumeHost })
      : [],
  )

  function applyTemplate(templateId: string) {
    const template = SANDBOX_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setStore({ ...defaultFormState(), ...template.apply(arch()) })
    setError(undefined)
  }

  async function pickVolume() {
    const host = await platform.openDirectoryPickerDialog?.({
      title: language.t("containers.create.pickVolume"),
    })
    if (!host || Array.isArray(host)) return
    setStore("volumeHost", host)
  }

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

      const cpuCores = parseResource(store.cpuCores)
      const image = store.image.trim()
      if (!image) throw new Error(language.t("containers.create.imageRequired"))

      await props.onCreate({
        kind: store.kind,
        image,
        name: store.name.trim() || undefined,
        cpuCores,
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
          <Show when={store.kind === "kubernetes"}>
            <p class="text-xs leading-relaxed text-v2-text-text-muted">{language.t("containers.create.kubernetesHint")}</p>
          </Show>
        </FormSection>

        <Show when={store.kind === "desktop"}>
          <FormSection title={language.t("containers.create.desktopGuide.title")}>
            <p class="text-sm leading-relaxed text-v2-text-text-base">
              {language.t("containers.create.desktopGuide.intro")}
            </p>
            <ol class="flex flex-col gap-2 text-sm text-v2-text-text-muted">
              <li>1. {language.t("containers.create.desktopGuide.step1")}</li>
              <li>2. {language.t("containers.create.desktopGuide.step2")}</li>
              <li>3. {language.t("containers.create.desktopGuide.step3")}</li>
              <li>4. {language.t("containers.create.desktopGuide.step4")}</li>
            </ol>
            <pre class="overflow-x-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 font-mono text-xs leading-relaxed text-v2-text-text-base">{`sudo ./host-agent/preflight.sh
sudo ./host-agent/setup-kata.sh
sudo ./host-agent/verify.sh`}</pre>
            <div class="flex flex-wrap gap-2">
              <ButtonV2 variant="neutral" onClick={() => platform.openLink(HOST_AGENT_GUIDE_URL)}>
                {language.t("containers.create.desktopGuide.openHostGuide")}
              </ButtonV2>
              <ButtonV2 variant="neutral" onClick={() => platform.openLink(DAEMON_README_URL)}>
                {language.t("containers.create.desktopGuide.openDaemonReadme")}
              </ButtonV2>
            </div>
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

        <Show when={store.kind !== "desktop"}>
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
        </Show>

        <Show when={error()}>
          <p class="text-sm text-v2-text-text-danger">{error()}</p>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()} disabled={pending()}>
          {language.t("common.cancel")}
        </ButtonV2>
        {/* Linux VMs are set up on a research host, not created here, so the
            primary action opens the guide instead of submitting. */}
        <Show
          when={store.kind === "desktop"}
          fallback={
            <ButtonV2
              onClick={() => void submit()}
              disabled={pending() || !store.image.trim()}
            >
              {language.t("containers.create.submit")}
            </ButtonV2>
          }
        >
          <ButtonV2 onClick={() => platform.openLink(HOST_AGENT_GUIDE_URL)}>
            {language.t("containers.create.desktopGuide.openHostGuide")}
          </ButtonV2>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
