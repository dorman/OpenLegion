# Requirements & configuration

## Requirements

- [Bun](https://bun.sh) **1.3.14+**
- [Docker](https://docs.docker.com/get-docker/) (or Podman) for container sandboxes — on macOS, [Colima](https://github.com/abiosoft/colima) is a common local Docker backend
- [QEMU](https://www.qemu.org/) (`brew install qemu`) for desktop sandboxes on macOS
- [Go](https://go.dev) **1.22+** (to build/run the sandbox daemon locally)
- [`kind`](https://kind.sigs.k8s.io/) and [`kubectl`](https://kubernetes.io/docs/tasks/tools/) — only for Kubernetes sandboxes
- A dedicated Linux host with hardware virtualization (KVM / VT-x / AMD-V) — only for the Kata research path; run [`host-agent/preflight.sh`](../host-agent/preflight.sh) to check capability
- macOS, Linux, or Windows (desktop development is most tested on **macOS** today; icon regeneration in `predev` uses macOS `sips`/`iconutil` — Linux/Windows dev builds use committed icons under `packages/desktop/icons/`)

## Config paths

| Path             | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `~/.openlegion/` | Global settings, auth, custom agents/commands |
| `.openlegion/`   | Per-project overrides                         |

See [`.openlegion/`](../.openlegion/) for sample agents and commands.

## Environment variables

All use the `OPENLEGION_*` prefix. Sandbox-related ones:

| Variable | Purpose |
| --- | --- |
| `OPENLEGION_CONTAINER_RUNTIME` | Prefer `microvm`, `docker`, or `podman` |
| `OPENLEGION_MICROVM_URL` | Sandbox daemon URL (default `http://127.0.0.1:7420`) |
| `OPENLEGION_MICROVM_LISTEN` | Daemon listen address (default loopback; `0.0.0.0:7420` exposes it on the LAN — set `OPENLEGION_MICROVM_TOKEN` when you do) |
| `OPENLEGION_MICROVM_TOKEN` | Bearer token required on the daemon's control API (recommended whenever it listens on the LAN) |
| `OPENLEGION_SANDBOX_ROOT` | Sandbox metadata directory (default `~/.openlegion/sandboxes`) |
| `OPENLEGION_QEMU_IMAGE` | Path to an installer ISO or qcow2 for `kind: desktop` (e.g. the baked CDP browser image from `packages/desktop-image/`) |
| `OPENLEGION_QEMU_ROOT` | Desktop VM disks (default `~/.openlegion/qemu-vms`) |
| `OPENLEGION_QEMU_MEMORY_MB` | RAM for desktop sandboxes (default `2048`) |
| `OPENLEGION_KIND_BIN` / `OPENLEGION_KUBECTL_BIN` | `kind` / `kubectl` binary paths for Kubernetes sandboxes |
| `OPENLEGION_KATA_RUNTIME` | Docker runtime name for Kata research VMs (default `kata`) |
| `OPENLEGION_KATA_NETWORK` | No-egress network for research VMs (default `openlegion-noegress`) |
| `OPENLEGION_KATA_IMAGE` | Default RE desktop image (default `openlegion/ghidra:12.1.2`) |

The daemon's own API and variables are documented in the [daemon README](../cmd/openlegion-microvm/README.md).
