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

# Jenkins roda em container: nvidia-smi local costuma falhar mesmo com GPU no host.
# O teste correto é via daemon Docker do host (mesmo socket que o compose usa).
nvidia_docker_ok() {
  local probe_img="${NVIDIA_PROBE_IMAGE:-nvidia/cuda:12.4.0-base-ubuntu22.04}"
  docker run --rm --runtime=nvidia \
    -e NVIDIA_VISIBLE_DEVICES=all \
    "${probe_img}" \
    nvidia-smi -L >/dev/null 2>&1
}

print_nvidia_fix_hint() {
  cat <<'EOF'
>> GPU pedida (USE_GPU=1), mas o Docker no host não consegue usar NVIDIA.
   Erro típico: "failed to initialize NVML: Driver Not Loaded"

   Rode NO HOST da VPS:
     nvidia-smi
     docker run --rm --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all \
       nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi

   Workaround: re-rode softmusic-ia com IA_COMPUTE=cpu.
EOF
}

dump_ia_logs() {
  echo ">> ---- logs softmusic-python-ai (tail 120) ----"
  docker logs --tail 120 softmusic-python-ai 2>&1 || true
  echo ">> ---- docker inspect health ----"
  docker inspect -f '{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' softmusic-python-ai 2>&1 || true
}

if [[ "${USE_GPU}" == "1" ]]; then
  echo ">> GPU: verificando runtime nvidia no daemon do host..."
  if nvidia_docker_ok; then
    COMPOSE_FILES+=(-f docker-compose.gpu.yml)
    echo ">> GPU: overlay runtime nvidia (USE_GPU=1)"
  else
    print_nvidia_fix_hint
    exit 1
  fi
else
  echo ">> Compute: CPU (USE_GPU=0)"
  # Evita o runtime nvidia e esconde CUDA para o PyTorch.
  export CUDA_VISIBLE_DEVICES=""
  export NVIDIA_VISIBLE_DEVICES=""
fi

if ! docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
  --profile infra --profile app up -d --no-deps --force-recreate python-ai worker scheduler; then
  dump_ia_logs
  exit 1
fi

docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps python-ai worker scheduler

# Em prod o python-ai não publica porta no host — valida health via inspect.
if ! wait_container_healthy softmusic-python-ai 60; then
  dump_ia_logs
  exit 1
fi

echo ">> Deploy IA OK (compute=$([[ "${USE_GPU}" == "1" ]] && echo gpu || echo cpu))"
