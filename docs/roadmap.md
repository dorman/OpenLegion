# Roadmap

## RE workbench (current focus)

- [x] **Multiple isolation levels** — Docker, Kubernetes (`kind`), QEMU desktops, and Kata research micro-VMs behind one daemon
- [x] **Offline-by-default detonation** — create a sandbox with no network from the first instant (`--network none`), plus a one-click online/offline isolation toggle
- [x] **Snapshot / revert** — capture a sandbox's state and restore a clean baseline between runs (Docker today)
- [x] **In-sandbox terminal** — a real interactive shell into a running sandbox, over the server PTY (works on web, not just desktop)
- [x] **Runtime health + remediation** — per-backend status (Docker / sandbox daemon / Podman) with fix-it guidance instead of opaque failures
- [x] **RE-first create flow** — curated environments (detonation, RE toolkit, Ghidra) lead the picker; raw runtimes demoted to "Advanced"
- [x] **CDP browser display** — low-latency Chrome DevTools stream as an alternative to VNC
- [x] **Agent computer-use** — `sandbox_screenshot` / `sandbox_input` over VNC and CDP; agent file/shell tools run inside the sandbox
- [x] **Authenticated daemon** — bearer-token auth on the control API (`OPENLEGION_MICROVM_TOKEN`) for running the daemon on a LAN research host
- [ ] **Reproducible environments** — provision from a setup script / Dockerfile, snapshot the built state, spawn clean instances from it (snapshot-as-golden-image)
- [ ] **Prebuilt RE/detonation images** — surface `re-desktop`/`ghidra` and a behavior-capture detonation image as first-class, tool-loaded presets
- [ ] **Artifact capture** — a defined outputs dir (reports, dumps, pcaps) that's easy to pull out of the sandbox
- [ ] **In-app research desktops** — manage remote Kata/tower daemons directly in the app (Settings connection center)
- [ ] **AI-RE enrichment plug-ins** — optionally send hashes/features (never raw samples) to external binary-intelligence services and aggregate results here

## De-emphasized

The generic DevOps / Kubernetes-workflow ambitions. Those engines remain as isolation options but are no longer a product goal — the focus is the RE analyst.
