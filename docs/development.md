# Development

OpenLegion is a **fork of [OpenCode](https://github.com/anomalyco/opencode)**. The agent runtime, permissions model, desktop shell, and HTTP API come from upstream; the sandbox management, the sandbox daemon, and the in-workload agent tools are the OpenLegion additions.

## What's available now

| Component | Command / location | Notes |
| --- | --- | --- |
| **Desktop app** | `bun run dev:desktop` | Electron UI; desktop builds open on **Sandboxes** by default |
| **Sandboxes UI** | Desktop → **Sandboxes** | Onboarding, runtime pills, RE-first create dialog, inspect, agent sessions |
| **Sandbox daemon** | `go run ./cmd/openlegion-microvm` | Routes per sandbox to its engine: isolated Docker networks, Kubernetes (`kind`), QEMU desktop VMs, and Kata research micro-VMs ([daemon README](../cmd/openlegion-microvm/README.md)) |
| **Research host** | [`host-agent/`](../host-agent/) | Scripts to turn a dedicated Linux box into a Kata-isolated, no-egress analysis host (`preflight` → `setup-kata` → `verify` → `install-daemon`) |
| **Desktop auto-start** | Desktop app launch | Starts the sandbox daemon when possible; **Start sandbox daemon** if it is offline |
| **Container runtime** | `packages/openlegion/src/container/` | Auto-detects sandbox daemon, Docker, or Podman (`OPENLEGION_CONTAINER_RUNTIME`) |
| **Container HTTP API** | `GET/POST /global/containers` | List, create, start, stop, remove, snapshot, and network-isolate sandboxes via the local sidecar |
| **Container workspaces** | `GET/PUT /global/container-workspaces` | Persist bind mounts and session links per sandbox |
| **Container CLI** | `openlegion container list\|create\|start\|stop\|remove\|logs\|shell\|compose-up\|compose-down` | Manage workloads from the terminal |
| **CLI / TUI** | `bun run dev` | Terminal agent (upstream OpenCode behavior) |
| **Web UI** | `bun run dev:web` | Same app shell in the browser for development |
| **Agent runtime** | `packages/openlegion` | Sessions, tools, providers, MCP, plugins |
| **Permissions** | `~/.openlegion` | Gates for files, shell, and tools |

## Commands

| Command               | Description            |
| --------------------- | ---------------------- |
| `bun run dev:desktop` | Desktop management app |
| `bun run dev`         | CLI / TUI agent        |
| `bun run dev:web`     | Web UI dev server      |
| `bun run lint`        | Oxlint                 |
| `bun run typecheck`   | Turbo typecheck        |

Regenerate app icons after updating `packages/ui/src/assets/brand/openlegion-mark.png` (macOS only):

```bash
cd packages/desktop
bun ./scripts/generate-brand-icons.ts
bun ./scripts/copy-icons.ts dev
```

On macOS, `bun run dev:desktop` also regenerates icons on cold start so logo changes are picked up.

## Agents and security

Agents inherit OpenCode's model and tighten for sandbox work:

| Agent       | Role                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| **build**   | Implementation agent — edits and commands allowed per your permission config  |
| **plan**    | Read-only analysis — ideal for reviewing before changes                       |
| **general** | Multi-step search subagent (`@general` in prompts)                            |

When a session is linked to a container sandbox (`openlegion.container` metadata), file and shell tools operate **inside the workload** at the mapped workspace path. Permission prompts include the sandbox id and runtime context.

**Security direction:** default-deny tooling, explicit approval for shell and deploy actions, sandbox-scoped agent context, and local-only storage of secrets and session history — no telemetry requirement for core use.

## Contributing

Security, sandbox, and desktop UX contributions are especially welcome. Read [CONTRIBUTING.md](../CONTRIBUTING.md). Commit format: `type(scope): summary` (e.g. `feat(desktop): polish sandboxes onboarding`).
