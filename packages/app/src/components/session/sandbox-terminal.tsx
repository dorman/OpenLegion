import { createResource, onCleanup, Show } from "solid-js"
import { Terminal } from "@/components/terminal"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

// A real, interactive terminal into a sandbox, backed by the server PTY over a
// WebSocket (the same transport regular terminals use). Unlike ContainerTerminal
// — which needs the desktop Electron IPC bridge (platform.containerPty) and is
// therefore desktop-only — this works in the web app too. It spawns the shell
// command resolved by the server (e.g. `docker exec -i <id> sh`) as a PTY.

function toCommand(shellCommand: string): { command: string; args: string[] } {
  // Ensure an interactive TTY inside the container so the shell has a prompt and
  // job control: `docker exec -i …` → `docker exec -it …`. Other transports
  // (e.g. the VM's) have no bare `-i` token and are left untouched.
  const tokens = shellCommand
    .trim()
    .split(/\s+/)
    .map((token) => (token === "-i" ? "-it" : token))
  return { command: tokens[0] ?? "sh", args: tokens.slice(1) }
}

export function SandboxTerminal(props: { command: string; onExit?: () => void }) {
  const sdk = useSDK()
  const language = useLanguage()

  const [pty] = createResource(
    () => props.command,
    async (shellCommand) => {
      const { command, args } = toCommand(shellCommand)
      const created = await sdk.client.pty.create({ title: "sandbox", command, args })
      const id = created.data?.id
      if (!id) throw new Error("Failed to open sandbox terminal")
      return { id, title: created.data?.title ?? "sandbox", titleNumber: 0 }
    },
  )

  onCleanup(() => {
    const session = pty()
    if (session) void sdk.client.pty.remove({ ptyID: session.id }).catch(() => {})
  })

  return (
    <div class="flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-md border border-v2-border-border-base">
      <Show
        when={pty()}
        fallback={
          <div class="flex flex-1 items-center justify-center p-6 text-sm text-v2-text-text-muted">
            <Show when={pty.error} fallback={language.t("terminal.loading")}>
              {String((pty.error as Error)?.message ?? pty.error)}
            </Show>
          </div>
        }
      >
        {(session) => <Terminal class="size-full" pty={session()} autoFocus onCleanup={() => props.onExit?.()} />}
      </Show>
    </div>
  )
}
