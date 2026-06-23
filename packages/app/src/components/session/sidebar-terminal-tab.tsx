import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useServer } from "@/context/server"
import { ContainerTerminal } from "@/components/container-terminal"
import {
  containerIdsMatch,
  fetchContainerShell,
  listContainersSafe,
  type ContainerInfo,
} from "@/utils/containers"
import { linkedSandboxFromMetadata } from "@/utils/container-workspaces"

export function SidebarTerminalTab(props: { metadata?: Record<string, unknown> }) {
  const server = useServer()
  const [shellCommand, setShellCommand] = createSignal<string | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)

  const linked = createMemo(() => linkedSandboxFromMetadata(props.metadata))
  const http = createMemo(() => server.current?.http)

  const containers = createQuery(() => ({
    queryKey: ["containers", server.key],
    queryFn: () => listContainersSafe(http()!),
    enabled: !!http() && !!linked(),
    refetchInterval: 5_000,
    initialData: [] as ContainerInfo[],
  }))

  const live = createMemo(() => {
    const item = linked()
    if (!item) return undefined
    return (containers.data ?? []).find((c) => containerIdsMatch(c.id, item.id))
  })

  const running = createMemo(() => (live()?.status ?? "stopped") === "running")

  createEffect(
    on(running, (isRunning) => {
      if (!isRunning) {
        setShellCommand(undefined)
        setError(undefined)
        return
      }
      if (shellCommand()) return
      const conn = http()
      const item = linked()
      if (!conn || !item) return
      fetchContainerShell(conn, item.id)
        .then((info) => setShellCommand(info.command))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    }),
  )

  return (
    <div class="flex h-full flex-col">
      <Show
        when={shellCommand()}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-v2-text-text-muted">
            <Show
              when={!error()}
              fallback={<p class="text-v2-text-text-danger">{error()}</p>}
            >
              <Show
                when={running()}
                fallback={
                  <>
                    <p>Sandbox not running</p>
                    <p class="text-xs">Start the sandbox to open a terminal session.</p>
                  </>
                }
              >
                <p>Connecting to shell...</p>
              </Show>
            </Show>
          </div>
        }
      >
        {(cmd) => <ContainerTerminal command={cmd()} active={true} />}
      </Show>
    </div>
  )
}
