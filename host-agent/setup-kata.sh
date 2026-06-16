#!/usr/bin/env bash
# OpenLegion host-agent: install + configure the Kata Containers isolation runtime
# on a Debian/Ubuntu host, and register it with Docker as the `kata` runtime.
#
# Each research sandbox then runs as a Kata micro-VM (its own guest kernel + a
# KVM hardware boundary) instead of a shared-kernel container.
#
#   sudo ./setup-kata.sh
#
# Hypervisor: defaults to QEMU. Kata still gives you a lightweight micro-VM with
# QEMU, and it works with Docker out of the box. Firecracker uses slightly less
# RAM but additionally requires the containerd `devmapper` snapshotter, which is
# fragile to set up — treat it as an advanced opt-in (see the FIRECRACKER note).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo $0" >&2; exit 1; }
[ "$(uname -m)" = "x86_64" ] || echo "warning: non-x86_64 host; x86 samples will need emulation" >&2

KATA_VERSION="${KATA_VERSION:-}"        # empty = latest release
KATA_RUNTIME_PATH="/opt/kata/bin/kata-runtime"
NOEGRESS_NET="${NOEGRESS_NET:-openlegion-noegress}"
DEFAULT_MEMORY_MB="${DEFAULT_MEMORY_MB:-256}"   # guest kernel overhead cap

echo "==> Installing prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg jq tar xz-utils

echo "==> Installing Docker (if absent)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Installing Kata Containers (static release)"
if [ -z "$KATA_VERSION" ]; then
  KATA_VERSION="$(curl -fsSL https://api.github.com/repos/kata-containers/kata-containers/releases/latest | jq -r .tag_name)"
fi
echo "    version: $KATA_VERSION"
KATA_TARBALL="kata-static-${KATA_VERSION}-x86_64.tar.xz"
curl -fL "https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/${KATA_TARBALL}" -o /tmp/kata.tar.xz
# The tarball lays down ./opt/kata/... so extracting at / installs to /opt/kata.
tar -xf /tmp/kata.tar.xz -C /
rm -f /tmp/kata.tar.xz
[ -x "$KATA_RUNTIME_PATH" ] || { echo "error: $KATA_RUNTIME_PATH not found after install" >&2; exit 1; }

echo "==> Selecting QEMU hypervisor and capping guest memory overhead (${DEFAULT_MEMORY_MB}MB)"
KATA_CFG="/opt/kata/share/defaults/kata-containers/configuration.toml"
# configuration.toml defaults to QEMU. Shrink the guest's default memory so each
# micro-VM's overhead stays small.
if [ -f "$KATA_CFG" ]; then
  sed -i -E "s/^default_memory[[:space:]]*=.*/default_memory = ${DEFAULT_MEMORY_MB}/" "$KATA_CFG" || true
fi

# --- FIRECRACKER (advanced, opt-in) -----------------------------------------
# To use Firecracker instead of QEMU you must ALSO set up the containerd
# devmapper snapshotter, then point Kata at configuration-fc.toml:
#   export KATA_CONF_FILE=/opt/kata/share/defaults/kata-containers/configuration-fc.toml
# This script does not automate devmapper — QEMU is the reliable default.

echo "==> Registering the 'kata' runtime with Docker"
DOCKER_CFG="/etc/docker/daemon.json"
mkdir -p /etc/docker
# Merge a kata runtime into daemon.json without clobbering existing settings.
if [ -f "$DOCKER_CFG" ]; then
  tmp="$(mktemp)"
  jq --arg p "$KATA_RUNTIME_PATH" '.runtimes.kata = {"path": $p}' "$DOCKER_CFG" > "$tmp" && mv "$tmp" "$DOCKER_CFG"
else
  cat > "$DOCKER_CFG" <<EOF
{
  "runtimes": {
    "kata": { "path": "${KATA_RUNTIME_PATH}" }
  }
}
EOF
fi

echo "==> Restarting Docker"
systemctl restart docker

echo "==> Creating the no-egress sandbox network ('${NOEGRESS_NET}')"
# --internal blocks the container from reaching the outside world (no NAT / no
# default route), which is the network half of "the sample can't call home".
docker network inspect "$NOEGRESS_NET" >/dev/null 2>&1 \
  || docker network create --driver bridge --internal "$NOEGRESS_NET"

echo
echo "Done. Kata runtime: $KATA_RUNTIME_PATH ; no-egress net: $NOEGRESS_NET"
echo "Validate it actually isolates with:  sudo ./verify.sh"
echo
echo "NOTE: Docker's kata wiring is version-sensitive. If 'docker run --runtime kata'"
echo "fails, check 'docker info | grep -iA3 runtimes' and the Kata release notes for"
echo "the correct runtime/shim path — verify.sh will tell you if it's working."
