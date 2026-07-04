#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Provisiona a infra completa da VPS
# MySQL + Redis + RabbitMQ + Observabilidade (Prometheus, Loki, Promtail,
# Grafana, OpenTelemetry Collector).
#
# Roda com o Jenkins DENTRO de um container: os assets (compose + configs de
# observabilidade) são copiados para ${DEPLOY_DIR} (visível ao daemon do host
# em ${DEPLOY_DIR_HOST}) e os bind mounts usam esse caminho de host.
#
# Variáveis:
#   DEPLOY_DIR / DEPLOY_DIR_HOST  (ver _common.sh)
#   ENV_FILE            (default ${DEPLOY_DIR}/.env.production)
#   LEGACY_MYSQL=1      usa MariaDB 10.5.28 (CPUs antigas)
#   WITH_OBSERVABILITY  (default 1) sobe toda a stack de observabilidade
#   SKIP_PULL=1         pula o docker compose pull das imagens públicas
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

LEGACY="${LEGACY_MYSQL:-0}"
OBSERVABILITY="${WITH_OBSERVABILITY:-1}"

require_env_file

# --- Preflight: variáveis obrigatórias no .env ------------------------------
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
  exit 1
fi

stage_assets
cd "${DEPLOY_DIR}"

# --- Seleção de arquivos compose --------------------------------------------
COMPOSE_FILES=(-f docker-compose.infra.yml)
if [[ "${LEGACY}" == "1" ]]; then
  COMPOSE_FILES+=(-f docker-compose.infra-legacy.yml)
  echo ">> Modo LEGACY: MariaDB 10.5.28"
else
  echo ">> Modo padrão: MySQL 8.4"
fi

# --- Profiles e containers esperados ----------------------------------------
PROFILES=(--profile infra)
EXPECTED=(softmusic-mysql softmusic-redis softmusic-rabbitmq)
if [[ "${OBSERVABILITY}" == "1" ]]; then
  PROFILES+=(--profile observability)
  EXPECTED+=(softmusic-prometheus softmusic-loki softmusic-promtail softmusic-grafana softmusic-otel-collector)
  echo ">> Observabilidade: HABILITADA"
else
  echo ">> Observabilidade: DESABILITADA (WITH_OBSERVABILITY=0)"
fi

if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  docker compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" pull
fi

# Sem --remove-orphans: a infra compartilha o projeto `softmusic` com os apps.
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
  echo "ERRO: nem todos os serviços subiram. Cheque os logs acima."
  exit 1
fi

echo ">> Servidor preparado."
