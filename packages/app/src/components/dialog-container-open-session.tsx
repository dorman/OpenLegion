import { ButtonV2 } from "@openlegion-ai/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@openlegion-ai/ui/v2/dialog-v2"
import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { ContainerInfo } from "@/utils/containers"
import type { ContainerWorkspace } from "@/utils/container-workspaces"
import { DEFAULT_CONTAINER_MOUNT } from "@/utils/container-workspaces"
import { isAgentCapable } from "@/utils/container-workload"

export function DialogContainerOpenSession(props: {
  container: ContainerInfo
  workspace?: ContainerWorkspace
  onOpen: (projectDirectory: string) => Promise<unknown>
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [error, setError] = createSignal<string | undefined>()
  const [pending, setPending] = createSignal(false)
  const [projectDirectory, setProjectDirectory] = createSignal(props.workspace?.hostMount ?? "")

  async function pickDirectory() {
    const host = await platform.openDirectoryPickerDialog?.({
      title: language.t("containers.openSession.pickProject"),
    })
    if (!host || Array.isArray(host)) return
    setProjectDirectory(host)
  }

  async function submit() {
    if (!isAgentCapable(props.container)) {
      setError(language.t("containers.openSession.desktopUnsupported"))
      return
    }

    const directory = projectDirectory().trim()
    if (!directory) {
      setError(language.t("containers.openSession.projectRequired"))
      return
    }

    setError(undefined)
    setPending(true)
    try {
      await props.onOpen(directory)
      dialog.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      title={language.t("containers.openSession.title")}
      description={language.t("containers.openSession.description")}
      size="large"
      fit
    >
      <div class="flex flex-col gap-4 px-4 pb-2">
        <Show when={!isAgentCapable(props.container)}>
          <p class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-sm text-v2-text-text-muted">
            {language.t("containers.openSession.desktopUnsupported")}
          </p>
        </Show>
        <div class="rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-sm">
          <div class="font-mono text-xs text-v2-text-text-muted">{props.container.id}</div>
          <div class="mt-1 text-v2-text-text-base">{props.container.image}</div>
          <Show when={props.workspace?.containerMount ?? DEFAULT_CONTAINER_MOUNT}>
            {(mount) => (
              <div class="mt-2 text-v2-text-text-muted">
                {language.t("containers.openSession.mount", { path: mount() })}
              </div>
            )}
          </Show>
        </div>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-v2-text-text-muted">{language.t("containers.openSession.project")}</span>
          <div class="flex gap-2">
            <input
              class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2"
              placeholder="/host/project"
              value={projectDirectory()}
              onInput={(event) => setProjectDirectory(event.currentTarget.value)}
            />
            <ButtonV2 variant="neutral" onClick={() => void pickDirectory()}>
              {language.t("containers.create.browse")}
            </ButtonV2>
          </div>
        </label>

        <Show when={error()}>
          <p class="text-sm text-v2-text-text-danger">{error()}</p>
        </Show>
      </div>

      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()} disabled={pending()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2 onClick={() => void submit()} disabled={pending() || !isAgentCapable(props.container)}>
          {language.t("containers.openSession.submit")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
