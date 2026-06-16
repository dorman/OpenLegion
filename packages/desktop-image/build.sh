#!/usr/bin/env bash
#
# Bake the OpenLegion CDP desktop image (option B: pre-baked base image).
#
# Boots a Debian arm64 cloud image once with the cloud-init seed in cloud-init/,
# which installs headless Chromium + a debug-port forwarder and enables them as
# systemd units, then powers off. The resulting qcow2 boots straight into a
# CDP-ready browser — point OPENLEGION_QEMU_IMAGE at it.
#
# Requirements (run on Linux — e.g. inside the Lima VM from scripts/lima — or on
# a macOS host with these tools): qemu-system-aarch64, qemu-img, and one of
# `cloud-localds`, `genisoimage`/`mkisofs`, or `xorriso` to build the seed.
#
# Usage:
#   packages/desktop-image/build.sh [output.qcow2]
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$HERE/build}"
OUT="${1:-$HERE/build/desktop-cdp-arm64.qcow2}"
DISK_SIZE="${DISK_SIZE:-12G}"
MEM="${MEM:-2048}"

# Debian 13 (trixie) generic cloud image for arm64 — ships a real chromium deb.
BASE_URL="${BASE_URL:-https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-arm64.qcow2}"
BASE_IMG="$WORK/$(basename "$BASE_URL")"

mkdir -p "$WORK"

echo "==> Downloading base cloud image"
if [ ! -f "$BASE_IMG" ]; then
  curl -fL --retry 3 -o "$BASE_IMG" "$BASE_URL"
else
  echo "    cached: $BASE_IMG"
fi

echo "==> Preparing working disk ($DISK_SIZE)"
cp -f "$BASE_IMG" "$OUT"
qemu-img resize "$OUT" "$DISK_SIZE"

echo "==> Building cloud-init seed (NoCloud, volume label cidata)"
SEED="$WORK/seed.iso"
if command -v cloud-localds >/dev/null 2>&1; then
  cloud-localds "$SEED" "$HERE/cloud-init/user-data" "$HERE/cloud-init/meta-data"
elif command -v genisoimage >/dev/null 2>&1; then
  genisoimage -output "$SEED" -volid cidata -joliet -rock \
    "$HERE/cloud-init/user-data" "$HERE/cloud-init/meta-data"
elif command -v mkisofs >/dev/null 2>&1; then
  mkisofs -output "$SEED" -volid cidata -joliet -rock \
    "$HERE/cloud-init/user-data" "$HERE/cloud-init/meta-data"
elif command -v xorriso >/dev/null 2>&1; then
  xorriso -as mkisofs -output "$SEED" -volid cidata -joliet -rock \
    "$HERE/cloud-init/user-data" "$HERE/cloud-init/meta-data"
elif command -v hdiutil >/dev/null 2>&1; then
  # macOS: stage the files and build a cidata-labelled ISO9660 image.
  SEEDDIR="$WORK/seed"
  rm -rf "$SEEDDIR" "$SEED"; mkdir -p "$SEEDDIR"
  cp "$HERE/cloud-init/user-data" "$HERE/cloud-init/meta-data" "$SEEDDIR/"
  hdiutil makehybrid -iso -joliet -default-volume-name cidata -o "$WORK/seed" "$SEEDDIR" >/dev/null
  [ -f "$SEED" ] || { echo "error: hdiutil did not produce $SEED" >&2; exit 1; }
else
  echo "error: need one of cloud-localds, genisoimage, mkisofs, xorriso, or hdiutil" >&2
  exit 1
fi

# Locate UEFI code firmware + a vars template (cloud images are UEFI). Mirror
# what the app's qemuFirmwareArgs uses: read-only code pflash + a writable vars
# pflash copied from the template.
FW_CODE=""; FW_VARS_TMPL=""
for d in /opt/homebrew/share/qemu /usr/local/share/qemu /usr/share/AAVMF /usr/share/qemu-efi-aarch64; do
  for code in edk2-aarch64-code.fd AAVMF_CODE.fd QEMU_EFI.fd; do
    [ -z "$FW_CODE" ] && [ -f "$d/$code" ] && FW_CODE="$d/$code"
  done
  for vars in edk2-arm-vars.fd AAVMF_VARS.fd QEMU_VARS.fd; do
    [ -z "$FW_VARS_TMPL" ] && [ -f "$d/$vars" ] && FW_VARS_TMPL="$d/$vars"
  done
done
[ -n "$FW_CODE" ] || { echo "error: no aarch64 UEFI code firmware found" >&2; exit 1; }
FW_VARS="$WORK/uefi-vars.fd"
[ -n "$FW_VARS_TMPL" ] && cp -f "$FW_VARS_TMPL" "$FW_VARS"

FW_ARGS=(-drive "if=pflash,format=raw,readonly=on,file=$FW_CODE")
[ -f "$FW_VARS" ] && FW_ARGS+=(-drive "if=pflash,format=raw,file=$FW_VARS")

# Use hardware accel where available (hvf on macOS, kvm on Linux). `-cpu host`
# is only valid with hardware accel; fall back to an emulated core under TCG.
ACCEL="tcg"
CPU="cortex-a72"
case "$(uname -s)" in
  Darwin) ACCEL="hvf"; CPU="host" ;;
  Linux) [ -e /dev/kvm ] && { ACCEL="kvm"; CPU="host"; } ;;
esac

echo "==> Booting once to provision (accel=$ACCEL); VM powers off when done"
qemu-system-aarch64 \
  -machine virt -accel "$ACCEL" -cpu "$CPU" -m "$MEM" \
  "${FW_ARGS[@]}" \
  -drive "if=virtio,file=$OUT,format=qcow2" \
  -drive "if=virtio,file=$SEED,format=raw,readonly=on" \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  -nographic -serial mon:stdio -no-reboot

echo "==> Done. Baked image: $OUT"
echo "    export OPENLEGION_QEMU_IMAGE=\"$OUT\""
