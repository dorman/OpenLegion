import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "@openlegion-ai/ui/v2/dialog-v2"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { SANDBOX_TEMPLATES, type SandboxTemplate } from "@/utils/sandbox-templates"

/**
 * "New sandbox" entry point: pick a curated environment (RE workflows first),
 * and an agent chat opens to guide the rest (no forms). Raw runtimes are
 * demoted under "Advanced". The session is started by the caller via onChoose.
 */
export function DialogChooseRuntime(props: { onChoose: (templateId: string) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [showAdvanced, setShowAdvanced] = createSignal(false)

  const featured = createMemo(() => SANDBOX_TEMPLATES.filter((t) => !t.advanced))
  const advanced = createMemo(() => SANDBOX_TEMPLATES.filter((t) => t.advanced))

  function choose(templateId: string) {
    dialog.close()
    props.onChoose(templateId)
  }

  const card = (template: SandboxTemplate) => (
    <button
      type="button"
      onClick={() => choose(template.id)}
      class="flex w-full flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3 text-left transition-colors hover:border-v2-border-border-strong"
    >
      <div class="flex items-center justify-between gap-3">
        <span class={template.pillClass}>{language.t(template.pillKey)}</span>
        <span class="text-v2-text-text-muted" aria-hidden="true">
          →
        </span>
      </div>
      <div class="font-medium text-v2-text-text-base">{language.t(template.labelKey)}</div>
      <p class="text-sm leading-relaxed text-v2-text-text-muted">{language.t(template.descriptionKey)}</p>
    </button>
  )

  return (
    <Dialog
      title={language.t("containers.choose.title")}
      description={language.t("containers.choose.description")}
      size="normal"
      fit
      class="container-create-dialog"
    >
      <div class="flex flex-col gap-3 px-4 pb-2">
        <For each={featured()}>{(template) => card(template)}</For>

        <Show
          when={showAdvanced()}
          fallback={
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              class="self-start text-sm text-v2-text-text-muted underline-offset-2 hover:underline"
            >
              {language.t("containers.choose.advanced.show")}
            </button>
          }
        >
          <div class="mt-1 text-xs font-medium uppercase tracking-wide text-v2-text-text-faint">
            {language.t("containers.choose.advanced.label")}
          </div>
          <For each={advanced()}>{(template) => card(template)}</For>
        </Show>
      </div>
    </Dialog>
  )
}
