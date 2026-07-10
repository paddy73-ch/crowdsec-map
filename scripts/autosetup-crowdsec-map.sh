#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER=""
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
    --container) CONTAINER="${2:?missing container name}"; shift 2 ;;
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
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Required command '$1' was not found."; }

for command in docker awk sed mktemp grep; do need "$command"; done

detect_container() {
  local name answer candidate_count=0
  local -a candidates=()
  while IFS= read -r name; do
    if docker exec "$name" cscli version >/dev/null 2>&1; then
      candidates+=("$name")
      candidate_count=$((candidate_count + 1))
    fi
  done < <(docker ps --format '{{.Names}}')

  if ((candidate_count == 1)); then
    CONTAINER="${candidates[0]}"
  elif ((candidate_count > 1)); then
    if [[ -t 0 ]]; then
      printf 'Multiple containers with cscli were found:\n'
      select name in "${candidates[@]}"; do [[ -n "$name" ]] && { CONTAINER="$name"; break; }; done
    else
      fail "Multiple CrowdSec candidates found: ${candidates[*]}. Use --container NAME."
    fi
  elif [[ -t 0 ]]; then
    read -rp "CrowdSec container name: " CONTAINER
  else
    fail "No running container with cscli was found. Use --container NAME."
  fi

  if [[ -t 0 ]]; then
    read -rp "Use detected CrowdSec container '$CONTAINER'? [Y/n] " answer
    if [[ "$answer" =~ ^[Nn]$ ]]; then read -rp "CrowdSec container name: " CONTAINER; fi
  fi
}

detect_lapi_url() {
  local listen port answer
  listen="$(docker exec "$CONTAINER" cscli config show-yaml 2>/dev/null | awk '
    /^api:/ { in_api=1; next }
    in_api && /^[^[:space:]]/ { in_api=0 }
    in_api && /^[[:space:]]+server:/ { in_server=1; next }
    in_server && /^[[:space:]]{2}[^[:space:]]/ { in_server=0 }
    in_server && /^[[:space:]]+listen_uri:/ { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print; exit }
  ')"
  port="${listen##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || port=8080
  LAPI_URL="http://${CONTAINER}:${port}"
  if [[ -t 0 ]]; then
    read -rp "Use detected internal LAPI URL '$LAPI_URL'? [Y/n] " answer
    if [[ "$answer" =~ ^[Nn]$ ]]; then read -rp "LAPI URL: " LAPI_URL; fi
  fi
}

if [[ -z "$CONTAINER" ]]; then detect_container; fi
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "CrowdSec container '$CONTAINER' was not found."
docker exec "$CONTAINER" cscli version >/dev/null 2>&1 || fail "cscli is unavailable in '$CONTAINER'."
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
  docker exec "$CONTAINER" cscli "$1" list -o json 2>/dev/null | grep -Fq "\"crowdsec-map\""
}

configure_machine() {
  local credentials login password
  if [[ -n "$(env_value LAPI_LOGIN)" && -n "$(env_value LAPI_PASSWORD)" && "$ROTATE" != true ]]; then
    printf 'Keeping existing LAPI alert credentials.\n'
    return
  fi
  if registered machines; then
    [[ "$ROTATE" == true ]] || fail "Machine crowdsec-map exists but its password is unavailable. Restore .env or use --rotate."
    docker exec "$CONTAINER" cscli machines delete crowdsec-map >/dev/null
  fi
  credentials="$(docker exec "$CONTAINER" cscli machines add crowdsec-map --auto --file -)"
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
    docker exec "$CONTAINER" cscli bouncers delete crowdsec-map --ignore-missing >/dev/null
  fi
  if command -v openssl >/dev/null 2>&1; then
    key="$(openssl rand -hex 32)"
  else
    key="$(docker exec "$CONTAINER" sh -c 'od -An -N32 -tx1 /dev/urandom | tr -d " \n"')"
  fi
  docker exec "$CONTAINER" cscli bouncers add crowdsec-map --key "$key" >/dev/null
  set_env LAPI_API_KEY "$key"
  printf 'Created the crowdsec-map Decisions bouncer.\n'
}

read_acquisition_paths() {
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
  ' | awk '{gsub(/\047/, "")} NF && !seen[$0]++'
}

detect_logs() {
  local paths mounts path type source destination best_source best_dest best_length relative
  local index=0 env_paths="" volumes=""
  paths="$(read_acquisition_paths)"
  [[ -n "$paths" ]] || { printf 'No file acquisitions found.\n'; return; }
  mounts="$(docker inspect --format '{{range .Mounts}}{{printf "%s\t%s\t%s\n" .Type .Source .Destination}}{{end}}' "$CONTAINER")"
  while IFS= read -r path; do
    best_source=""; best_dest=""; best_length=0
    while IFS=$'\t' read -r type source destination; do
      [[ "$type" == "bind" ]] || continue
      if [[ "$path" == "$destination" || "$path" == "$destination"/* ]] && ((${#destination} > best_length)); then
        best_source="$source"; best_dest="$destination"; best_length=${#destination}
      fi
    done <<< "$mounts"
    if [[ -z "$best_source" ]]; then
      printf 'Skipped %s (not backed by a Docker bind mount)\n' "$path"
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
    environment:
      INVESTIGATION_LOG_PATHS: "${env_paths}"
    volumes:
${volumes%$'\n'}
EOF
  printf 'Wrote %s; review the read-only mounts before starting.\n' "$OVERRIDE_FILE"
}

check_setup() {
  local errors=0 value
  printf '%-28s %s\n' "CrowdSec container" "$CONTAINER"
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
say "Configuration summary"
check_setup || true
if [[ -f "$OVERRIDE_FILE" ]]; then
  printf '\nNext: docker compose -f docker-compose.yml -f %s config\n' "$OVERRIDE_FILE"
  printf '      docker compose -f docker-compose.yml -f %s up -d --build\n' "$OVERRIDE_FILE"
else
  printf '\nNext: docker compose up -d --build\n'
fi
