import { useDialog } from "@openlegion-ai/ui/context/dialog"
import { A, useLocation } from "@solidjs/router"
import { useQuery } from "@tanstack/solid-query"
import { createEffect, createMemo, For, onCleanup, ParentProps, Show } from "solid-js"
import { RuntimePill } from "@/components/runtime-pill"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { listContainerWorkspaces } from "@/utils/container-workspaces"
import { showToast } from "@/utils/toast"

type NavItem = {
  id: string
  label: string
  href: string
  active: (pathname: string) => boolean
}

export function DesktopShell(props: ParentProps) {
  const platform = usePlatform()
  const server = useServer()
  const settings = useSettings()
  const language = useLanguage()
  const location = useLocation()
  const dialog = useDialog()

  const runtime = useQuery(() => ({
    queryKey: ["desktop-shell", "runtime"],
    enabled: platform.platform === "desktop",
    refetchInterval: 10_000,
    queryFn: async () => platform.containerRuntimeStatus?.(),
  }))

  // Surface the background self-healing guardrail: when the main process detects
  // the local sandbox daemon has gone offline it auto-runs the recovery
  // playbook, and reports the transitions here so the user sees what's happening
  // (and the runtime badge refreshes) without having to report the problem.
  createEffect(() => {
    if (platform.platform !== "desktop" || !platform.onMicrovmDaemonStatus) return
    const stop = platform.onMicrovmDaemonStatus((status) => {
      if (status.state === "recovering") {
        showToast({ title: "Sandbox daemon offline", description: "Trying to reconnect automatically..." })
      } else if (status.state === "recovered") {
        showToast({ variant: "success", icon: "circle-check", title: "Sandbox daemon recovered" })
        void runtime.refetch()
      } else if (status.state === "unrecoverable") {
        showToast({
          variant: "error",
          title: "Could not recover sandbox daemon",
          description: status.error ?? "Open the Sandboxes page to start it manually.",
        })
        void runtime.refetch()
      }
    })
    onCleanup(stop)
  })

  const workspaces = useQuery(() => ({
    queryKey: ["container-workspaces", server.key],
    enabled: platform.platform === "desktop" && server.isLocal() && !!server.current?.http,
    queryFn: async () => {
      const http = server.current?.http
      if (!http) return []
      return listContainerWorkspaces(http)
    },
  }))

  const linkedSandboxes = createMemo(() =>
    (workspaces.data ?? []).filter((item) => item.hostMount && item.sessionId),
  )

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
          <Show when={linkedSandboxes().length > 0}>
            <div class="mt-4 flex flex-col gap-2 border-t border-v2-border-border-base pt-3">
              <div class="px-1 text-[11px] font-medium uppercase tracking-[0.04em] text-v2-text-text-muted">
                {language.t("desktop.linkedSandboxes.title")}
              </div>
              <For each={linkedSandboxes()}>
                {(item) => (
                  <A href="/containers" class="desktop-nav-item text-xs">
                    <span class="truncate">{item.name ?? item.containerId.slice(0, 12)}</span>
                    <span class="truncate text-v2-text-text-faint">{item.hostMount}</span>
                  </A>
                )}
              </For>
            </div>
          </Show>
          <div class="mt-auto flex flex-col gap-2 border-t border-v2-border-border-base pt-3">
            <div class="px-1 text-[11px] font-medium uppercase tracking-[0.04em] text-v2-text-text-muted">
              {language.t("desktop.daemon.title")}
            </div>
            <Show when={runtime.data}>
              {(status) => (
                <RuntimePill
                  label={language.t("containers.runtime.microvm")}
                  ready={status().microvm}
                  readyLabel={language.t("desktop.daemon.ready")}
                  unavailableLabel={language.t("desktop.daemon.unavailable")}
                />
              )}
            </Show>
          </div>
        </nav>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
      </div>
    </Show>
  )
}
