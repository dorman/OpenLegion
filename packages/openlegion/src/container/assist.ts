import { Effect } from "effect"
import type * as Container from "."
import type { SessionSandbox, SessionWorkflow } from "./session"

const LOG_TAIL_LINES = 30
const MAX_LOG_BYTES = 4_000

/**
 * Static knowledge about how the sandbox runtime works, included in every
 * sandbox-scoped session so the agent does not have to rediscover the
 * topology or the common failure modes.
 */
const RUNTIME_GUIDE = `How the sandbox runtime works:
- Sandboxes are managed by the local OpenLegion runtime. They are docker/podman containers, or QEMU microVMs (runtime "microvm"); kind "desktop" is a graphical Linux VM exposed over VNC.
- Operate on sandboxes with the sandbox_* tools: sandbox_list, sandbox_inspect, sandbox_logs, sandbox_exec, sandbox_screenshot, sandbox_input, sandbox_start, sandbox_stop, sandbox_create, sandbox_delete. sandbox_exec runs a non-interactive sh command inside the sandbox (no TTY).
- For desktop VMs, sandbox_screenshot shows the current screen. sandbox_input sends keyboard and mouse actions and returns a screenshot of the result — use sandbox_screenshot first to find click coordinates, then sandbox_input to interact (type text, press keys, click buttons). Verify each step from the screenshot sandbox_input returns.
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

// Step-by-step guidance per workflow, injected when a session was started from
// the New Sandbox chooser or the Agents workflow hub (SESSION_WORKFLOW_KEY).
// Keeps the agent driving each flow consistently with the sandbox_* tools.
const WORKFLOW_GUIDES: Record<SessionWorkflow, string> = {
  docker: `The user is creating a Docker container sandbox. Guide them:
1. Ask what the sandbox is for and suggest an image (default alpine:latest); confirm the image.
2. Ask whether it needs an isolated (hardened) network or the default bridge.
3. Create it with sandbox_create (kind "container"). Containers exit when their main command finishes, so give a long-running command (e.g. sleep 3600) unless they specify one.
4. Confirm it is running with sandbox_list, then tell them they can Open session or inspect it.`,
  kubernetes: `The user is creating a Kubernetes sandbox (a workload on the local kind cluster). Guide them:
1. Confirm the image (default alpine:latest) and what they want to run.
2. Create it with sandbox_create (kind "kubernetes"); the first create provisions the kind cluster and can take ~30-60s.
3. Confirm the pod is running with sandbox_list / sandbox_logs before handing back.`,
  "linux-vm": `The user wants a Linux VM research sandbox. These do NOT run in this app — they run as hardware-isolated Kata micro-VMs on a separate Linux host. Do NOT try to create one locally with sandbox_create. Instead walk them through, referencing host-agent/README.md and cmd/openlegion-microvm/README.md:
1. Prerequisites: a dedicated Linux box (Debian/Ubuntu, x86_64) with KVM. Run host-agent/preflight.sh.
2. Install + verify isolation: host-agent/setup-kata.sh then host-agent/verify.sh (don't proceed unless verify passes).
3. Build the RE desktop images and run the daemon bound to the LAN with a token (OPENLEGION_MICROVM_LISTEN/OPENLEGION_MICROVM_TOKEN).
4. Point this app at the host in Settings → Servers → Sandbox daemon (URL + token). Then the VM appears in Sandboxes.`,
  "read-docs": `The user wants help understanding the OpenLegion docs and repo. Ask what they're looking for, then use the read/grep/glob tools to find the answer in README.md, host-agent/, cmd/openlegion-microvm/, and packages/. Cite the files you used.`,
  "debug-net": `The user has a sandbox network problem. Work the layers in order with sandbox_exec:
1. sandbox_list to find the affected sandbox.
2. Inside it: ip a (interfaces/addresses), ip route (default route), cat /etc/resolv.conf (DNS).
3. Test in order: ping the gateway, ping 1.1.1.1, then a DNS lookup. Where the chain first fails tells you the layer (interface/DHCP, routing/NAT, or DNS). Note: research VMs are intentionally on a no-egress network.`,
  "clone-repo": `The user wants to clone a git repo into a sandbox. Ask for the repo URL and which sandbox (or create a container first). Then use sandbox_exec to git clone it into the workspace and report what's inside so they can start working.`,
}

/** System-prompt block for a guided workflow session. */
export function workflowSystemPrompt(workflow: SessionWorkflow): string {
  return ["<workflow-context>", WORKFLOW_GUIDES[workflow], "</workflow-context>"].join("\n")
}
