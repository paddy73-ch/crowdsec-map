#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER=""
MODE=""
ENV_FILE=".env"
OVERRIDE_FILE="docker-compose.autosetup.yml"
LAPI_URL=""
DETECT_LOGS=true
CHECK_ONLY=false
ROTATE=false
CTI_KEY=""

usage() {
  cat <<'EOF'
Usage: scripts/autosetup-crowdsec-map.sh [options]

  --container NAME       Override automatic CrowdSec container detection
  --native               Use a native host installation of CrowdSec
  --lapi-url URL         Override the automatically detected internal LAPI URL
  --env-file PATH        Environment file (default: .env)
  --override-file PATH   Compose override for detected logs
  --detect-logs          Detect file acquisitions (default)
  --no-detect-logs       Do not generate Investigation log mounts
  --cti-key KEY          Store an existing CrowdSec CTI API key
  --cti-key-stdin        Prompt for a CTI key without exposing it in arguments
  --rotate               Replace existing crowdsec-map credentials
  --check                Diagnose without creating credentials
  -h, --help             Show help

Existing credentials are never replaced unless --rotate is supplied.
EOF
}

while (($#)); do
  case "$1" in
    --container) CONTAINER="${2:?missing container name}"; MODE="docker"; shift 2 ;;
    --native) MODE="native"; shift ;;
    --lapi-url) LAPI_URL="${2:?missing LAPI URL}"; shift 2 ;;
    --env-file) ENV_FILE="${2:?missing env path}"; shift 2 ;;
    --override-file) OVERRIDE_FILE="${2:?missing override path}"; shift 2 ;;
    --detect-logs) DETECT_LOGS=true; shift ;;
    --no-detect-logs) DETECT_LOGS=false; shift ;;
    --cti-key) CTI_KEY="${2:?missing CTI key}"; shift 2 ;;
    --cti-key-stdin) IFS= read -rsp "CTI API key: " CTI_KEY; printf '\n'; shift ;;
    --rotate) ROTATE=true; shift ;;
    --check) CHECK_ONLY=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' was not found."; }

for command in docker awk sed mktemp grep; do need "$command"; done

detect_installation() {
  local name answer candidate_count=0 native_available=false
  local -a candidates=()
  while IFS= read -r name; do
    if docker exec "$name" cscli version >/dev/null 2>&1; then
      candidates+=("$name")
      candidate_count=$((candidate_count + 1))
    fi
  done < <(docker ps --format '{{.Names}}')

  command -v cscli >/dev/null 2>&1 && cscli version >/dev/null 2>&1 && native_available=true

  if ((candidate_count == 1)) && [[ "$native_available" == false ]]; then
    MODE="docker"
    CONTAINER="${candidates[0]}"
  elif ((candidate_count == 0)) && [[ "$native_available" == true ]]; then
    MODE="native"
  elif ((candidate_count > 0)) && [[ "$native_available" == true && -t 0 ]]; then
    printf 'Both native CrowdSec and Docker candidates were found:\n'
    select name in "native cscli" "${candidates[@]}"; do
      [[ -n "$name" ]] || continue
      if [[ "$name" == "native cscli" ]]; then MODE="native"; else MODE="docker"; CONTAINER="$name"; fi
      break
    done
  elif ((candidate_count > 1)); then
    if [[ -t 0 ]]; then
      printf 'Multiple containers with cscli were found:\n'
      select name in "${candidates[@]}"; do [[ -n "$name" ]] && { MODE="docker"; CONTAINER="$name"; break; }; done
    else
      fail "Multiple CrowdSec candidates found: ${candidates[*]}. Use --container NAME."
    fi
  elif ((candidate_count == 1)); then
    MODE="docker"
    CONTAINER="${candidates[0]}"
  elif [[ -t 0 ]]; then
    read -rp "Installation type [docker/native]: " MODE
    if [[ "$MODE" == "docker" ]]; then read -rp "CrowdSec container name: " CONTAINER; fi
  else
    fail "No CrowdSec installation was detected. Use --container NAME or --native."
  fi

  if [[ "$MODE" == "docker" && -t 0 ]]; then
    read -rp "Use detected CrowdSec container '$CONTAINER'? [Y/n] " answer
    if [[ "$answer" =~ ^[Nn]$ ]]; then read -rp "CrowdSec container name: " CONTAINER; fi
  fi
}

