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

# Padrão GPU: servidor com CUDA. Use USE_GPU=0 / IA_COMPUTE=cpu só se quiser forçar CPU.
USE_GPU="${USE_GPU:-1}"
ALLOW_CPU_FALLBACK="${ALLOW_CPU_FALLBACK:-0}"

# Jenkins roda em container: nvidia-smi local costuma falhar mesmo com GPU no host.
# O teste correto é via daemon Docker do host (mesmo socket que o compose usa).
# Usa só imagens JÁ locais — pull do Hub falha com IPv6/rede instável no VPS.
nvidia_docker_ok() {
  local probe_img err last_err=""
  local -a candidates=(
    "${NVIDIA_PROBE_IMAGE:-}"
    "${SOFTMUSIC_PYTHON_AI_IMAGE:-}"
    "softmusic/python-ai:latest"
    "pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime"
  )
  local -A seen=()

  for probe_img in "${candidates[@]}"; do
    [[ -z "${probe_img}" ]] && continue
    [[ -n "${seen[${probe_img}]+x}" ]] && continue
    seen["${probe_img}"]=1

    if ! docker image inspect "${probe_img}" >/dev/null 2>&1; then
      echo ">> nvidia probe: ${probe_img} não está local — pulando (sem pull)"
      continue
    fi

    if err="$(
      docker run --rm --runtime=nvidia \
        -e NVIDIA_VISIBLE_DEVICES="${NVIDIA_VISIBLE_DEVICES:-all}" \
        "${probe_img}" \
        nvidia-smi -L 2>&1
    )"; then
      echo ">> nvidia probe OK (${probe_img})"
      echo "${err}" | sed 's/^/   /'
      return 0
    fi
    last_err="${err}"
    echo ">> nvidia probe falhou com ${probe_img}:"
    echo "${err}" | sed 's/^/   /'
  done

  echo ">> nvidia probe falhou: nenhuma imagem CUDA local respondeu com runtime nvidia"
  if [[ -n "${last_err}" ]]; then
    echo "${last_err}" | sed 's/^/   /'
  fi
  echo "   Dica: o job softmusic-ia já builda softmusic/python-ai:latest — use essa imagem no probe."
  return 1
}

dump_ia_logs() {
  echo ">> ---- worker runtime / GPU env ----"
  docker inspect -f 'runtime={{.HostConfig.Runtime}}' softmusic-worker 2>&1 || true
  docker exec softmusic-worker env 2>/dev/null | grep -E '^(NVIDIA_|CUDA_)' || true
  echo ">> ---- logs softmusic-python-ai (tail 120) ----"
  docker logs --tail 120 softmusic-python-ai 2>&1 || true
  echo ">> ---- logs softmusic-worker (tail 80) ----"
  docker logs --tail 80 softmusic-worker 2>&1 || true
  echo ">> ---- docker inspect health ----"
  docker inspect -f '{{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' softmusic-python-ai 2>&1 || true
}

force_cpu() {
  USE_GPU=0
  COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
  # Evita o runtime nvidia e esconde CUDA para o PyTorch.
  # Shell env tem precedência sobre o .env na interpolação do compose.
  export CUDA_VISIBLE_DEVICES=""
  export NVIDIA_VISIBLE_DEVICES=""
}

compose_up() {
  docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" \
    --profile infra --profile app up -d --no-deps --force-recreate python-ai worker scheduler
}

# Confirma que o worker Celery enxerga CUDA de verdade (não só o host ter driver).
verify_worker_cuda() {
  local tries=0
  local runtime
  runtime="$(docker inspect -f '{{.HostConfig.Runtime}}' softmusic-worker 2>/dev/null || echo '?')"
  echo ">> softmusic-worker HostConfig.Runtime=${runtime}"
  if [[ "${runtime}" != "nvidia" ]]; then
    echo ">> ERRO: worker sem runtime nvidia (compose.gpu.yml não foi aplicado?). Runtime atual: ${runtime}"
    return 1
  fi
  while [[ "${tries}" -lt 12 ]]; do
    if docker exec softmusic-worker python - <<'PY'
import torch
import sys
ok = torch.cuda.is_available()
print(f"torch.cuda.is_available={ok}")
if ok:
    print(f"device={torch.cuda.get_device_name(0)}")
sys.exit(0 if ok else 1)
PY
    then
      echo ">> Worker CUDA OK"
      return 0
    fi
    tries=$((tries + 1))
    sleep 5
  done
  return 1
}

if [[ "${USE_GPU}" == "1" ]]; then
  # Garante env para o toolkit (compose com "" esconde a GPU).
  export NVIDIA_VISIBLE_DEVICES="${NVIDIA_VISIBLE_DEVICES:-all}"
  export NVIDIA_DRIVER_CAPABILITIES="${NVIDIA_DRIVER_CAPABILITIES:-compute,utility}"
  export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
  if [[ -z "${NVIDIA_VISIBLE_DEVICES}" || "${NVIDIA_VISIBLE_DEVICES}" == "void" || "${NVIDIA_VISIBLE_DEVICES}" == "none" ]]; then
    export NVIDIA_VISIBLE_DEVICES=all
  fi

  echo ">> GPU: verificando runtime nvidia no daemon do host..."
  if nvidia_docker_ok; then
    COMPOSE_FILES+=(-f docker-compose.gpu.yml)
    echo ">> GPU: overlay runtime nvidia (USE_GPU=1)"
    echo ">> GPU: NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES} CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}"
  else
    echo ">> ERRO: USE_GPU=1 mas Docker no host não consegue usar NVIDIA."
    echo "         Instale/configure o NVIDIA Container Toolkit e reinicie o Docker:"
    echo "         https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    if [[ "${ALLOW_CPU_FALLBACK}" == "1" ]]; then
      echo "         ALLOW_CPU_FALLBACK=1 — continuando em CPU (vai saturar o host durante Demucs)."
      force_cpu
    else
      echo "         Abortando. Corrija driver/toolkit ou rode com USE_GPU=0 / ALLOW_CPU_FALLBACK=1."
      exit 1
    fi
  fi
else
  echo ">> Compute: CPU (USE_GPU=0) — Demucs vai competir com API/MySQL no mesmo host"
  force_cpu
fi

if ! compose_up; then
  if [[ "${USE_GPU}" == "1" && "${ALLOW_CPU_FALLBACK}" == "1" ]]; then
    echo ">> AVISO: start com runtime nvidia falhou — retry em CPU (ALLOW_CPU_FALLBACK=1)..."
    force_cpu
    if ! compose_up; then
      dump_ia_logs
      exit 1
    fi
  else
    dump_ia_logs
    exit 1
  fi
fi

docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" ps python-ai worker scheduler

# Em prod o python-ai não publica porta no host — valida health via inspect.
if ! wait_container_healthy softmusic-python-ai 60; then
  dump_ia_logs
  exit 1
fi

if [[ "${USE_GPU}" == "1" ]]; then
  if ! verify_worker_cuda; then
    echo ">> ERRO: containers subiram com runtime nvidia, mas softmusic-worker não vê CUDA."
    echo "         Sem isso o Demucs roda em CPU e o app inteiro fica lento."
    dump_ia_logs
    if [[ "${ALLOW_CPU_FALLBACK}" == "1" ]]; then
      echo "         ALLOW_CPU_FALLBACK=1 — seguindo mesmo assim."
    else
      exit 1
    fi
  fi
fi

echo ">> Deploy IA OK (compute=$([[ "${USE_GPU}" == "1" ]] && echo gpu || echo cpu))"
