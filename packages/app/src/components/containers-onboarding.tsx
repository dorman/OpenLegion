import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { createSignal, Show } from "solid-js"
import type { JSX } from "solid-js"
import { RuntimePill } from "@/components/runtime-pill"
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

function OnboardingStep(props: { title: string; children: JSX.Element }) {
  return (
    <li class="flex flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4">
      <div class="text-sm font-medium text-v2-text-text-base">{props.title}</div>
      <div class="desktop-onboarding-prose flex flex-col gap-2">{props.children}</div>
    </li>
  )
}

export function ContainersOnboarding(props: {
  runtime?: ContainerRuntimeStatus
  daemonReady: boolean
  sandboxCount: number
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
        <div class="desktop-onboarding-prose">
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
        <OnboardingStep title={language.t("containers.onboarding.step1.title")}>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step1.description")}</p>
          <Show when={runtime()}>
            {(status) => (
              <div class="flex flex-wrap gap-2">
                <RuntimePill
                  label={language.t("containers.runtime.docker")}
                  ready={status().docker}
                  readyLabel={language.t("containers.runtime.ready")}
                  unavailableLabel={language.t("containers.runtime.unavailable")}
                />
                <RuntimePill
                  label={language.t("containers.runtime.microvm")}
                  ready={status().microvm}
                  readyLabel={language.t("containers.runtime.ready")}
                  unavailableLabel={language.t("containers.runtime.unavailable")}
                />
                <RuntimePill
                  label={language.t("containers.runtime.qemu")}
                  ready={status().qemu}
                  readyLabel={language.t("containers.runtime.ready")}
                  unavailableLabel={language.t("containers.runtime.unavailable")}
                />
              </div>
            )}
          </Show>
          <Show when={!props.daemonReady}>
            <ButtonV2 variant="neutral" size="normal" onClick={props.onEnsureDaemon} disabled={props.ensuringDaemon}>
              {props.ensuringDaemon
                ? language.t("containers.ensureDaemon.starting")
                : language.t("containers.ensureDaemon")}
            </ButtonV2>
          </Show>
          <Show when={props.daemonReady}>
            <span class="desktop-agent-accent text-sm">{language.t("containers.onboarding.step1.ready")}</span>
          </Show>
        </OnboardingStep>

        <OnboardingStep title={language.t("containers.onboarding.step2.title")}>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step2.description")}</p>
          <ButtonV2 size="normal" onClick={props.onCreate} disabled={!stepOneReady() || !runtime()?.arch}>
            {language.t("containers.new")}
          </ButtonV2>
        </OnboardingStep>

        <OnboardingStep title={language.t("containers.onboarding.step3.title")}>
          <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step3.description")}</p>
          <Show when={props.sandboxCount > 0}>
            <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step3.ready")}</p>
          </Show>
        </OnboardingStep>
      </ol>
    </section>
  )
}