cscli_run() {
  if [[ "$MODE" == "docker" ]]; then docker exec "$CONTAINER" cscli "$@"; else cscli "$@"; fi
}

detect_lapi_url() {
  local listen port answer
  listen="$(cscli_run config show-yaml 2>/dev/null | awk '
    /^api:/ { in_api=1; next }
    in_api && /^[^[:space:]]/ { in_api=0 }
    in_api && /^[[:space:]]+server:/ { in_server=1; next }
    in_server && /^[[:space:]]{2}[^[:space:]]/ { in_server=0 }
    in_server && /^[[:space:]]+listen_uri:/ { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print; exit }
  ')"
  port="${listen##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || port=8080
  if [[ "$MODE" == "docker" ]]; then
    LAPI_URL="http://${CONTAINER}:${port}"
  else
    LAPI_URL="http://host.docker.internal:${port}"
    if [[ "$listen" == 127.0.0.1:* || "$listen" == localhost:* || "$listen" == \[::1\]:* ]]; then
      warn "Native LAPI listens on '$listen'. CrowdSec Map cannot reach this loopback address from Docker; change listen_uri to a host-accessible address before starting the Map."
    fi
  fi
  if [[ -t 0 ]]; then
    read -rp "Use detected internal LAPI URL '$LAPI_URL'? [Y/n] " answer
    if [[ "$answer" =~ ^[Nn]$ ]]; then read -rp "LAPI URL: " LAPI_URL; fi
  fi
}

if [[ -z "$MODE" ]]; then detect_installation; fi
if [[ "$MODE" == "docker" ]]; then
  docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "CrowdSec container '$CONTAINER' was not found."
  docker exec "$CONTAINER" cscli version >/dev/null 2>&1 || fail "cscli is unavailable in '$CONTAINER'."
elif [[ "$MODE" == "native" ]]; then
  command -v cscli >/dev/null 2>&1 || fail "Native cscli was not found in PATH. Run this script with sudo or use --container NAME."
  cscli version >/dev/null 2>&1 || fail "Native cscli is not usable."
else
  fail "Installation mode must be docker or native."
fi
if [[ -z "$LAPI_URL" ]]; then detect_lapi_url; fi
env_value() {
  [[ -f "$ENV_FILE" ]] || return 0
  awk -F= -v key="$1" '$1 == key {sub(/^[^=]*=/, ""); value=$0} END {print value}' "$ENV_FILE"
}

