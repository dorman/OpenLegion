import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { Show } from "solid-js"
import type { JSX } from "solid-js"
import { RuntimeStatusPills } from "@/components/runtime-pill"
import { useLanguage } from "@/context/language"
import type { Platform } from "@/context/platform"
import type { ContainerRuntimeStatus } from "@/utils/containers"

const DISMISS_KEY = "containers.onboarding.dismissed"

/** Async-safe read: desktop storage may return a Promise. */
export async function readOnboardingDismissed(storage?: Platform["storage"]) {
  try {
    const value = await storage?.("openlegion")?.getItem(DISMISS_KEY)
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

/**
 * First-run guide shown as a dialog. The page owns when to open it (first
 * launch, or the header's "Get started" button) and marks it dismissed via
 * the dialog's onClose. CTAs that open other dialogs simply replace this one.
 */
export function DialogContainersOnboarding(props: {
  runtime?: ContainerRuntimeStatus
  daemonReady: boolean
  sandboxCount: number
  onEnsureDaemon: () => void
  onCreate: () => void
  ensuringDaemon: boolean
}) {
  const language = useLanguage()
  const dialog = useDialog()

  const runtime = () => props.runtime
  const stepOneReady = () => props.daemonReady && (runtime()?.docker === true || runtime()?.qemu === true)

  return (
    <Dialog
      title={language.t("containers.onboarding.title")}
      description={language.t("containers.onboarding.description")}
      size="large"
      fit
      class="container-onboarding-dialog"
    >
      <div class="container-onboarding-dialog-body flex flex-col gap-4 px-4 pb-2">
        <ol class="flex flex-col gap-4">
          <OnboardingStep title={language.t("containers.onboarding.step1.title")}>
            <p class="text-sm text-v2-text-text-muted">{language.t("containers.onboarding.step1.description")}</p>
            <Show when={runtime()}>{(status) => <RuntimeStatusPills status={status()} />}</Show>
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
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("containers.onboarding.dismiss")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
