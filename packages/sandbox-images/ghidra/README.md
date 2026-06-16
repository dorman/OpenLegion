# Ghidra image (RE desktop + Ghidra)

Ghidra layered onto the reusable [`re-desktop`](../re-desktop) base. The XFCE
desktop, curated RE toolset, X-to-web (noVNC) stack, and non-root `analyst` user
all come from the base; this image just adds Ghidra plus a menu launcher and an
autostart entry. GUI is served on **:6080**.

## Build

The base must be built first:

```sh
docker build -t openlegion/re-desktop:latest packages/sandbox-images/re-desktop
docker build -t openlegion/ghidra:12.1.2     packages/sandbox-images/ghidra
```

Ghidra version/URL are build args (`GHIDRA_VERSION`, `GHIDRA_URL`,
`GHIDRA_SHA256`).

## Run

```sh
docker run --rm -p 6080:6080 openlegion/ghidra:12.1.2
# open http://localhost:6080/vnc.html?autoconnect=true
```

You land on a full XFCE desktop; Ghidra opens automatically (autostart) and is
also in the applications menu under Development. The base's tools (radare2, gdb,
Firefox, a terminal, hex editors, etc.) are all there too.

## Notes

- Ghidra 12 needs JDK 21, which this layer installs (the base ships only the
  desktop, no JDK).
- It analyzes binaries of **any** architecture statically. For malware
  **detonation** use a disposable VM, not this container.
