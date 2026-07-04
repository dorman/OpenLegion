#!/usr/bin/env bash
# OpenLegion host-agent: install the sandbox daemon as a persistent systemd
# service on the research tower, so the Mac app can reach it over the LAN.
#
# The daemon (cmd/openlegion-microvm) is the HTTP control plane the desktop app
# talks to (list/create/start/stop sandboxes, logs, shell, VNC/CDP display). This
# script installs the binary, wires a bearer token, and runs it under systemd
# bound to the LAN. Run it AFTER setup-kata.sh (the daemon shells out to Docker +
# the Kata runtime it configures).
#
#   sudo ./install-daemon.sh [--bin PATH] [--listen 0.0.0.0:7420] [--token TOKEN]
#
# Providing the binary (recommended): cross-compile on the Mac and copy it over —
#   GOOS=linux GOARCH=amd64 go build -o openlegion-microvm ./cmd/openlegion-microvm
#   scp openlegion-microvm tower:/tmp/ ; then: sudo ./install-daemon.sh --bin /tmp/openlegion-microvm
# Otherwise, if Go is installed here and the repo is present, it builds from source.
set -euo pipefail

LISTEN="${OPENLEGION_MICROVM_LISTEN:-0.0.0.0:7420}"
TOKEN="${OPENLEGION_MICROVM_TOKEN:-}"
BIN_SRC=""
BIN_DEST="/usr/local/bin/openlegion-microvm"
ENV_FILE="/etc/openlegion/microvm.env"
UNIT="/etc/systemd/system/openlegion-microvm.service"

while [ $# -gt 0 ]; do
  case "$1" in
    --bin) BIN_SRC="$2"; shift 2;;
    --listen) LISTEN="$2"; shift 2;;
    --token) TOKEN="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

if [ "$(id -u)" != "0" ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# --- Resolve the binary: provided > build from source ---
if [ -n "$BIN_SRC" ]; then
  [ -f "$BIN_SRC" ] || { echo "binary not found: $BIN_SRC" >&2; exit 1; }
elif command -v go >/dev/null 2>&1 && [ -f "$(dirname "$0")/../go.mod" ]; then
  echo "Building daemon from source with Go..."
  ( cd "$(dirname "$0")/.." && go build -o /tmp/openlegion-microvm ./cmd/openlegion-microvm )
  BIN_SRC="/tmp/openlegion-microvm"
else
  echo "No --bin provided and cannot build (Go or repo missing)." >&2
  echo "Cross-compile on your Mac and pass it with --bin:" >&2
  echo "  GOOS=linux GOARCH=amd64 go build -o openlegion-microvm ./cmd/openlegion-microvm" >&2
  exit 1
fi

install -m 0755 "$BIN_SRC" "$BIN_DEST"
echo "Installed daemon -> $BIN_DEST"

# --- Token: reuse an existing one, else generate ---
mkdir -p "$(dirname "$ENV_FILE")"
if [ -z "$TOKEN" ] && [ -f "$ENV_FILE" ]; then
  TOKEN="$(sed -n 's/^OPENLEGION_MICROVM_TOKEN=//p' "$ENV_FILE" | head -1)"
fi
if [ -z "$TOKEN" ]; then
  TOKEN="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  echo "Generated a new daemon token."
fi

umask 077
cat > "$ENV_FILE" <<EOF
OPENLEGION_MICROVM_LISTEN=$LISTEN
OPENLEGION_MICROVM_TOKEN=$TOKEN
EOF
chmod 0600 "$ENV_FILE"

# --- systemd unit. Runs as root (the daemon shells to Docker + the Kata runtime).
# Hardening is intentionally light so it does not block Docker socket access. ---
cat > "$UNIT" <<EOF
[Unit]
Description=OpenLegion sandbox daemon (microvm control plane)
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_DEST
Restart=always
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now openlegion-microvm.service

echo
echo "OpenLegion sandbox daemon is running."
echo "  Listening on : http://$LISTEN"
echo "  Status       : systemctl status openlegion-microvm"
echo "  Logs         : journalctl -u openlegion-microvm -f"
echo
echo "Connect the Mac app (Settings → sandbox host, or ~/.openlegion/sandbox-host.json):"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "  URL   : http://${LAN_IP:-<tower-ip>}:${LISTEN##*:}"
echo "  Token : $TOKEN"
echo
echo "Keep the token secret — it authenticates full control of this host's sandboxes."
