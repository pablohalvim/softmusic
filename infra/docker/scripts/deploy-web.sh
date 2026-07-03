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

SERVICES=(web)
if [[ "${DEPLOY_LP:-1}" == "1" ]]; then
  SERVICES+=(lp)
fi
if [[ "${DEPLOY_ADMIN_WEB:-1}" == "1" ]]; then
  SERVICES+=(admin-web)
fi

for svc in "${SERVICES[@]}"; do
  if docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" config --services 2>/dev/null | grep -qx "${svc}"; then
    docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app pull "${svc}" || true
    docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app up -d --no-deps "${svc}"
  else
    echo "AVISO: serviço ${svc} ainda não definido no compose — pulando."
  fi
done

# web sempre (serviço existente)
docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app up -d --no-deps web nginx 2>/dev/null || \
  docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" --profile infra --profile app up -d --no-deps web

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps web

curl -sf "http://127.0.0.1:${WEB_PORT:-5173}/" && echo " Web OK"
