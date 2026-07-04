#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Deploy do painel administrativo (admin-web). Imagem buildada
# localmente pelo Jenkins (sem registry). Isolado: sobe SOMENTE o admin-web
# (não recria web/lp) e recarrega o nginx para publicar admin.softmusic.com.br.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

require_env_file
stage_assets
cd "${DEPLOY_DIR}"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
  --profile infra --profile app up -d --no-deps --force-recreate admin-web

# NGINX roteia admin.softmusic.com.br -> admin-web.
deploy_nginx

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps admin-web

wait_http "http://127.0.0.1:80/" || wait_http "http://127.0.0.1:${ADMIN_PORT:-5174}/"
