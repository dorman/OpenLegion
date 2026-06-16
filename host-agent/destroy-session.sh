#!/usr/bin/env bash
# OpenLegion host-agent: tear down research sessions (the ephemeral "auto-nuke").
#
#   ./destroy-session.sh <name>        destroy one session
#   ./destroy-session.sh --all         destroy every OpenLegion session
#   ./destroy-session.sh --prune 2h    destroy sessions older than a TTL
#
# Sessions are tagged with label openlegion.session=1 and openlegion.created=<epoch>.
set -euo pipefail

label_filter=(--filter label=openlegion.session=1)

destroy() { docker rm -f "$1" >/dev/null 2>&1 && echo "destroyed $1"; }

case "${1:-}" in
  --all)
    for c in $(docker ps -aq "${label_filter[@]}"); do destroy "$c"; done
    ;;
  --prune)
    ttl="${2:-2h}"
    # Convert TTL (e.g. 2h, 90m, 3600s) to seconds.
    n="${ttl%[hms]}"; unit="${ttl##*[0-9]}"
    case "$unit" in h) secs=$((n*3600));; m) secs=$((n*60));; s|"") secs=$n;; *) echo "bad ttl"; exit 2;; esac
    now=$(date +%s)
    for c in $(docker ps -aq "${label_filter[@]}"); do
      created=$(docker inspect -f '{{ index .Config.Labels "openlegion.created" }}' "$c" 2>/dev/null)
      [ -n "$created" ] || continue
      if [ $((now - created)) -ge "$secs" ]; then destroy "$c"; fi
    done
    ;;
  "" )
    echo "usage: $0 <name> | --all | --prune <ttl>" >&2; exit 2
    ;;
  *)
    destroy "$1"
    ;;
esac
