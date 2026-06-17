import { Show, createSignal, onMount, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnectionForm, ServerConnectionList, useServerManagementController } from "./dialog-select-server"

export const SettingsServers: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const controller = useServerManagementController()

  const [hostUrl, setHostUrl] = createSignal("")
  const [hostToken, setHostToken] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saved, setSaved] = createSignal(false)

  onMount(async () => {
    const current = await platform.getSandboxHost?.()
    if (current) {
      setHostUrl(current.url)
      setHostToken(current.token)
    }
  })

  async function saveSandboxHost() {
    if (!platform.setSandboxHost) return
    setSaving(true)
    try {
      await platform.setSandboxHost({ url: hostUrl().trim(), token: hostToken().trim() })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col flex-1 min-h-0 max-w-[720px]">
        <Show
          when={controller.isFormMode()}
          fallback={
            <>
              <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
                <div class="flex flex-col gap-1 pt-6 pb-8">
                  <h2 class="text-16-medium text-text-strong">{language.t("status.popover.tab.servers")}</h2>
                </div>
              </div>
              <ServerConnectionList controller={controller} />

              {/* Sandbox daemon — point the app at a local or remote sandbox host. */}
              <Show when={platform.getSandboxHost}>
                <div class="mt-8 flex flex-col gap-3 border-t border-border-weak-base pt-6">
                  <div class="flex flex-col gap-1">
                    <h3 class="text-14-medium text-text-strong">{language.t("settings.sandboxHost.title")}</h3>
                    <p class="text-13-regular text-text-weak">{language.t("settings.sandboxHost.description")}</p>
                  </div>
                  <label class="flex flex-col gap-1">
                    <span class="text-13-medium text-text-weak">{language.t("settings.sandboxHost.url")}</span>
                    <input
                      value={hostUrl()}
                      onInput={(event) => setHostUrl(event.currentTarget.value)}
                      spellcheck={false}
                      autocomplete="off"
                      placeholder="http://127.0.0.1:7420"
                      class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 font-mono text-14-regular text-text-strong outline-none"
                    />
                  </label>
                  <label class="flex flex-col gap-1">
                    <span class="text-13-medium text-text-weak">{language.t("settings.sandboxHost.token")}</span>
                    <input
                      value={hostToken()}
                      onInput={(event) => setHostToken(event.currentTarget.value)}
                      type="password"
                      spellcheck={false}
                      autocomplete="off"
                      placeholder={language.t("settings.sandboxHost.tokenPlaceholder")}
                      class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 font-mono text-14-regular text-text-strong outline-none"
                    />
                  </label>
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void saveSandboxHost()}
                      disabled={saving()}
                      class="rounded-md border border-border-weak-base px-3 py-1.5 text-14-medium text-text-strong hover:bg-surface-base disabled:opacity-50"
                    >
                      {language.t("settings.sandboxHost.save")}
                    </button>
                    <Show when={saved()}>
                      <span class="text-13-regular text-text-weak">{language.t("settings.sandboxHost.saved")}</span>
                    </Show>
                  </div>
                </div>
              </Show>
            </>
          }
        >
          <div class="flex flex-1 min-h-0 flex-col gap-4 pt-6">
            <div class="text-16-medium text-text-strong">{controller.formTitle()}</div>
            <ServerConnectionForm controller={controller} />
          </div>
        </Show>
      </div>
    </div>
  )
}
