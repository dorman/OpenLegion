# OpenLegion CDP desktop image

A pre-baked qcow2 that boots straight into a **headless Chromium** exposing the
Chrome DevTools Protocol on guest port `9222`. The QEMU desktop sandbox forwards
a host port to it (`hostfwd …-:9222`, see `internal/engine/qemu_sandbox.go`) and
the app streams it via `Page.startScreencast` in the `ContainerBrowser` viewer —
far lower input→paint latency than the VNC desktop path, and the same CDP socket
lets an agent drive the browser by DOM later.

## What's inside

The bake installs and enables two systemd units (see `cloud-init/user-data`):

- `chromium-cdp.service` — headless Chromium on `127.0.0.1:9223`
  (`--headless=new --remote-allow-origins=* --window-size=1440,900`).
- `chromium-cdp-forward.service` — `socat` bridging guest `0.0.0.0:9222` →
  `127.0.0.1:9223`, because Chromium refuses to bind its debug port to a
  non-loopback address and QEMU's `hostfwd` can't reach guest loopback.

Based on the Debian 13 arm64 **cloud** image — Debian ships a real `chromium`
apt package on arm64, whereas Ubuntu's is snap-only and awkward headless.

## Build

Run on Linux (e.g. inside the Lima VM from `scripts/lima/`) or a macOS host with
`qemu-system-aarch64`, `qemu-img`, and a seed-builder (`cloud-localds`,
`genisoimage`, `mkisofs`, or `xorriso`):

```sh
packages/desktop-image/build.sh
# -> packages/desktop-image/build/desktop-cdp-arm64.qcow2
```

It downloads the base cloud image, attaches the cloud-init seed, boots once to
provision (the VM powers itself off when done), and leaves the baked qcow2 in
`build/`.

## Use

```sh
export OPENLEGION_QEMU_IMAGE="$PWD/packages/desktop-image/build/desktop-cdp-arm64.qcow2"
```

Create a `kind: desktop` sandbox as usual; the inspect dialog's display tab will
render the CDP browser instead of VNC.

## Notes / known risks

- **First boot** runs the enabled services; give Chromium a few seconds before
  the display connects.
- **Host-header validation:** the daemon bridge dials Chromium with a
  `127.0.0.1:<forwarded-port>` Host. Chromium allows loopback IP hosts, so this
  should pass; if a future Chromium tightens this, the fix is in
  `serveCDP`/`resolveCDPTarget` (`internal/display/bridge.go`).
- This image is **browser-only**. The VNC desktop path stays as the fallback for
  arbitrary GUI apps.
