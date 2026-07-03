#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Provisiona a infra completa da VPS
# MySQL + Redis + RabbitMQ + Observabilidade (Prometheus, Loki, Promtail,
# Grafana, OpenTelemetry Collector).
#
# Objetivo: deixar o servidor pronto para a aplicação rodar. Os serviços de
# app (api, python-ai, worker, web, lp, admin-web) são deployados por seus
# próprios jobs, no MESMO projeto/rede docker (`softmusic`).
#
# Variáveis:
#   ENV_FILE            (default /opt/softmusic/.env.production)
#   LEGACY_MYSQL=1      usa MySQL 5.7 (CPUs antigas)
#   WITH_OBSERVABILITY  (default 1) sobe toda a stack de observabilidade
#   SKIP_PULL=1         pula o docker compose pull
# =============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_DIR="${ROOT_DIR}/infra/docker"
ENV_FILE="${ENV_FILE:-/opt/softmusic/.env.production}"
LEGACY="${LEGACY_MYSQL:-0}"
OBSERVABILITY="${WITH_OBSERVABILITY:-1}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERRO: ${ENV_FILE} não encontrado."
  exit 1
fi

# --- Preflight: variáveis obrigatórias --------------------------------------
# Sem elas o `docker compose up` aborta a stack inteira (inclusive o MySQL),
# com um erro pouco claro. Validamos antes, com mensagem objetiva.
required_vars=(MYSQL_ROOT_PASSWORD MYSQL_PASSWORD RABBITMQ_PASSWORD)
if [[ "${OBSERVABILITY}" == "1" ]]; then
  required_vars+=(GRAFANA_ADMIN_PASSWORD)
fi

missing=()
for var in "${required_vars[@]}"; do
  value="$(grep -E "^${var}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
  if [[ -z "${value}" || "${value}" == SUBSTITUA* ]]; then
    missing+=("${var}")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERRO: variáveis obrigatórias ausentes/não configuradas em ${ENV_FILE}:"
  printf '   - %s\n' "${missing[@]}"
  echo "      Preencha-as (veja infra/docker/.env.production.example) e rode novamente."
  exit 1
fi

# --- Seleção de arquivos compose --------------------------------------------
COMPOSE_FILES=(-f "${COMPOSE_DIR}/docker-compose.infra.yml")
if [[ "${LEGACY}" == "1" ]]; then
  COMPOSE_FILES+=(-f "${COMPOSE_DIR}/docker-compose.infra-legacy.yml")
  echo ">> Modo LEGACY: MySQL 5.7"
else
  echo ">> Modo padrão: MySQL 8.4"
fi

# --- Profiles e containers esperados ----------------------------------------
PROFILES=(--profile infra)
EXPECTED=(softmusic-mysql softmusic-redis softmusic-rabbitmq)
if [[ "${OBSERVABILITY}" == "1" ]]; then
  PROFILES+=(--profile observability)
  EXPECTED+=(softmusic-prometheus softmusic-loki softmusic-promtail softmusic-grafana softmusic-otel-collector)
  echo ">> Observabilidade: HABILITADA (Prometheus, Loki, Promtail, Grafana, OTel Collector)"
else
  echo ">> Observabilidade: DESABILITADA (WITH_OBSERVABILITY=0)"
fi

cd "${COMPOSE_DIR}"

if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" pull
fi

# Sem --remove-orphans: a infra compartilha o projeto `softmusic` com os
# serviços de app (deployados por outros jobs). Remover órfãos aqui apagaria
# os containers da aplicação.
docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" up -d

echo ">> Aguardando MySQL..."
for _ in $(seq 1 30); do
  if docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
    echo ">> MySQL OK"
    break
  fi
  sleep 2
done

docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" ps

# --- Verificação: todos os containers esperados no ar -----------------------
echo ">> Verificando containers de infra/observabilidade..."
fail=0
for name in "${EXPECTED[@]}"; do
  if [[ -n "$(docker ps --filter "name=^/${name}$" --filter "status=running" --format '{{.Names}}')" ]]; then
    echo "   OK   ${name}"
  else
    echo "   ERRO ${name} não está rodando"
    fail=1
  fi
done
if [[ "${fail}" -ne 0 ]]; then
  echo "ERRO: nem todos os serviços de infra/observabilidade subiram. Cheque os logs acima."
  exit 1
fi

if [[ "${OBSERVABILITY}" == "1" ]]; then
  echo ">> Servidor preparado: MySQL + Redis + RabbitMQ + observabilidade prontos."
else
  echo ">> Servidor preparado: MySQL + Redis + RabbitMQ prontos (sem observabilidade)."
fi
