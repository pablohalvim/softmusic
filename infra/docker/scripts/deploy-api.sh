#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Deploy da API (BFF). Imagem buildada localmente pelo Jenkins
# (sem registry); aqui só sobe/atualiza o serviço `api` no daemon do host.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

require_env_file
stage_assets
cd "${DEPLOY_DIR}"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
  --profile infra --profile app up -d --no-deps --force-recreate api

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps api

wait_http "http://127.0.0.1:${API_PORT:-8080}/health/live"
