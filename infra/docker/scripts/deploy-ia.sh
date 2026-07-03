#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/infra/docker"
ENV_FILE="${ENV_FILE:-/opt/softmusic/.env.production}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERRO: ${ENV_FILE} não encontrado."
  exit 1
fi

cd "${COMPOSE_DIR}"

COMPOSE_FILES=(
  -f docker-compose.yml
  -f docker-compose.prod.yml
)

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app pull python-ai worker || true
docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app up -d --no-deps python-ai worker

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps python-ai worker

curl -sf "http://127.0.0.1:${PYTHON_AI_PORT:-8000}/health" && echo " Python-AI OK"
