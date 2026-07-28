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
    if echo "$output" | grep -qiE \
      'lease does not exist|failed to prepare snapshot|failed to write compressed diff|failed to create diff tar stream|mount callback failed|failed to apply diff|failed to Lchown|Lchown .* no such file|content digest sha256:|NotFound: content digest'; then
      echo ">> Docker layer/export error (tentativa ${attempt}/${max}) — limpando cache..."
      docker builder prune -af 2>/dev/null || true
      docker image prune -af 2>/dev/null || true
      # Remove layers intermediárias órfãs (legacy builder + containerd)
      docker system prune -af 2>/dev/null || true
      sleep "$((attempt * 8))"
    else
      return "$code"
    fi
  done
  echo "ERRO: build falhou após ${max} tentativas (erro de layer/export do Docker)." >&2
  echo "      Na VPS: sudo systemctl restart docker && docker system prune -af && re-rodar o job" >&2
  return 1
}

docker_build_retry "$@"
