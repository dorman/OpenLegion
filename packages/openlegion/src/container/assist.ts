import { Effect } from "effect"
import type * as Container from "."
import type { SessionSandbox } from "./session"

const LOG_TAIL_LINES = 30
const MAX_LOG_BYTES = 4_000

/**
 * Static knowledge about how the sandbox runtime works, included in every
 * sandbox-scoped session so the agent does not have to rediscover the
 * topology or the common failure modes.
 */
const RUNTIME_GUIDE = `How the sandbox runtime works:
- Sandboxes are managed by the local OpenLegion runtime. They are docker/podman containers, or QEMU microVMs (runtime "microvm"); kind "desktop" is a graphical Linux VM exposed over VNC.
- Operate on sandboxes with the sandbox_* tools: sandbox_list, sandbox_inspect, sandbox_logs, sandbox_exec, sandbox_screenshot, sandbox_start, sandbox_stop, sandbox_create, sandbox_delete. sandbox_exec runs a non-interactive sh command inside the sandbox (no TTY).
- For desktop VMs, sandbox_screenshot shows the current screen — use it whenever the question involves what the user sees (login prompts, installers, error dialogs, a blank screen).
- For desktop VMs, sandbox_logs returns boot/console output. If it shows a "(qemu)" prompt, the VM dropped into the QEMU monitor instead of booting Linux: the disk image is likely missing or corrupt, so recreate the desktop rather than debugging inside it.
- Container workloads exit when their main command finishes; a sandbox that immediately stops usually needs a long-running command (for example sleep 3600).

Triage guidance:
- Start with the live status above, then sandbox_logs, then sandbox_exec probes. Prefer reading state over restarting things.
- No network inside a sandbox: check interfaces and addresses (ip a), default route (ip route), DNS (cat /etc/resolv.conf), then test in order: ping the gateway, ping 1.1.1.1, then a DNS lookup. Where the chain first fails tells you the layer: interface/DHCP, routing/NAT, or DNS.
- Desktop VM seems frozen or blank: confirm the VM process is running (sandbox_list), check console output for kernel panics or OOM kills, and remember the first boot of a fresh image can take a while.
- Before destructive actions (sandbox_delete, or commands that wipe data), confirm with the user unless they already asked for exactly that.`

function header(sandbox: SessionSandbox, live?: Container.Info) {
  const label = sandbox.name ?? live?.name ?? sandbox.id.slice(0, 12)
  const lines = [
    `This session is dedicated to assisting with the user's sandbox "${label}".`,
    "",
    "Sandbox (live state, refreshed every turn):",
    `- id: ${sandbox.id}`,
    `- image: ${live?.image ?? sandbox.image ?? "unknown"}`,
    `- runtime: ${live?.runtime ?? sandbox.runtime ?? "unknown"}`,
    `- kind: ${live?.kind ?? sandbox.kind ?? "container"}`,
  ]
  if (live) {
    lines.push(`- status: ${live.status ?? "unknown"}`)
  } else {
    lines.push("- status: not found — the sandbox may have been deleted or the runtime may be unavailable")
  }
  return lines
}

function tailLogs(logs: string) {
  const lines = logs.trimEnd().split("\n")
  const tail = lines.slice(-LOG_TAIL_LINES).join("\n")
  if (tail.length <= MAX_LOG_BYTES) return tail
  return tail.slice(tail.length - MAX_LOG_BYTES)
}

/**
 * Build the system prompt section for a sandbox-scoped session. Never fails:
 * live state that cannot be fetched degrades to a note so the prompt loop is
 * never blocked by the container runtime.
 */
export function sandboxSystemPrompt(
  container: Container.Interface,
  sandbox: SessionSandbox,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const live = yield* container.list().pipe(
      Effect.map((items) => items.find((item) => item.id === sandbox.id)),
      Effect.catch(() => Effect.succeed(undefined)),
    )

    const logs = live
      ? yield* container.logs(sandbox.id, { tail: LOG_TAIL_LINES }).pipe(
          Effect.map((result) => tailLogs(result.logs)),
          Effect.catch(() => Effect.succeed("")),
        )
      : ""

    const sections = [...header(sandbox, live)]
    if (logs.trim() !== "") {
      sections.push("", `Recent logs (last ${LOG_TAIL_LINES} lines):`, "```", logs, "```")
    }
    sections.push("", RUNTIME_GUIDE)

    return ["<sandbox-context>", ...sections, "</sandbox-context>"].join("\n")
  })
}
