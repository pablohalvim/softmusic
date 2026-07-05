#!/usr/bin/env bash
# Wrapper para `docker build` nos pipelines Jenkins.
# Sem buildx → legacy builder com pré-build do stage deps (multi-stage).
# Com buildx → BuildKit normal.
set -euo pipefail

dockerfile=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  arg="${args[$i]}"
  if [[ "$arg" == "-f" || "$arg" == "--file" ]]; then
    dockerfile="${args[$((i + 1))]:-}"
    break
  elif [[ "$arg" == -f* && ${#arg} -gt 2 ]]; then
    dockerfile="${arg#-f}"
    break
  fi
done

has_deps_stage() {
  [[ -n "$dockerfile" && -f "$dockerfile" ]] && grep -qiE 'AS[[:space:]]+deps\b' "$dockerfile"
}

deps_cache_tag() {
  local slug
  slug="$(echo "$dockerfile" | tr '/\\' '-' | tr -cd '[:alnum:]-_.')"
  echo "softmusic-build-deps:${slug}"
}

if docker buildx version >/dev/null 2>&1; then
  export DOCKER_BUILDKIT=1
  export COMPOSE_DOCKER_CLI_BUILD=1
  echo ">> Docker BuildKit ativado (buildx OK)"
  exec docker build "$@"
fi

export DOCKER_BUILDKIT=0
unset COMPOSE_DOCKER_CLI_BUILD
echo ">> Legacy builder (DOCKER_BUILDKIT=0) — buildx indisponível no Jenkins"
echo ">> Se falhar com 'lease does not exist': sudo systemctl restart docker na VPS"

if has_deps_stage; then
  cache_tag="$(deps_cache_tag)"
  echo ">> Legacy multi-stage: pré-build --target deps → ${cache_tag}"
  docker build --target deps -t "${cache_tag}" "$@"
  echo ">> Legacy multi-stage: build final (cache-from ${cache_tag})"
  docker build --cache-from "${cache_tag}" "$@"
else
  docker build "$@"
fi
