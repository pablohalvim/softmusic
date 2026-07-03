#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/infra/docker"
ENV_FILE="${ENV_FILE:-/opt/softmusic/.env.production}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERRO: ${ENV_FILE} não encontrado."
  exit 1
fi

cd "${COMPOSE_DIR}"

COMPOSE_FILES=(
  -f docker-compose.yml
  -f docker-compose.prod.yml
)

if [[ -n "${SOFTMUSIC_API_IMAGE:-}" ]]; then
  docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app pull api || true
fi

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app up -d --no-deps api

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps api

curl -sf "http://127.0.0.1:${API_PORT:-8080}/health/live" && echo " API OK"
