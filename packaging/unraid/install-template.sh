#!/usr/bin/env bash
set -euo pipefail

branch="${1:-dev}"
case "$branch" in
  dev|main) ;;
  *) echo "Usage: $0 [dev|main]" >&2; exit 2 ;;
esac

template_dir="/boot/config/plugins/dockerMan/templates-user"
template_file="$template_dir/crowdsec-map.xml"
template_url="https://raw.githubusercontent.com/paddy73-ch/crowdsec-map/${branch}/packaging/unraid/crowdsec-map.xml"

mkdir -p "$template_dir"
temporary_file="$(mktemp "$template_dir/.crowdsec-map.xml.XXXXXX")"
trap 'rm -f "$temporary_file"' EXIT

curl --fail --location --retry 3 --silent --show-error "$template_url" --output "$temporary_file"
grep -q '<Container version="2">' "$temporary_file" || { echo "Downloaded file is not an Unraid template." >&2; exit 1; }

if [[ -f "$template_file" ]]; then
  cp "$template_file" "${template_file}.bak"
fi
mv "$temporary_file" "$template_file"
trap - EXIT

echo "Installed ${branch} template: ${template_file}"
[[ -f "${template_file}.bak" ]] && echo "Previous template backup: ${template_file}.bak"
