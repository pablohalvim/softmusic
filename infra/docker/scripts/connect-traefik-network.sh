#!/usr/bin/env bash
# Conecta containers SoftMusic à rede Docker do Traefik (EasyPanel).
# Idempotente — ignora se já estiver conectado.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

load_compose_env

NET="${TRAEFIK_DOCKER_NETWORK:-easypanel}"
CONTAINERS=(
  softmusic-lp
  softmusic-web
  softmusic-admin-web
  softmusic-api
  softmusic-grafana
)

if ! docker network inspect "${NET}" >/dev/null 2>&1; then
  echo "ERRO: rede Docker '${NET}' não existe." >&2
  echo "Descubra o nome com:" >&2
  echo "  docker inspect \$(docker ps -q -f name=easypanel-traefik) --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}'" >&2
  exit 1
fi

for name in "${CONTAINERS[@]}"; do
  if ! docker inspect "${name}" >/dev/null 2>&1; then
    echo ">> SKIP: ${name} não existe"
    continue
  fi
  if docker inspect "${name}" --format "{{range \$k,\$v := .NetworkSettings.Networks}}{{if eq \$k \"${NET}\"}}yes{{end}}{{end}}" | grep -q yes; then
    echo ">> OK: ${name} já está em ${NET}"
  else
    docker network connect "${NET}" "${name}"
    echo ">> Conectado: ${name} → ${NET}"
  fi
done
