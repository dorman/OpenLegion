#!/usr/bin/env bash
# OpenLegion Heartbeat — pulse-checks all vital systems and refreshes every N seconds.
# Usage: ./scripts/heartbeat.sh [interval_seconds]   (default: 5)

INTERVAL="${1:-5}"
USERDATA_DIR="$HOME/Library/Application Support/ai.openlegion.desktop.dev"
SANDBOX_HOST_FILE="$HOME/.openlegion/sandbox-host.json"

# ── ANSI colours ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

OK="${GREEN}✓${RESET}"
FAIL="${RED}✗${RESET}"
WARN="${YELLOW}~${RESET}"

# ── helpers ──────────────────────────────────────────────────────────────────

# Return the sidecar URL from the most recent log run, or "" if not found.
discover_sidecar_url() {
  local latest_run
  latest_run=$(ls -1t "$USERDATA_DIR/logs/" 2>/dev/null | head -1)
  [[ -z "$latest_run" ]] && return
  grep -m1 "sidecar connection started" "$USERDATA_DIR/logs/$latest_run/main.log" 2>/dev/null \
    | grep -oE "http://[^'\" ]+"
}

# HTTP GET with a short timeout; prints HTTP status code or "000" on failure.
http_status() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$1" 2>/dev/null
}

# Same but with a Bearer token header.
http_status_auth() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 2 \
    -H "Authorization: Bearer $2" "$1" 2>/dev/null
}

# Read a JSON key from a file; requires jq or Python fallback.
json_get() {
  local file="$1" key="$2"
  if command -v jq &>/dev/null; then
    jq -r ".$key // empty" "$file" 2>/dev/null
  else
    python3 -c "import json,sys; d=json.load(open('$file')); print(d.get('$key',''))" 2>/dev/null
  fi
}

# ── check functions ───────────────────────────────────────────────────────────

check_electron() {
  if pgrep -f "openlegion" -x &>/dev/null || \
     pgrep -f "Electron.*openlegion" &>/dev/null || \
     pgrep -f "ai.openlegion" &>/dev/null; then
    echo -e "$OK ${BOLD}Electron renderer${RESET}  running"
    return 0
  else
    echo -e "$FAIL ${BOLD}Electron renderer${RESET}  not found"
    return 1
  fi
}

check_sidecar() {
  local url
  url=$(discover_sidecar_url)
  if [[ -z "$url" ]]; then
    echo -e "$WARN ${BOLD}Sidecar daemon${RESET}     no URL in logs (app not started yet?)"
    return 1
  fi

  local status
  status=$(http_status "$url/global/health")
  if [[ "$status" == "200" ]]; then
    echo -e "$OK ${BOLD}Sidecar daemon${RESET}     $url  ${DIM}HTTP $status${RESET}"
  elif [[ "$status" == "401" ]]; then
    # 401 means the server IS alive but we have no password — still counts as up
    echo -e "$OK ${BOLD}Sidecar daemon${RESET}     $url  ${DIM}HTTP $status (auth required — alive)${RESET}"
  elif [[ "$status" == "000" ]]; then
    echo -e "$FAIL ${BOLD}Sidecar daemon${RESET}     $url  ${DIM}unreachable${RESET}"
    return 1
  else
    echo -e "$WARN ${BOLD}Sidecar daemon${RESET}     $url  ${DIM}HTTP $status${RESET}"
    return 1
  fi
}

