#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — Provisiona a infra completa da VPS
# MySQL (opcional) + Redis + RabbitMQ + Observabilidade (Prometheus, Loki,
# Promtail, Grafana, OpenTelemetry Collector).
#
# Roda com o Jenkins DENTRO de um container: os assets (compose + configs de
# observabilidade) são copiados para ${DEPLOY_DIR} (visível ao daemon do host
# em ${DEPLOY_DIR_HOST}) e os bind mounts usam esse caminho de host.
#
# Variáveis:
#   DEPLOY_DIR / DEPLOY_DIR_HOST  (ver _common.sh)
#   ENV_FILE            (default ${DEPLOY_DIR}/.env.production)
#   INSTALL_MYSQL=1|0   1=sobe MySQL/MariaDB no Docker (padrão)
#                       0=usa banco externo (MYSQL_HOST/MYSQL_PORT no .env)
#   LEGACY_MYSQL=1      usa MariaDB 10.5.28 (CPUs antigas; só se INSTALL_MYSQL=1)
#   WITH_OBSERVABILITY  (default 1) sobe toda a stack de observabilidade
#   SKIP_PULL=1         pula o docker compose pull das imagens públicas
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

LEGACY="${LEGACY_MYSQL:-0}"
OBSERVABILITY="${WITH_OBSERVABILITY:-1}"
INSTALL_MYSQL="${INSTALL_MYSQL:-1}"

# Preferir o valor já gravado no .env (gerado pelo render-env.sh no mesmo job).
if [[ -f "${ENV_FILE}" ]]; then
  env_install="$(grep -E '^INSTALL_MYSQL=' "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
  if [[ -n "${env_install}" ]]; then
    INSTALL_MYSQL="${env_install}"
  fi
fi

require_env_file

# --- Preflight: variáveis obrigatórias no .env ------------------------------
required_vars=(MYSQL_PASSWORD RABBITMQ_PASSWORD DATABASE_URL)
if [[ "${INSTALL_MYSQL}" != "0" ]]; then
  required_vars+=(MYSQL_ROOT_PASSWORD)
else
  required_vars+=(MYSQL_HOST MYSQL_PORT)
fi
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

# Garante docker compose (baixa o plugin para jenkins_home se faltar).
resolve_docker_compose || exit 1
echo ">> Compose OK: ${DOCKER_COMPOSE_CMD[*]}"

# --- Seleção de arquivos compose --------------------------------------------
COMPOSE_FILES=(-f docker-compose.infra.yml)
if [[ "${INSTALL_MYSQL}" != "0" && "${LEGACY}" == "1" ]]; then
  COMPOSE_FILES+=(-f docker-compose.infra-legacy.yml)
  echo ">> Modo LEGACY: MariaDB 10.5.28"
elif [[ "${INSTALL_MYSQL}" != "0" ]]; then
  echo ">> Modo padrão: MySQL 8.4 (container local)"
else
  mysql_host="$(grep -E '^MYSQL_HOST=' "${ENV_FILE}" | tail -n1 | cut -d= -f2-)"
  mysql_port="$(grep -E '^MYSQL_PORT=' "${ENV_FILE}" | tail -n1 | cut -d= -f2-)"
  echo ">> MySQL: EXTERNO (${mysql_host}:${mysql_port}) — container local NÃO será instalado"
fi

# --- Profiles e containers esperados ----------------------------------------
PROFILES=(--profile infra)
EXPECTED=(softmusic-redis softmusic-rabbitmq)
if [[ "${INSTALL_MYSQL}" != "0" ]]; then
  PROFILES+=(--profile mysql)
  EXPECTED+=(softmusic-mysql)
fi
if [[ "${OBSERVABILITY}" == "1" ]]; then
  PROFILES+=(--profile observability)
  EXPECTED+=(softmusic-prometheus softmusic-loki softmusic-promtail softmusic-grafana softmusic-otel-collector)
  echo ">> Observabilidade: HABILITADA"
else
  echo ">> Observabilidade: DESABILITADA (WITH_OBSERVABILITY=0)"
fi

if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" pull
fi

# Sem --remove-orphans: a infra compartilha o projeto `softmusic` com os apps.
# force-recreate no Grafana: troca de bind mount / JSONs não entra com up -d simples.
docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" up -d --force-recreate grafana
docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" up -d

# Se migrou para banco externo, derruba o MySQL local antigo (se existir).
if [[ "${INSTALL_MYSQL}" == "0" ]]; then
  if docker ps -a --format '{{.Names}}' | grep -qx 'softmusic-mysql'; then
    echo ">> Removendo container local softmusic-mysql (INSTALL_MYSQL=0)..."
    docker rm -f softmusic-mysql >/dev/null 2>&1 || true
  fi
fi

if [[ "${INSTALL_MYSQL}" != "0" ]]; then
  echo ">> Aguardando MySQL..."
  for _ in $(seq 1 30); do
    if docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" exec -T mysql mysqladmin ping -h localhost --silent 2>/dev/null; then
      echo ">> MySQL OK"
      break
    fi
    sleep 2
  done
else
  echo ">> Pulando healthcheck do MySQL local (banco externo)."
fi

docker_compose "${COMPOSE_FILES[@]}" --env-file "${ENV_FILE}" "${PROFILES[@]}" ps

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

# --- Verificação: dashboards Grafana no bind mount ---------------------------
if [[ "${OBSERVABILITY}" == "1" ]]; then
  host_dash_dir="${DEPLOY_DIR}/monitoring/grafana/dashboards"
  host_json="$(find "${host_dash_dir}" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  echo ">> Grafana dashboards no host (${host_dash_dir}): ${host_json} JSON"
  if [[ "${host_json}" == "0" ]]; then
    echo ">> AVISO: nenhum *.json em monitoring/grafana/dashboards — pasta SoftMusic ficará vazia."
  fi
  echo ">> Grafana dashboards no container (/etc/grafana/dashboards):"
  docker exec softmusic-grafana ls -la /etc/grafana/dashboards 2>&1 || true
fi

echo ">> Servidor preparado."
