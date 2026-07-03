#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/infra/docker"
ENV_FILE="${ENV_FILE:-/opt/softmusic/.env.production}"
LEGACY="${LEGACY_MYSQL:-0}"
OBSERVABILITY="${WITH_OBSERVABILITY:-1}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERRO: ${ENV_FILE} não encontrado."
  exit 1
fi

COMPOSE_FILES=(-f "${COMPOSE_DIR}/docker-compose.infra.yml")
if [[ "${LEGACY}" == "1" ]]; then
  COMPOSE_FILES+=(-f "${COMPOSE_DIR}/docker-compose.infra-legacy.yml")
  echo ">> Modo LEGACY: MySQL 5.7"
else
  echo ">> Modo padrão: MySQL 8.4"
fi

PROFILES=(--profile infra)
if [[ "${OBSERVABILITY}" == "1" ]]; then
  PROFILES+=(--profile observability)
fi

cd "${COMPOSE_DIR}"

if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" pull
fi

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" up -d --remove-orphans

echo ">> Aguardando MySQL..."
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
    echo ">> MySQL OK"
    break
  fi
  sleep 2
done

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps
