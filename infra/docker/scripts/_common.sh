#!/usr/bin/env bash
# =============================================================================
# SoftMusic — helpers comuns de deploy
# =============================================================================

SRC_INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/softmusic}"
DEPLOY_DIR_HOST="${DEPLOY_DIR_HOST:-${DEPLOY_DIR}}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env.production}"

export SOFTMUSIC_MYSQL_INIT_DIR="${DEPLOY_DIR_HOST}/mysql/init"
export SOFTMUSIC_MONITORING_DIR="${DEPLOY_DIR_HOST}/monitoring"
export SOFTMUSIC_NGINX_DIR="${DEPLOY_DIR_HOST}/nginx"

# -----------------------------------------------------------------------------
# docker compose (plugin V2) ou docker-compose (binário / plugin standalone)
# No Jenkins-em-container o CLI do host é montado via socket, mas o plugin
# compose precisa existir DENTRO do container (volume) ou em ~/.docker/cli-plugins.
# -----------------------------------------------------------------------------
DOCKER_COMPOSE_CMD=()

resolve_docker_compose() {
  if [[ ${#DOCKER_COMPOSE_CMD[@]} -gt 0 ]]; then
    return 0
  fi

  if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD=(docker compose)
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD=(docker-compose)
    return 0
  fi

  local candidate
  for candidate in \
    "${HOME}/.docker/cli-plugins/docker-compose" \
    /var/jenkins_home/.docker/cli-plugins/docker-compose \
    /usr/libexec/docker/cli-plugins/docker-compose \
    /usr/local/lib/docker/cli-plugins/docker-compose \
    /usr/lib/docker/cli-plugins/docker-compose
  do
    if [[ -x "${candidate}" ]]; then
      # Plugin V2 aceita sintaxe docker-compose quando chamado direto.
      if "${candidate}" version >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD=("${candidate}")
        return 0
      fi
    fi
  done

  echo "ERRO: 'docker compose' não está disponível neste ambiente (Jenkins)." >&2
  echo "      O CLI docker está montado, mas o plugin compose não." >&2
  echo "" >&2
  echo "Correção rápida NA VPS (host), sem recriar o Jenkins:" >&2
  echo "  PLUGIN=/usr/libexec/docker/cli-plugins/docker-compose" >&2
  echo "  # se não existir: find /usr -name docker-compose 2>/dev/null" >&2
  echo "  mkdir -p /dados/jenkins_home/.docker/cli-plugins" >&2
  echo "  cp -f \"\$PLUGIN\" /dados/jenkins_home/.docker/cli-plugins/docker-compose" >&2
  echo "  chmod +x /dados/jenkins_home/.docker/cli-plugins/docker-compose" >&2
  echo "  docker exec -u jenkins jenkins docker compose version" >&2
  echo "" >&2
  echo "Ou remonte o container Jenkins com o plugin (permanente):" >&2
  echo "  -v /usr/libexec/docker/cli-plugins/docker-compose:/usr/libexec/docker/cli-plugins/docker-compose" >&2
  return 1
}

docker_compose() {
  resolve_docker_compose || exit 1
  echo ">> ${DOCKER_COMPOSE_CMD[*]} $*"
  "${DOCKER_COMPOSE_CMD[@]}" "$@"
}

stage_assets() {
  mkdir -p "${DEPLOY_DIR}"

  cp "${SRC_INFRA}/docker/docker-compose.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.infra.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.infra-legacy.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.prod.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.gpu.yml" "${DEPLOY_DIR}/"

  rm -rf "${DEPLOY_DIR}/mysql" "${DEPLOY_DIR}/monitoring" "${DEPLOY_DIR}/nginx"
  cp -r "${SRC_INFRA}/docker/mysql" "${DEPLOY_DIR}/mysql"
  cp -r "${SRC_INFRA}/monitoring"   "${DEPLOY_DIR}/monitoring"
  cp -r "${SRC_INFRA}/nginx"        "${DEPLOY_DIR}/nginx"

  rm -f "${DEPLOY_DIR}/nginx/conf.d/softmusic.conf"

  echo ">> Assets de deploy em ${DEPLOY_DIR} (host: ${DEPLOY_DIR_HOST})"
}

compose_files() {
  printf '%s\n' -f docker-compose.yml -f docker-compose.prod.yml
}

load_host_ports() {
  WEB_PORT="${WEB_PORT:-4101}"
  LP_PORT="${LP_PORT:-4100}"
  ADMIN_PORT="${ADMIN_PORT:-4102}"
  API_PORT="${API_PORT:-8081}"
  GRAFANA_PORT="${GRAFANA_PORT:-4103}"
  if [[ -f "${ENV_FILE}" ]]; then
    WEB_PORT="$(grep -E '^WEB_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || echo "${WEB_PORT}")"
    LP_PORT="$(grep -E '^LP_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || echo "${LP_PORT}")"
    ADMIN_PORT="$(grep -E '^ADMIN_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || echo "${ADMIN_PORT}")"
    API_PORT="$(grep -E '^API_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || echo "${API_PORT}")"
    GRAFANA_PORT="$(grep -E '^GRAFANA_PORT=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || echo "${GRAFANA_PORT}")"
  fi
  export WEB_PORT LP_PORT ADMIN_PORT API_PORT GRAFANA_PORT
}

require_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERRO: ${ENV_FILE} não encontrado. Rode o stage do .env (render-env.sh) antes." >&2
    exit 1
  fi
}

wait_http() {
  local url="$1" tries="${2:-30}" i
  for (( i = 0; i < tries; i++ )); do
    if curl -sf "${url}" >/dev/null 2>&1; then
      echo ">> OK: ${url}"
      return 0
    fi
    sleep 2
  done
  echo ">> AVISO: ${url} não respondeu a tempo. Verifique 'docker logs'."
  return 0
}

wait_container_healthy() {
  local name="$1" tries="${2:-30}" i status
  for (( i = 0; i < tries; i++ )); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      echo ">> OK: ${name} healthy"
      return 0
    fi
    sleep 2
  done
  echo ">> AVISO: ${name} não ficou healthy a tempo. Verifique 'docker logs ${name}'."
  return 0
}
