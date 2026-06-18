import { For } from "solid-js"
import { Dialog } from "@openlegion-ai/ui/v2/dialog-v2"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import type { SandboxRuntime } from "@/utils/container-session"

type RuntimeOption = {
  id: SandboxRuntime
  pillClass: string
  pillKey: string
  titleKey: string
  descriptionKey: string
}

// Docker = green, Kubernetes = amber, Linux VM = blue — mirrors the workload
// pill colors used on the sandbox cards.
const RUNTIME_OPTIONS: RuntimeOption[] = [
  {
    id: "docker",
    pillClass: "desktop-pill desktop-pill-container",
    pillKey: "containers.choose.docker.pill",
    titleKey: "containers.choose.docker.title",
    descriptionKey: "containers.choose.docker.description",
  },
  {
    id: "kubernetes",
    pillClass: "desktop-pill desktop-pill-kubernetes",
    pillKey: "containers.choose.kubernetes.pill",
    titleKey: "containers.choose.kubernetes.title",
    descriptionKey: "containers.choose.kubernetes.description",
  },
  {
    id: "linux-vm",
    pillClass: "desktop-pill desktop-pill-desktop",
    pillKey: "containers.choose.linuxVm.pill",
    titleKey: "containers.choose.linuxVm.title",
    descriptionKey: "containers.choose.linuxVm.description",
  },
]

/**
 * "New sandbox" entry point: pick a runtime, and an agent chat opens to guide
 * the rest (no forms). The actual session is started by the caller via onChoose.
 */
export function DialogChooseRuntime(props: { onChoose: (runtime: SandboxRuntime) => void }) {
  const language = useLanguage()
  const dialog = useDialog()

  function choose(runtime: SandboxRuntime) {
    dialog.close()
    props.onChoose(runtime)
  }

  return (
    <Dialog
      title={language.t("containers.choose.title")}
      description={language.t("containers.choose.description")}
      size="normal"
      fit
      class="container-create-dialog"
    >
      <div class="flex flex-col gap-3 px-4 pb-2">
        <For each={RUNTIME_OPTIONS}>
          {(option) => (
            <button
              type="button"
              onClick={() => choose(option.id)}
              class="flex w-full flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-4 py-3 text-left transition-colors hover:border-v2-border-border-strong"
            >
              <div class="flex items-center justify-between gap-3">
                <span class={option.pillClass}>{language.t(option.pillKey)}</span>
                <span class="text-v2-text-text-muted" aria-hidden="true">
                  →
                </span>
              </div>
              <div class="font-medium text-v2-text-text-base">{language.t(option.titleKey)}</div>
              <p class="text-sm leading-relaxed text-v2-text-text-muted">{language.t(option.descriptionKey)}</p>
            </button>
          )}
        </For>
      </div>
    </Dialog>
  )
}
