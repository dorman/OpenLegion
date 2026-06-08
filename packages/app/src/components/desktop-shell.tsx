import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { A, useLocation } from "@solidjs/router"
import { createMemo, For, ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"

type NavItem = {
  id: string
  label: string
  href: string
  active: (pathname: string) => boolean
}

export function DesktopShell(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettings()
  const language = useLanguage()
  const location = useLocation()
  const dialog = useDialog()

  const enabled = createMemo(() => platform.platform === "desktop" && settings.general.newLayoutDesigns())

  const items = createMemo<NavItem[]>(() => [
    {
      id: "containers",
      label: language.t("containers.nav"),
      href: "/containers",
      active: (pathname) => pathname.startsWith("/containers"),
    },
    {
      id: "agents",
      label: language.t("desktop.nav.agents"),
      href: "/agents",
      active: (pathname) =>
        !pathname.startsWith("/containers") && (pathname === "/agents" || pathname.includes("/session")),
    },
    {
      id: "settings",
      label: language.t("sidebar.settings"),
      href: "/?view=settings",
      active: () => false,
    },
  ])

  function openSettings() {
    void import("@/components/settings-v2").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  return (
    <Show when={enabled()} fallback={props.children}>
      <div class="flex min-h-0 min-w-0 flex-1">
        <nav
          aria-label={language.t("desktop.nav.label")}
          class="flex w-[200px] shrink-0 flex-col gap-1 border-r border-v2-border-border-base bg-v2-background-bg-deep px-3 py-4"
        >
          <For each={items()}>
            {(item) => (
              <Show
                when={item.id !== "settings"}
                fallback={
                  <button type="button" class="desktop-nav-item" onClick={openSettings}>
                    {item.label}
                  </button>
                }
              >
                <A
                  href={item.href}
                  class="desktop-nav-item"
                  data-active={item.active(location.pathname)}
                  aria-current={item.active(location.pathname) ? "page" : undefined}
                >
                  {item.label}
                </A>
              </Show>
            )}
          </For>
        </nav>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
      </div>
    </Show>
  )
}
