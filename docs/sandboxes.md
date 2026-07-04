# Sandboxes

What you can do with sandboxes today, the desktop UI around them, and how OpenLegion compares to other RE tooling.

## Sandbox features

| Feature | Description |
| --- | --- |
| **Create container sandboxes** | Desktop dialog or CLI — image, name, command, ports, bind mounts |
| **Create desktop sandboxes** | `kind: desktop` with a curated installer ISO (Ubuntu, Debian, Fedora, Rocky, AlmaLinux — filtered by host arm64/amd64; see [desktop presets](../packages/app/src/utils/desktop-presets.ts)) or a custom qcow2/ISO; installer images cache under `~/.openlegion/images`, VM disks under `~/.openlegion/qemu-vms` |
| **Create Kubernetes sandboxes** | `kind: kubernetes` runs the image as a Deployment in its own namespace on a local `kind` cluster (provisioned on first use); shares the host kernel, kept as an advanced isolation option |
| **Research / RE desktops** | Kata micro-VMs (own guest kernel + KVM boundary) on a no-egress network, using prebuilt RE desktop images ([`re-desktop`](../packages/sandbox-images/re-desktop/) + [`ghidra`](../packages/sandbox-images/ghidra/)); launched on a dedicated research host via the [host-agent scripts](../host-agent/) |
| **Offline / isolated networks** | Create a sandbox with no network from the first instant (`--network none`), or toggle a running one online/offline; research VMs run on a no-egress network so samples cannot call home |
| **Snapshot / revert** | Capture a sandbox's state and restore a clean baseline between runs (Docker today) |
| **Start stopped workloads** | Restart stopped containers, Kubernetes workloads, and desktop VMs from the UI or `POST /global/containers/:id/start` |
| **Logs, shell, desktop & audit** | Inspect dialog with **Logs**, **Shell**, **Desktop**, and **Audit** tabs; the desktop view uses VNC for QEMU/research desktops or a CDP browser stream for the headless-Chromium image |
| **In-sandbox terminal** | A real interactive shell into a running sandbox over the server PTY (works on web, not just desktop) |
| **Agent computer-use** | `sandbox_screenshot` and `sandbox_input` let an agent see the screen and send keyboard/mouse over VNC or CDP |
| **Runtime status** | Docker, sandbox daemon, and QEMU availability shown in onboarding and on the sandboxes page, with remediation guidance |
| **Open agent session** | Bind a host project into a container sandbox and start/resume an agent with `openlegion.container` metadata |
| **In-sandbox file tools** | When a session has container metadata, `read`, `write`, and `edit` run inside the workload via `docker exec` |
| **In-sandbox shell** | Shell tool wraps commands in `docker exec` for linked sessions |
| **Workload badges** | Container, Kubernetes, and desktop sandboxes shown with distinct pill styling in the UI |
| **Container workspaces** | Stored in `~/.openlegion/data/container-workspaces.json` |

## Desktop UI

- **Sandboxes page** — curated RE environments front and center, guided empty-state cards, card layout with workload type and running/stopped pills, isolated-network label, and actions (open session, inspect, start, stop, remove)
- **Onboarding** — guided setup for daemon readiness, first sandbox creation, and inspect/session workflow
- **Create sandbox dialog** — RE environments (detonation, RE toolkit, Ghidra) lead the picker; raw runtimes (Docker, Kubernetes, desktop) are demoted under "Advanced"
- **Inspect sandbox** — modal with **Logs**, **Shell**, **Desktop**, and **Audit** tabs; the Desktop tab streams VNC or, for the headless-Chromium image, CDP
- **Agents page** — recent agent sessions (`/agents`)
- **Settings** — in-app settings dialog from the sidebar
- **Dev builds** — channel badge and app version in the titlebar
- **Theme** — dark charcoal shell with green accents, orange agent-session highlights, and monospace typography on desktop. The Electron chrome is **dark-only by design**; the in-app settings theme still applies inside agent sessions on web/desktop builds.

## How it compares

The relevant comparison isn't Docker Desktop — it's the RE/detonation toolchain. OpenLegion aims to be the **local workbench** that ties detonation, isolation, and analysis together, and it is complementary to (not a replacement for) cloud AI-binary-intelligence services.

|                   | Cloud sandboxes (Any.Run, Joe) | DIY VMs (FLARE-VM, REMnux, CAPE) | OpenLegion (today)                                            |
| ----------------- | ------------------------------ | -------------------------------- | ------------------------------------------------------------- |
| **Runs where**    | Vendor cloud                   | Your VMs (manual)                | **Local only** — your hardware                                |
| **Samples leave your machine?** | Yes                 | No                               | **No**                                                        |
| **Isolation**     | Vendor-managed                 | VM (manual setup)                | **Per-task**: Docker container → Kata micro-VM (own kernel, no egress) |
| **Offline detonation** | Limited                   | Manual                           | **Default** — no network from creation                        |
| **Snapshot / revert** | Vendor UI                  | Manual VM snapshots              | **One-click**                                                 |
| **AI assistance** | Vendor's engine                | None built-in                    | **Built-in**, permissioned, runs *inside* the sandbox         |

Cloud AI-RE services (e.g. binary-similarity/classification) are a natural **enrichment plug-in**, not a competitor: detonate locally, then optionally send hashes/features (never the raw sample) out for analysis and aggregate the result here.
