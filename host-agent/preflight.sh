#!/usr/bin/env bash
# OpenLegion host-agent preflight: is this Linux box capable of running
# Kata-isolated research sandboxes? Run BEFORE setup-kata.sh. Reports each check
# and exits non-zero on a hard failure (no virtualization / no KVM).
#
#   sudo ./preflight.sh
set -uo pipefail

PASS=0; WARN=0; FAIL=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; WARN=$((WARN+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }

echo "OpenLegion host preflight"
echo "========================="

# --- OS / arch ---
[ "$(uname -s)" = "Linux" ] && ok "Linux host" || bad "not Linux — the Kata host must be Linux"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ok "arch x86_64 (runs Windows/x86 samples natively)" ;;
  aarch64|arm64) warn "arch $ARCH — Kata works, but x86 samples need emulation (slow)" ;;
  *) warn "arch $ARCH — unusual; verify Kata supports it" ;;
esac

# --- CPU virtualization extensions (VT-x / AMD-V) ---
if grep -qE '(^|[[:space:]])(vmx|svm)([[:space:]]|$)' /proc/cpuinfo 2>/dev/null; then
  ok "CPU virtualization extensions present (vmx/svm)"
else
  bad "no vmx/svm in /proc/cpuinfo — enable VT-x/AMD-V in BIOS/UEFI"
fi

# --- /dev/kvm (the hardware boundary Kata relies on) ---
if [ -e /dev/kvm ]; then
  if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
    ok "/dev/kvm present and accessible"
  else
    warn "/dev/kvm present but not accessible by this user (run as root, or add to the kvm group)"
  fi
else
  bad "/dev/kvm missing — KVM not enabled (BIOS virtualization off, or kvm module not loaded)"
fi

# --- resources ---
MEM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
if   [ "$MEM_GB" -ge 16 ]; then ok "RAM ${MEM_GB}GB"
elif [ "$MEM_GB" -ge 8 ];  then warn "RAM ${MEM_GB}GB — fine for a few sessions; each desktop+Ghidra wants ~1.5-2GB"
else bad "RAM ${MEM_GB}GB — too low for a usable Ghidra session"; fi

CORES=$(nproc 2>/dev/null || echo 1)
[ "$CORES" -ge 4 ] && ok "CPU cores ${CORES}" || warn "CPU cores ${CORES} — 4+ recommended"

DISK_GB=$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
[ "${DISK_GB:-0}" -ge 20 ] && ok "free disk ${DISK_GB}GB" || warn "free disk ${DISK_GB}GB — images need ~10GB+"

# --- distro (setup-kata.sh targets Debian/Ubuntu) ---
if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}${ID_LIKE:-}" in
    *debian*|*ubuntu*) ok "distro ${PRETTY_NAME:-debian-like} (setup-kata.sh supported)" ;;
    *) warn "distro ${PRETTY_NAME:-unknown} — setup-kata.sh assumes apt; adapt for your package manager" ;;
  esac
fi

# --- docker (optional here; setup-kata.sh installs it) ---
command -v docker >/dev/null 2>&1 && ok "docker present ($(docker --version 2>/dev/null))" \
  || warn "docker not installed yet — setup-kata.sh will install it"

echo "-------------------------"
printf "passed %d, warnings %d, failures %d\n" "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "RESULT: not ready — resolve the ✗ items (almost always: enable virtualization in BIOS)."
  exit 1
fi
echo "RESULT: ready. Next: sudo ./setup-kata.sh"
