#!/usr/bin/env bash
# Wrapper para `docker build` nos pipelines Jenkins.
# Sem buildx no container → DOCKER_BUILDKIT=0 (legacy). Com buildx → BuildKit.
set -euo pipefail

if docker buildx version >/dev/null 2>&1; then
  export DOCKER_BUILDKIT=1
  export COMPOSE_DOCKER_CLI_BUILD=1
  echo ">> Docker BuildKit ativado (buildx OK)"
else
  export DOCKER_BUILDKIT=0
  unset COMPOSE_DOCKER_CLI_BUILD
  echo ">> Legacy builder (DOCKER_BUILDKIT=0) — buildx indisponível no Jenkins"
  echo ">> Se falhar com 'lease does not exist': sudo systemctl restart docker na VPS"
fi

exec docker build "$@"
