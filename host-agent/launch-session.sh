#!/usr/bin/env bash
# OpenLegion host-agent: launch one hardened, Kata-isolated research session.
#
#   ./launch-session.sh [--image IMG] [--name NAME] [--port N] [--memory 2g] [--cpus 2]
#
# Isolation/hardening applied:
#   --runtime kata            micro-VM: own guest kernel + KVM hardware boundary
#   --network <no-egress>     the sample cannot reach the internet (no call-home)
#   --cap-drop ALL            no Linux capabilities
#   --security-opt no-new-privileges   no privilege escalation inside
#   --pids-limit / --memory / --cpus   resource caps (no host exhaustion)
#   non-root user             comes from the image (analyst)
# The session is an UNprivileged container (the opposite of --privileged); only
# the host agent itself is privileged.
set -euo pipefail

IMAGE="${IMAGE:-openlegion/ghidra:12.1.2}"
NAME="${NAME:-re-$(date +%s)-$RANDOM}"
PORT="${PORT:-0}"                 # 0 = let Docker pick a free host port
MEMORY="${MEMORY:-2g}"
CPUS="${CPUS:-2}"
PIDS="${PIDS:-512}"
NOEGRESS_NET="${NOEGRESS_NET:-openlegion-noegress}"
RUNTIME="${RUNTIME:-kata}"

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --memory) MEMORY="$2"; shift 2;;
    --cpus) CPUS="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

# Publish noVNC (6080) to loopback only; the broker/tunnel (or LAN) fronts it.
PUBLISH="127.0.0.1:${PORT}:6080"

cid=$(docker run -d \
  --runtime "$RUNTIME" \
  --name "$NAME" \
  --network "$NOEGRESS_NET" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit "$PIDS" \
  --memory "$MEMORY" \
  --cpus "$CPUS" \
  --publish "$PUBLISH" \
  --label openlegion.session=1 \
  --label "openlegion.created=$(date +%s)" \
  "$IMAGE")

# Resolve the actual published host port (when PORT=0 Docker picks one).
hostport=$(docker port "$NAME" 6080/tcp 2>/dev/null | head -1 | sed 's/.*://')

echo "session:   $NAME"
echo "container: ${cid:0:12}"
echo "runtime:   $RUNTIME (Kata micro-VM)"
echo "network:   $NOEGRESS_NET (no egress)"
echo "url:       http://127.0.0.1:${hostport:-?}/vnc.html?autoconnect=true"
echo
echo "Destroy with: ./destroy-session.sh $NAME"
