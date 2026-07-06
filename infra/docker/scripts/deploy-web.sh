#!/usr/bin/env bash
set -euo pipefail

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

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps web lp

load_host_ports
wait_http "http://127.0.0.1:${WEB_PORT}/"
wait_http "http://127.0.0.1:${LP_PORT}/"
