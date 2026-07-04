#!/usr/bin/env bash
# Ativa BuildKit só se buildx estiver disponível no daemon (Jenkins em container
# costuma ter docker CLI sem buildx). Sem buildx, mantém legacy builder.

if docker buildx version >/dev/null 2>&1; then
  export DOCKER_BUILDKIT=1
  export COMPOSE_DOCKER_CLI_BUILD=1
  echo ">> Docker BuildKit ativado (buildx OK)"
else
  unset DOCKER_BUILDKIT
  unset COMPOSE_DOCKER_CLI_BUILD
  echo ">> AVISO: buildx indisponível — usando legacy builder."
  echo ">> Se falhar com 'lease does not exist', rode na VPS: sudo systemctl restart docker"
fi