set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -F= -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    $1 == key { print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

registered() {
  cscli_run "$1" list -o json 2>/dev/null | grep -Fq "\"crowdsec-map\""
}

configure_machine() {
  local credentials login password
  if [[ -n "$(env_value LAPI_LOGIN)" && -n "$(env_value LAPI_PASSWORD)" && "$ROTATE" != true ]]; then
    printf 'Keeping existing LAPI alert credentials.\n'
    return
  fi
  if registered machines; then
    [[ "$ROTATE" == true ]] || fail "Machine crowdsec-map exists but its password is unavailable. Restore .env or use --rotate."
    cscli_run machines delete crowdsec-map >/dev/null
  fi
  credentials="$(cscli_run machines add crowdsec-map --auto --file -)"
  login="$(printf '%s\n' "$credentials" | awk -F: '$1 ~ /^[[:space:]]*login$/ {sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')"
  password="$(printf '%s\n' "$credentials" | awk -F: '$1 ~ /^[[:space:]]*password$/ {sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')"
  [[ -n "$login" && -n "$password" ]] || fail "Created machine credentials could not be parsed."
  set_env LAPI_LOGIN "$login"
  set_env LAPI_PASSWORD "$password"
  printf 'Created the crowdsec-map Alerts machine.\n'
}

configure_bouncer() {
  local key
  if [[ -n "$(env_value LAPI_API_KEY)" && "$ROTATE" != true ]]; then
    printf 'Keeping existing LAPI decisions key.\n'
    return
  fi
  if registered bouncers; then
    [[ "$ROTATE" == true ]] || fail "Bouncer crowdsec-map exists but its one-time key is unavailable. Restore .env or use --rotate."
    cscli_run bouncers delete crowdsec-map --ignore-missing >/dev/null
  fi
  if command -v openssl >/dev/null 2>&1; then
    key="$(openssl rand -hex 32)"
  else
    key="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  fi
  cscli_run bouncers add crowdsec-map --key "$key" >/dev/null
  set_env LAPI_API_KEY "$key"
  printf 'Created the crowdsec-map Decisions bouncer.\n'
}

read_acquisition_paths() {
  if [[ "$MODE" == "docker" ]]; then
    docker exec "$CONTAINER" sh -c '
      for file in /etc/crowdsec/acquis.yaml /etc/crowdsec/acquis.d/*.yaml; do
        [ -f "$file" ] || continue
        awk '\''
          /^[[:space:]]*(filename|filenames):[[:space:]]*[^#[:space:]]/ {
            line=$0; sub(/^[^:]*:[[:space:]]*/, "", line); sub(/[[:space:]]+#.*/, "", line); gsub(/"/, "", line); print line; in_files=0; next
          }
          /^[[:space:]]*filenames:[[:space:]]*$/ { in_files=1; next }
          in_files && /^[[:space:]]*-[[:space:]]*/ {
            line=$0; sub(/^[[:space:]]*-[[:space:]]*/, "", line); sub(/[[:space:]]+#.*/, "", line); gsub(/"/, "", line); print line; next
          }
          in_files && /^[^[:space:]-]/ { in_files=0 }
        '\'' "$file"
      done
    '
  else
    local config acquisition_path acquisition_dir file
    config="$(cscli_run config show-yaml 2>/dev/null)"
    acquisition_path="$(printf '%s\n' "$config" | awk '/^[[:space:]]+acquisition_path:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print; exit}')"
    acquisition_dir="$(printf '%s\n' "$config" | awk '/^[[:space:]]+acquisition_dir:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print; exit}')"
    acquisition_path="${acquisition_path:-/etc/crowdsec/acquis.yaml}"
    acquisition_dir="${acquisition_dir:-/etc/crowdsec/acquis.d}"
    for file in "$acquisition_path" "$acquisition_dir"/*.yaml; do
      [[ -f "$file" ]] || continue
      awk '
        /^[[:space:]]*(filename|filenames):[[:space:]]*[^#[:space:]]/ {
          line=$0; sub(/^[^:]*:[[:space:]]*/, "", line); sub(/[[:space:]]+#.*/, "", line); gsub(/"/, "", line); print line; in_files=0; next
        }
        /^[[:space:]]*filenames:[[:space:]]*$/ { in_files=1; next }
        in_files && /^[[:space:]]*-[[:space:]]*/ {
          line=$0; sub(/^[[:space:]]*-[[:space:]]*/, "", line); sub(/[[:space:]]+#.*/, "", line); gsub(/"/, "", line); print line; next
        }
        in_files && /^[^[:space:]-]/ { in_files=0 }
      ' "$file"
    done
  fi | awk '{gsub(/\047/, "")} NF && !seen[$0]++'
}

detect_logs() {
  local paths mounts path type source destination best_source best_dest best_length relative root prefix extra_hosts=""
  local index=0 env_paths="" volumes=""
  paths="$(read_acquisition_paths)"
  [[ -n "$paths" ]] || { printf 'No file acquisitions found.\n'; return; }
  if [[ "$MODE" == "docker" ]]; then
    mounts="$(docker inspect --format '{{range .Mounts}}{{printf "%s\t%s\t%s\n" .Type .Source .Destination}}{{end}}' "$CONTAINER")"
  else
    mounts=""
    extra_hosts=$'    extra_hosts:\n      - "host.docker.internal:host-gateway"\n'
  fi
  while IFS= read -r path; do
    best_source=""; best_dest=""; best_length=0
    if [[ "$MODE" == "docker" ]]; then
      while IFS=$'\t' read -r type source destination; do
        [[ "$type" == "bind" ]] || continue
        if [[ "$path" == "$destination" || "$path" == "$destination"/* ]] && ((${#destination} > best_length)); then
          best_source="$source"; best_dest="$destination"; best_length=${#destination}
        fi
      done <<< "$mounts"
    else
      prefix="$(printf '%s' "$path" | sed 's/[*?\[].*$//')"
      if [[ "$prefix" != "$path" ]]; then
        root="${prefix%/}"
        [[ -d "$root" ]] || root="$(dirname "$root")"
      else
        root="$path"
      fi
      if [[ -e "$root" ]]; then best_source="$root"; best_dest="$root"; fi
    fi
    if [[ -z "$best_source" ]]; then
      printf 'Skipped %s (source path is not accessible to CrowdSec Map)\n' "$path"
      continue
    fi
    relative="${path#"$best_dest"}"
    index=$((index + 1))
    env_paths+="${env_paths:+,}/investigation/source-${index}${relative}"
    volumes+="      - ${best_source}:/investigation/source-${index}:ro"$'\n'
    printf 'Detected %s -> %s%s\n' "$path" "$best_source" "$relative"
  done <<< "$paths"
  [[ -n "$env_paths" ]] || { printf 'No acquisition file could be mapped automatically.\n'; return; }
  cat > "$OVERRIDE_FILE" <<EOF
# Generated by scripts/autosetup-crowdsec-map.sh
services:
  crowdsec-map:
${extra_hosts}    environment:
      INVESTIGATION_LOG_PATHS: "${env_paths}"
    volumes:
${volumes%$'\n'}
EOF
  printf 'Wrote %s; review the read-only mounts before starting.\n' "$OVERRIDE_FILE"
}

check_setup() {
  local errors=0 value
  printf '%-28s %s\n' "Installation type" "$MODE"
  printf '%-28s %s\n' "CrowdSec container" "${CONTAINER:-native}"
  printf '%-28s %s\n' "Detected LAPI URL" "$LAPI_URL"
  for key in LAPI_URL LAPI_LOGIN LAPI_PASSWORD LAPI_API_KEY CTI_API_KEY; do
    value="$(env_value "$key")"
    printf '%-28s %s\n' "$key" "$([[ -n "$value" ]] && echo configured || echo missing)"
    [[ -n "$value" || "$key" == CTI_API_KEY ]] || errors=$((errors + 1))
  done
  for kind in machines bouncers; do
    registered "$kind" && value=present || { value=missing; errors=$((errors + 1)); }
    printf '%-28s %s\n' "$kind registration" "$value"
  done
  [[ -f "$OVERRIDE_FILE" ]] && value="$OVERRIDE_FILE" || value="not generated"
  printf '%-28s %s\n' "Investigation override" "$value"
  return "$errors"
}

say "CrowdSec Map setup"
if [[ "$CHECK_ONLY" == true ]]; then check_setup; exit $?; fi
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env LAPI_URL "$LAPI_URL"
configure_machine
configure_bouncer
if [[ -n "$CTI_KEY" ]]; then set_env CTI_API_KEY "$CTI_KEY"; printf 'Stored CTI_API_KEY.\n'; fi
if [[ "$DETECT_LOGS" == true ]]; then say "Detecting file acquisitions"; detect_logs; fi
if [[ "$MODE" == "native" && ! -f "$OVERRIDE_FILE" ]]; then
  cat > "$OVERRIDE_FILE" <<'EOF'
# Generated by scripts/autosetup-crowdsec-map.sh
services:
  crowdsec-map:
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF
  printf 'Wrote %s with native-host connectivity.\n' "$OVERRIDE_FILE"
fi
say "Configuration summary"
check_setup || true
if [[ -f "$OVERRIDE_FILE" ]]; then
  printf '\nNext: docker compose -f docker-compose.yml -f %s config\n' "$OVERRIDE_FILE"
  printf '      docker compose -f docker-compose.yml -f %s up -d --build\n' "$OVERRIDE_FILE"
else
  printf '\nNext: docker compose up -d --build\n'
fi
