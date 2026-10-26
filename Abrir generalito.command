#!/bin/sh
# Doble clic para abrir generalito en el navegador (Mac y Linux).
cd "$(dirname "$0")" || exit 1
if ! command -v uv >/dev/null 2>&1; then
  echo "Falta instalar uv: https://docs.astral.sh/uv/getting-started/installation/"
  read -r _
  exit 1
fi
uv run generalito
