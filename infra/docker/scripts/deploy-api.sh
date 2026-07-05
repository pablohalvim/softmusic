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

mapfile -t COMPOSE_FILES < <(compose_files)

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
  --profile infra --profile app up -d --no-deps --force-recreate api

load_compose_env
if [[ "${EDGE_PROXY}" == "easypanel" ]]; then
  bash "${SCRIPT_DIR}/connect-traefik-network.sh"
fi

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps api

wait_container_healthy softmusic-api