check_microvm() {
  local url="${OPENLEGION_MICROVM_URL:-http://127.0.0.1:7420}"
  local status
  status=$(http_status "$url/health")
  if [[ "$status" == "200" ]]; then
    echo -e "$OK ${BOLD}MicroVM daemon${RESET}     $url  ${DIM}HTTP $status${RESET}"
  elif [[ "$status" == "000" ]]; then
    echo -e "$WARN ${BOLD}MicroVM daemon${RESET}     $url  ${DIM}not running${RESET}"
  else
    echo -e "$WARN ${BOLD}MicroVM daemon${RESET}     $url  ${DIM}HTTP $status${RESET}"
  fi
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    echo -e "$WARN ${BOLD}Docker${RESET}             not installed"
    return
  fi
  if docker info &>/dev/null 2>&1; then
    local version
    version=$(docker version --format '{{.Server.Version}}' 2>/dev/null)
    echo -e "$OK ${BOLD}Docker${RESET}             running${version:+  ${DIM}v$version${RESET}}"
  else
    echo -e "$FAIL ${BOLD}Docker${RESET}             daemon not responding"
  fi
}

check_kubernetes() {
  if ! command -v kubectl &>/dev/null; then
    echo -e "$WARN ${BOLD}Kubernetes${RESET}         kubectl not installed"
    return
  fi
  local ctx
  ctx=$(kubectl config current-context 2>/dev/null)
  if kubectl get nodes --request-timeout=2s &>/dev/null 2>&1; then
    echo -e "$OK ${BOLD}Kubernetes${RESET}         cluster reachable  ${DIM}ctx: ${ctx:-unknown}${RESET}"
  else
    echo -e "$FAIL ${BOLD}Kubernetes${RESET}         cluster unreachable  ${DIM}ctx: ${ctx:-none}${RESET}"
  fi
}

check_sandbox_host() {
  if [[ ! -f "$SANDBOX_HOST_FILE" ]]; then
    echo -e "$DIM  ${BOLD}Sandbox host${RESET}       not configured${RESET}"
    return
  fi

  local url token
  url=$(json_get "$SANDBOX_HOST_FILE" "url")
  token=$(json_get "$SANDBOX_HOST_FILE" "token")

  if [[ -z "$url" ]]; then
    echo -e "$DIM  ${BOLD}Sandbox host${RESET}       not configured${RESET}"
    return
  fi

  local status
  if [[ -n "$token" ]]; then
    status=$(http_status_auth "$url" "$token")
  else
    status=$(http_status "$url")
  fi

  if [[ "$status" == "200" || "$status" == "401" ]]; then
    echo -e "$OK ${BOLD}Sandbox host${RESET}       $url  ${DIM}HTTP $status${RESET}"
  elif [[ "$status" == "000" ]]; then
    echo -e "$FAIL ${BOLD}Sandbox host${RESET}       $url  ${DIM}unreachable${RESET}"
  else
    echo -e "$WARN ${BOLD}Sandbox host${RESET}       $url  ${DIM}HTTP $status${RESET}"
  fi
}

log_tail() {
  local latest_run
  latest_run=$(ls -1t "$USERDATA_DIR/logs/" 2>/dev/null | head -1)
  [[ -z "$latest_run" ]] && return

  local log_file="$USERDATA_DIR/logs/$latest_run/renderer.log"
  [[ ! -f "$log_file" ]] && return

  local errors
  errors=$(grep -i "error\|uncaught\|unhandled" "$log_file" 2>/dev/null | tail -3)
  if [[ -n "$errors" ]]; then
    echo ""
    echo -e "${DIM}── renderer log  ($latest_run) ──────────────────────────────────${RESET}"
    echo "$errors" | while IFS= read -r line; do
      echo -e "  ${RED}${line}${RESET}"
    done
  fi
}

# ── main loop ─────────────────────────────────────────────────────────────────

while true; do
  clear
  echo -e "${BOLD}${CYAN}  OpenLegion Heartbeat${RESET}  ${DIM}$(date '+%Y-%m-%d %H:%M:%S')  ·  refresh every ${INTERVAL}s${RESET}"
  echo -e "${DIM}  ─────────────────────────────────────────────────────────${RESET}"
  echo ""

  check_electron
  check_sidecar
  check_microvm
  check_docker
  check_kubernetes
  check_sandbox_host

  log_tail

  echo ""
  echo -e "${DIM}  Press Ctrl+C to exit${RESET}"

  sleep "$INTERVAL"
done
