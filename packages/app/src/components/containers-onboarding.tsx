import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { Platform } from "@/context/platform"
import type { ContainerRuntimeStatus } from "@/utils/containers"

const DISMISS_KEY = "containers.onboarding.dismissed"

export function readOnboardingDismissed(storage?: Platform["storage"]) {
  try {
    const value = storage?.("openlegion")?.getItem(DISMISS_KEY)
    if (value instanceof Promise) return false
    return value === "1"
  } catch {
    return false
  }
}

export function dismissOnboarding(storage?: Platform["storage"]) {
  try {
    storage?.("openlegion")?.setItem(DISMISS_KEY, "1")
  } catch {}
}

export function ContainersOnboarding(props: {
  runtime?: ContainerRuntimeStatus
  daemonReady: boolean
  onEnsureDaemon: () => void
  onCreate: () => void
  ensuringDaemon: boolean
  storage?: Platform["storage"]
}) {
  const language = useLanguage()
  const [dismissed, setDismissed] = createSignal(readOnboardingDismissed(props.storage))

  if (dismissed()) return null

  const runtime = () => props.runtime
  const stepOneReady = () => props.daemonReady && (runtime()?.docker === true || runtime()?.qemu === true)

  return (
    <section class="rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-base text-v2-text-text-base">{language.t("containers.onboarding.title")}</h2>
          <p class="mt-1 text-sm leading-relaxed text-v2-text-text-muted">{language.t("containers.onboarding.description")}</p>
        </div>
        <ButtonV2
          variant="ghost"
          size="normal"
          onClick={() => {
            dismissOnboarding(props.storage)
            setDismissed(true)
          }}
        >
          {language.t("containers.onboarding.dismiss")}
        </ButtonV2>
      </div>

      <ol class="mt-5 flex flex-col gap-4">
        <li class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
          <div class="text-sm font-medium text-v2-text-text-base">{language.t("containers.onboarding.step1.title")}</div>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step1.description")}</p>
          <Show when={!props.daemonReady}>
            <ButtonV2 variant="neutral" size="normal" onClick={props.onEnsureDaemon} disabled={props.ensuringDaemon}>
              {props.ensuringDaemon
                ? language.t("containers.ensureDaemon.starting")
                : language.t("containers.ensureDaemon")}
            </ButtonV2>
          </Show>
          <Show when={props.daemonReady}>
            <span class="text-sm" style={{ color: "var(--desktop-agent-accent)" }}>
              {language.t("containers.onboarding.step1.ready")}
            </span>
          </Show>
        </li>

        <li class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
          <div class="text-sm font-medium text-v2-text-text-base">{language.t("containers.onboarding.step2.title")}</div>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step2.description")}</p>
          <ButtonV2 size="normal" onClick={props.onCreate} disabled={!stepOneReady() || !runtime()?.arch}>
            {language.t("containers.new")}
          </ButtonV2>
        </li>

        <li class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
          <div class="text-sm font-medium text-v2-text-text-base">{language.t("containers.onboarding.step3.title")}</div>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step3.description")}</p>
        </li>
      </ol>
    </section>
  )
}
