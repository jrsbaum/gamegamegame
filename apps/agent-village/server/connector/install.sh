#!/usr/bin/env bash
set -euo pipefail
pairing_code=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pairing-code) pairing_code="${2:-}"; shift 2 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$pairing_code" ]]; then echo "Use --pairing-code CODIGO" >&2; exit 2; fi
base='__PUBLIC_ORIGIN__'
temporary="$(mktemp -d "${TMPDIR:-/tmp}/vila-agentes-XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
curl --fail --silent --show-error "$base/connector/install.mjs" -o "$temporary/install.mjs"
curl --fail --silent --show-error "$base/connector/logic.mjs" -o "$temporary/logic.mjs"
node "$temporary/install.mjs" --origin "$base" --pairing-code "$pairing_code"
