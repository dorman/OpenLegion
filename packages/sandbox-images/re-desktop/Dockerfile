# Reusable reverse-engineering desktop, delivered over the web (noVNC).
#
# A real XFCE desktop (panel, menu, file manager, terminal) plus a curated set of
# RE/security tools — the "looks like a Linux distro" base that individual tools
# (Ghidra, etc.) layer on top of. Runs as a non-root `analyst` user.
#
# Curated, not kitchen-sink: this stays far lighter than installing all of Kali
# or REMnux, which would defeat the lean-sandbox goal.

FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

# tshark pulls wireshark-common, which otherwise prompts about setuid capture.
RUN echo "wireshark-common wireshark-common/install-setuid boolean false" | debconf-set-selections

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      # --- XFCE desktop ---
      xfce4-session xfwm4 xfce4-panel xfdesktop4 xfce4-settings \
      xfce4-terminal thunar mousepad xarchiver \
      dbus-x11 \
      # --- X-to-web stack ---
      xvfb x11-utils x11vnc novnc websockify \
      fonts-dejavu fonts-liberation \
      # --- browser (threat intel / sample lookups) ---
      firefox-esr \
      # --- RE / binary analysis ---
      # (radare2/rizin aren't in trixie's main repo; Ghidra + objdump + gdb cover
      #  static disassembly. radare2 can be layered in via its official installer.)
      gdb binutils file binwalk foremost ltrace strace \
      hexedit ghex xxd bsdextrautils vim less git \
      # --- scripting ---
      python3 python3-pip python3-capstone yara \
      # --- network / forensics ---
      nmap tshark \
      # --- misc ---
      ca-certificates curl wget unzip procps tini \
 && rm -rf /var/lib/apt/lists/*

# Ensure a machine-id so the dbus session / XFCE come up cleanly.
RUN dbus-uuidgen --ensure

COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Non-root analyst user with a writable home for XFCE + tool configs.
RUN useradd -m -u 1000 -s /bin/bash analyst \
 && mkdir -p /home/analyst/work \
 && chown -R analyst:analyst /home/analyst
USER analyst
ENV HOME=/home/analyst
WORKDIR /home/analyst

# 5900 = raw RFB (x11vnc), which the OpenLegion daemon bridges as a VNC display;
# 6080 = self-served noVNC web client, for direct browser access on the host.
EXPOSE 5900 6080

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/start.sh"]
