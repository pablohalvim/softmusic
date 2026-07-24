#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Deploy da IA (python-ai + worker + scheduler). Imagem buildada
# localmente pelo Jenkins (sem registry). As MIGRATIONS do banco são aplicadas
# no entrypoint do container python-ai (alembic upgrade head).
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

require_env_file
stage_assets
cd "${DEPLOY_DIR}"

COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
# shellcheck disable=SC1090
set -a && source "${ENV_FILE}" && set +a

USE_GPU="${USE_GPU:-0}"
nvidia_host_ok() {
  # Jenkins costuma rodar em container; testa o driver via daemon do host.
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x /usr/bin/nvidia-smi ]] && /usr/bin/nvidia-smi -L >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

if [[ "${USE_GPU}" == "1" ]]; then
  if nvidia_host_ok; then
    COMPOSE_FILES+=(-f docker-compose.gpu.yml)
    echo ">> GPU: overlay runtime nvidia (USE_GPU=1)"
  else
    echo ">> AVISO: USE_GPU=1 mas driver NVIDIA indisponível no host (nvidia-smi falhou)."
    echo "         Continuando em CPU. Para forçar GPU: instale o driver + NVIDIA Container Toolkit."
    USE_GPU=0
  fi
else
  echo ">> Compute: CPU (USE_GPU=0)"
fi

compose_up() {
  docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
    --profile infra --profile app up -d --no-deps --force-recreate python-ai worker scheduler
}

if ! compose_up; then
  if [[ "${USE_GPU}" == "1" ]]; then
    echo ">> AVISO: start com runtime nvidia falhou — retry em CPU..."
    COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
    USE_GPU=0
    compose_up
  else
    exit 1
  fi
fi

docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps python-ai worker scheduler

wait_http "http://127.0.0.1:${PYTHON_AI_PORT:-8000}/health"
