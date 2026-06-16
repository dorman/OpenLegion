# RE desktop (base image)

A reusable reverse-engineering **desktop** delivered to a browser over noVNC: a
real **XFCE** session (panel, applications menu, Thunar file manager, terminal)
plus a curated RE/security toolset. Individual tools (Ghidra, etc.) layer on top
of this base — see `../ghidra`.

Runs as a non-root `analyst` user; noVNC is served on **:6080**.

## What's inside

- **Desktop:** XFCE (session, panel, window manager, settings), Thunar, Mousepad,
  Xarchiver, XFCE terminal.
- **X-to-web:** Xvfb → x11vnc → websockify/noVNC.
- **Browser:** Firefox ESR.
- **RE / binary:** gdb, binutils (`strings`/`objdump`/`readelf`/`nm`), `file`,
  binwalk, foremost, ltrace, strace, hexedit, ghex, xxd, hexdump, vim, git.
  (radare2/rizin aren't in Debian trixie's main repo — add via their official
  installer if you want them.)
- **Scripting:** python3 + pip, python3-capstone, yara.
- **Network/forensics:** nmap, tshark.

Curated on purpose — it stays far lighter than a full Kali/REMnux install.

## Build

```sh
docker build -t openlegion/re-desktop:latest packages/sandbox-images/re-desktop
```

## Run (standalone, just the desktop)

```sh
docker run --rm -p 6080:6080 openlegion/re-desktop:latest
# open http://localhost:6080/vnc.html?autoconnect=true
```

## Hardening (deferred phases)

`x11vnc -nopw` assumes an isolated, no-egress network. Add a VNC password or a
front proxy before exposing more broadly, and wrap the container in the isolation
layer (Kata micro-VM on Linux, or QEMU/vz on a Mac).
