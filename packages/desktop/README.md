# OpenLegion Desktop

The OpenLegion Desktop app, built with Electron.

## Development

### Prerequisites

| Tool | Purpose |
| --- | --- |
| [Bun](https://bun.sh) 1.3.14+ | Package manager and scripts |
| [Docker](https://docs.docker.com/get-docker/) or Podman | Container sandboxes |
| [QEMU](https://www.qemu.org/) | Linux desktop VM sandboxes |
| [Go](https://go.dev) 1.22+ | Sandbox daemon (`openlegion-microvm`) |

On **macOS**, Colima is a common Docker backend (`colima start`). Install QEMU with `brew install qemu`.

On **Linux**, install `docker.io` or Podman, QEMU (`qemu-system-x86` / `qemu-system-aarch64`), and build essentials for native modules (`node-pty`, `@parcel/watcher`).

On **Windows**, use Docker Desktop or WSL2-backed Docker, and run the desktop app from Windows or WSL depending on your setup. WSL integration is available under **Settings → Desktop → WSL** in the app.

### Quick start

From the repo root:

```bash
bun install
bun run dev:desktop
```

Or from this package:

```bash
cd packages/desktop
bun install
bun dev
```

`predev` clears Vite's cache and copies channel icons. **Icon regeneration** (`generate-brand-icons.ts`) runs only on macOS; on Linux and Windows the committed assets in `icons/{dev,beta,prod}` are used as-is. Regenerate on macOS when the brand mark changes, then commit the updated PNG/ICNS/ICO files.

### Sandbox daemon

The desktop app can start the Go sandbox daemon automatically. You can also run it manually from the repo root:

```bash
go run ./cmd/openlegion-microvm
```

Use **Sandboxes → Start sandbox daemon** in the UI if Docker/QEMU pills show the daemon as offline.

### Linux desktop VM presets

Curated installer ISOs (Ubuntu 24.04, Debian 13, Fedora 42, Rocky 9, AlmaLinux 9 — arm64 and amd64 variants) are defined in [`packages/app/src/utils/desktop-presets.ts`](../app/src/utils/desktop-presets.ts). The create dialog filters presets by host architecture.

### Theme

Desktop **window chrome** is intentionally dark-only (see comment in `src/renderer/styles.css`). Agent session UI inside the shell still follows the user's appearance settings.

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
bun run build && bun run package
```

Platform-specific packaging:

```bash
bun run package:mac
bun run package:linux
bun run package:win
```

## Troubleshooting

- **Icons look stale after a brand update** — run `bun ./scripts/generate-brand-icons.ts` on macOS, or pull committed icon changes from git.
- **Sandboxes page empty / redirect** — ensure the local OpenLegion server is running and you are on the desktop build (not the web dev shell without `VITE_E2E_DESKTOP`).
- **Desktop VM display blank** — confirm the sandbox daemon and QEMU are available; recreate the VM after installer completion if the QEMU monitor appears instead of the guest desktop.
