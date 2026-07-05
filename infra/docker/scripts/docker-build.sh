#!/usr/bin/env bash
# Wrapper para `docker build` nos pipelines Jenkins.
# Com buildx → BuildKit. Sem buildx → legacy builder com retry em lease errors.
set -euo pipefail

if docker buildx version >/dev/null 2>&1; then
  export DOCKER_BUILDKIT=1
  export COMPOSE_DOCKER_CLI_BUILD=1
  echo ">> Docker BuildKit ativado (buildx OK)"
  exec docker build "$@"
fi

export DOCKER_BUILDKIT=0
unset COMPOSE_DOCKER_CLI_BUILD
echo ">> Legacy builder (DOCKER_BUILDKIT=0) — buildx indisponível no Jenkins"

docker_build_retry() {
  local attempt output code max=3
  for attempt in $(seq 1 "$max"); do
    set +e
    output="$(docker build "$@" 2>&1)"
    code=$?
    set -e
    printf '%s\n' "$output"
    if [[ "$code" -eq 0 ]]; then
      return 0
    fi
    if echo "$output" | grep -qiE 'lease does not exist|failed to prepare snapshot'; then
      echo ">> Docker lease/snapshot error (tentativa ${attempt}/${max}) — limpando cache..."
      docker builder prune -f 2>/dev/null || true
      docker image prune -f 2>/dev/null || true
      sleep "$((attempt * 3))"
    else
      return "$code"
    fi
  done
  echo "ERRO: build falhou após ${max} tentativas (lease does not exist)." >&2
  echo "      Na VPS: sudo systemctl restart docker && re-rodar o job" >&2
  return 1
}

docker_build_retry "$@"
