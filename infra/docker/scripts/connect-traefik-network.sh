#!/usr/bin/env bash
# Conecta containers SoftMusic à rede Docker do Traefik (EasyPanel).
# Idempotente — ignora se já estiver conectado. Retries para evitar race após recreate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

load_compose_env

resolve_traefik_network() {
  local net="${TRAEFIK_DOCKER_NETWORK:-easypanel}"
  if docker network inspect "${net}" >/dev/null 2>&1; then
    echo "${net}"
    return 0
  fi
  local traefik_id traefik_net
  traefik_id="$(docker ps -q -f name=easypanel-traefik | head -1 || true)"
  if [[ -n "${traefik_id}" ]]; then
    traefik_net="$(docker inspect "${traefik_id}" \
      --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' \
      | grep -v '^ingress$' | head -1 || true)"
    if [[ -n "${traefik_net}" ]] && docker network inspect "${traefik_net}" >/dev/null 2>&1; then
      echo ">> Rede '${net}' não existe; usando '${traefik_net}' (Traefik)" >&2
      echo "${traefik_net}"
      return 0
    fi
  fi
  echo "ERRO: rede Docker '${net}' não existe." >&2
  echo "Descubra o nome com:" >&2
  echo "  docker inspect \$(docker ps -q -f name=easypanel-traefik) --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}'" >&2
  return 1
}

NET="$(resolve_traefik_network)"

CONTAINERS=(
  softmusic-lp
  softmusic-web
  softmusic-admin-web
  softmusic-api
  softmusic-grafana
)

container_on_network() {
  local name="$1"
  docker inspect "${name}" --format "{{range \$k,\$v := .NetworkSettings.Networks}}{{if eq \$k \"${NET}\"}}yes{{end}}{{end}}" \
    | grep -q yes
}

connect_with_retry() {
  local name="$1" attempt err
  for attempt in 1 2 3 4 5; do
    if container_on_network "${name}"; then
      echo ">> OK: ${name} já está em ${NET}"
      return 0
    fi
    if err="$(docker network connect "${NET}" "${name}" 2>&1)"; then
      echo ">> Conectado: ${name} → ${NET}"
      return 0
    fi
    if echo "${err}" | grep -qiE 'already exists|is already attached'; then
      echo ">> OK: ${name} já está em ${NET}"
      return 0
    fi
    echo ">> Tentativa ${attempt}/5: ${name} → ${NET} (${err})"
    sleep 2
  done
  echo ">> AVISO: não conectou ${name} à rede ${NET} após 5 tentativas" >&2
  return 1
}

fail=0
for name in "${CONTAINERS[@]}"; do
  if ! docker inspect "${name}" >/dev/null 2>&1; then
    echo ">> SKIP: ${name} não existe"
    continue
  fi
  status="$(docker inspect -f '{{.State.Status}}' "${name}" 2>/dev/null || true)"
  if [[ "${status}" != "running" ]]; then
    echo ">> SKIP: ${name} não está running (status=${status})"
    continue
  fi
  connect_with_retry "${name}" || fail=1
done

exit "${fail}"
