import { Button } from "@openlegion-ai/ui/button"
import { Checkbox } from "@openlegion-ai/ui/checkbox"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { Dialog } from "@openlegion-ai/ui/dialog"
import { IconButton } from "@openlegion-ai/ui/icon-button"
import { ProviderIcon } from "@openlegion-ai/ui/provider-icon"
import { TextField } from "@openlegion-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Link } from "@/components/link"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { DialogSelectProvider } from "./dialog-select-provider"

const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const DETECT_TIMEOUT_MS = 4_000

type PresetID = "ollama" | "lmstudio" | "custom"

const PRESETS: Record<PresetID, { providerID: string; name: string; baseURL: string }> = {
  ollama: { providerID: "ollama", name: "Ollama", baseURL: "http://localhost:11434/v1" },
  lmstudio: { providerID: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1" },
  custom: { providerID: "", name: "", baseURL: "" },
}

const PRESET_IDS: PresetID[] = ["ollama", "lmstudio", "custom"]

/** Parse an OpenAI-compatible `/models` response into a list of model ids. */
function parseModelIDs(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  return data.map((m) => (m as { id?: unknown })?.id).filter((id): id is string => typeof id === "string" && !!id)
}

export function DialogLocalProvider(props: { back?: "providers" | "close" }) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const language = useLanguage()

  const [preset, setPreset] = createSignal<PresetID>("ollama")
  const [providerID, setProviderID] = createSignal(PRESETS.ollama.providerID)
  const [name, setName] = createSignal(PRESETS.ollama.name)
  const [baseURL, setBaseURL] = createSignal(PRESETS.ollama.baseURL)
  const [manual, setManual] = createSignal("")
  const [detected, setDetected] = createSignal<string[] | undefined>(undefined)
  const [selected, setSelected] = createStore<Record<string, boolean>>({})
  const [err, setErr] = createStore<{ providerID?: string; baseURL?: string; models?: string }>({})

  const choosePreset = (id: PresetID) => {
    const cfg = PRESETS[id]
    batch(() => {
      setPreset(id)
      setProviderID(cfg.providerID)
      setName(cfg.name)
      setBaseURL(cfg.baseURL)
      setDetected(undefined)
      setSelected(reconcile({}))
      setErr(reconcile({}))
    })
  }

  const selectedModelIDs = createMemo(() => {
    const list = detected()
    if (list) return list.filter((id) => selected[id])
    return Array.from(new Set(manual().split(/[\n,]/).map((s) => s.trim()).filter(Boolean)))
  })

  const goBack = () => {
    if (props.back === "close") return dialog.close()
    dialog.show(() => <DialogSelectProvider />)
  }

  const detectMutation = useMutation(() => ({
    mutationFn: async () => {
      const url = baseURL().trim().replace(/\/+$/, "")
      if (!/^https?:\/\//.test(url)) throw new Error(language.t("provider.local.error.baseURL"))
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS)
      try {
        const res = await fetch(`${url}/models`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return parseModelIDs(await res.json())
      } finally {
        clearTimeout(timeout)
      }
    },
    onSuccess: (ids) => {
      batch(() => {
        setDetected(ids)
        setSelected(reconcile(Object.fromEntries(ids.map((id) => [id, true]))))
        setErr("models", undefined)
      })
    },
  }))

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const id = providerID().trim()
      const url = baseURL().trim().replace(/\/+$/, "")
      const models = selectedModelIDs()
      const disabled = serverSync.data.config.disabled_providers ?? []
      await serverSync.updateConfig({
        provider: {
          [id]: {
            npm: OPENAI_COMPATIBLE,
            name: name().trim() || id,
            options: { baseURL: url },
            models: Object.fromEntries(models.map((m) => [m, { name: m }])),
          },
        },
        disabled_providers: disabled.filter((x) => x !== id),
      })
      return { id, name: name().trim() || id }
    },
    onSuccess: (result) => {
      dialog.close()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
        description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
      })
    },
    onError: (error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  }))

  const validate = () => {
    const id = providerID().trim()
    const url = baseURL().trim()
    const next = {
      providerID: !id
        ? language.t("provider.local.error.providerID.required")
        : !PROVIDER_ID.test(id)
          ? language.t("provider.local.error.providerID.format")
          : undefined,
      baseURL: !url
        ? language.t("provider.local.error.baseURL.required")
        : !/^https?:\/\//.test(url)
          ? language.t("provider.local.error.baseURL")
          : undefined,
      models: selectedModelIDs().length === 0 ? language.t("provider.local.error.models") : undefined,
    }
    setErr(reconcile(next))
    return !next.providerID && !next.baseURL && !next.models
  }

  const save = (e: SubmitEvent) => {
    e.preventDefault()
    if (saveMutation.isPending) return
    if (!validate()) return
    saveMutation.mutate()
  }

  const detectFailed = () => detectMutation.isError

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-3 overflow-y-auto max-h-[60vh]">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id={preset() === "lmstudio" ? "lmstudio" : "synthetic"} class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">{language.t("provider.local.title")}</div>
        </div>

        <form onSubmit={save} class="px-2.5 pb-6 flex flex-col gap-6">
          <p class="text-14-regular text-text-base">
            {language.t("provider.local.description.prefix")}
            <Link href="https://openlegion.dev/docs/providers/#local-models" tabIndex={-1}>
              {language.t("provider.local.description.link")}
            </Link>
            {language.t("provider.local.description.suffix")}
          </p>

          <div class="flex gap-2">
            <For each={PRESET_IDS}>
              {(id) => (
                <Button
                  type="button"
                  size="small"
                  variant={preset() === id ? "primary" : "secondary"}
                  onClick={() => choosePreset(id)}
                >
                  {language.t(`provider.local.preset.${id}`)}
                </Button>
              )}
            </For>
          </div>

          <div class="flex flex-col gap-4">
            <Show when={preset() === "custom"}>
              <TextField
                label={language.t("provider.local.field.providerID.label")}
                placeholder={language.t("provider.local.field.providerID.placeholder")}
                description={language.t("provider.local.field.providerID.description")}
                value={providerID()}
                onChange={(v) => {
                  setProviderID(v)
                  setErr("providerID", undefined)
                }}
                validationState={err.providerID ? "invalid" : undefined}
                error={err.providerID}
              />
              <TextField
                label={language.t("provider.local.field.name.label")}
                placeholder={language.t("provider.local.field.name.placeholder")}
                value={name()}
                onChange={setName}
              />
            </Show>

            <div class="flex gap-2 items-start">
              <div class="flex-1">
                <TextField
                  label={language.t("provider.local.field.baseURL.label")}
                  description={language.t("provider.local.field.baseURL.description")}
                  value={baseURL()}
                  onChange={(v) => {
                    setBaseURL(v)
                    setErr("baseURL", undefined)
                  }}
                  validationState={err.baseURL ? "invalid" : undefined}
                  error={err.baseURL}
                />
              </div>
              <Button
                type="button"
                size="small"
                variant="secondary"
                class="mt-6 shrink-0"
                onClick={() => detectMutation.mutate()}
                disabled={detectMutation.isPending}
              >
                {detectMutation.isPending
                  ? language.t("provider.local.detect.loading")
                  : language.t("provider.local.detect.action")}
              </Button>
            </div>
          </div>

          <div class="flex flex-col gap-3">
            <label class="text-12-medium text-text-weak">{language.t("provider.local.models.label")}</label>

            <Show when={detectMutation.isSuccess && (detected()?.length ?? 0) > 0}>
              <div class="flex flex-col gap-2">
                <For each={detected()}>
                  {(id) => (
                    <Checkbox checked={selected[id]} onChange={(v) => setSelected(id, v)}>
                      {id}
                    </Checkbox>
                  )}
                </For>
              </div>
            </Show>

            <Show when={detectMutation.isSuccess && (detected()?.length ?? 0) === 0}>
              <p class="text-13-regular text-text-weak">{language.t("provider.local.detect.empty")}</p>
            </Show>

            <Show when={detectFailed()}>
              <p class="text-13-regular text-text-weak">{language.t("provider.local.detect.failed")}</p>
            </Show>

            <Show when={!detectMutation.isSuccess || (detected()?.length ?? 0) === 0}>
              <TextField
                label={language.t("provider.local.models.manual.label")}
                hideLabel
                placeholder={language.t("provider.local.models.manual.placeholder")}
                description={language.t("provider.local.models.manual.description")}
                value={manual()}
                onChange={(v) => {
                  setManual(v)
                  setErr("models", undefined)
                }}
                validationState={err.models ? "invalid" : undefined}
                error={err.models}
              />
            </Show>
            <Show when={err.models && (detected()?.length ?? 0) > 0}>
              <p class="text-13-regular text-text-error-base">{err.models}</p>
            </Show>
          </div>

          <Button class="w-auto self-start" type="submit" size="large" variant="primary" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
