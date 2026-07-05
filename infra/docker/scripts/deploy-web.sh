#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Deploy do front (web + landing page) e do NGINX. Imagens
# buildadas localmente pelo Jenkins (sem registry).
#
# Toggles:
#   DEPLOY_LP=1         (default) também sobe a landing page
#   DEPLOY_ADMIN_WEB=0  (default) NÃO sobe o admin-web aqui — ele tem job próprio
#                       (Jenkinsfile.admin -> deploy-admin.sh). Deixe em 1 apenas
#                       se quiser subir tudo pelo mesmo job.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

require_env_file
stage_assets
cd "${DEPLOY_DIR}"

mapfile -t COMPOSE_FILES < <(compose_files)

SERVICES=(web)
if [[ "${DEPLOY_LP:-1}" == "1" ]]; then
  SERVICES+=(lp)
fi
if [[ "${DEPLOY_ADMIN_WEB:-0}" == "1" ]]; then
  SERVICES+=(admin-web)
fi

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
  --profile infra --profile app up -d --no-deps --force-recreate "${SERVICES[@]}"

deploy_edge_proxy

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps web

load_compose_env
if [[ "${EDGE_PROXY}" == "easypanel" ]]; then
  wait_http "https://app.softmusic.com.br/" || true
else
  wait_http "http://127.0.0.1:80/" || wait_http "http://127.0.0.1:${WEB_PORT:-5173}/"
fi
