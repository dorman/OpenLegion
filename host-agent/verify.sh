#!/usr/bin/env bash
# OpenLegion host-agent: prove the isolation actually holds. This is the
# acceptance gate — a session should NOT start unless this passes, so a
# misconfigured host can't silently downgrade to a weak (shared-kernel) boundary.
#
#   sudo ./verify.sh
#
# It checks three things:
#   1. Docker knows the `kata` runtime.
#   2. A Kata container boots with its OWN guest kernel (≠ host kernel) — i.e. a
#      real VM boundary, not a shared-kernel container.
#   3. A container on the no-egress network genuinely cannot reach the internet.
set -uo pipefail

NOEGRESS_NET="${NOEGRESS_NET:-openlegion-noegress}"
TEST_IMAGE="${TEST_IMAGE:-alpine:latest}"
FAIL=0
ok()  { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=1; }

echo "OpenLegion isolation verification"
echo "================================="

# 1. runtime registered
if docker info 2>/dev/null | grep -qiE 'Runtimes:.*\bkata\b'; then
  ok "Docker has the 'kata' runtime registered"
else
  bad "'kata' runtime not registered with Docker (re-run setup-kata.sh)"
fi

# 2. Kata boots with a separate guest kernel
HOST_KERNEL="$(uname -r)"
echo "  host kernel: $HOST_KERNEL"
if GUEST_KERNEL=$(docker run --rm --runtime kata "$TEST_IMAGE" uname -r 2>/dev/null); then
  echo "  kata guest kernel: $GUEST_KERNEL"
  if [ -n "$GUEST_KERNEL" ] && [ "$GUEST_KERNEL" != "$HOST_KERNEL" ]; then
    ok "Kata container runs its own guest kernel (hardware VM boundary confirmed)"
  else
    bad "guest kernel matches host kernel — NOT isolated as a VM (still shared-kernel)"
  fi
else
  bad "could not start a Kata container (check 'docker run --runtime kata $TEST_IMAGE uname -r')"
fi

# 3. no-egress network blocks the internet
if docker network inspect "$NOEGRESS_NET" >/dev/null 2>&1; then
  # Expect this to FAIL (timeout / no route). Success here = a leak.
  if docker run --rm --runtime kata --network "$NOEGRESS_NET" "$TEST_IMAGE" \
       sh -c 'wget -T 5 -q -O /dev/null https://1.1.1.1 2>/dev/null' ; then
    bad "EGRESS LEAK: a sandbox on '$NOEGRESS_NET' reached the internet"
  else
    ok "no-egress network blocks outbound internet (no call-home)"
  fi
else
  bad "no-egress network '$NOEGRESS_NET' missing (re-run setup-kata.sh)"
fi

echo "---------------------------------"
if [ "$FAIL" -ne 0 ]; then
  echo "RESULT: FAILED — do NOT run untrusted samples until every check passes."
  exit 1
fi
echo "RESULT: PASS — Kata VM boundary + no-egress confirmed. Safe to launch sessions."
