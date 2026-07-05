#!/usr/bin/env bash
# =============================================================================
# SoftMusic — helpers comuns de deploy
# =============================================================================
# Cenário: o Jenkins roda DENTRO de um container e fala com o daemon Docker do
# HOST via /var/run/docker.sock. Logo, todo bind mount do compose precisa
# apontar para um caminho que o daemon do HOST enxergue.
#
# Estratégia (staging): copiamos os arquivos de deploy (compose + configs de
# observabilidade + nginx + mysql/init) para ${DEPLOY_DIR}. Como esse diretório
# fica dentro do volume do Jenkins (ex.: container /var/jenkins_home ->
# host /dados/jenkins_home), os arquivos existem também no HOST em
# ${DEPLOY_DIR_HOST}. Os bind mounts do compose usam ${DEPLOY_DIR_HOST}.
#
# Variáveis:
#   DEPLOY_DIR       Caminho onde o staging é gravado (visão do Jenkins/container).
#                    Default: /opt/softmusic (uso direto no host).
#   DEPLOY_DIR_HOST  Mesmo diretório na visão do HOST/daemon. Default: DEPLOY_DIR
#                    (quando roda direto no host os dois são iguais).
#   ENV_FILE         Arquivo .env de produção. Default: ${DEPLOY_DIR}/.env.production
# =============================================================================

# Diretório `infra/` do repositório (fonte dos assets). Este arquivo vive em
# infra/docker/scripts/_common.sh, então subir 2 níveis chega em infra/.
SRC_INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

DEPLOY_DIR="${DEPLOY_DIR:-/opt/softmusic}"
DEPLOY_DIR_HOST="${DEPLOY_DIR_HOST:-${DEPLOY_DIR}}"
ENV_FILE="${ENV_FILE:-${DEPLOY_DIR}/.env.production}"

# Caminhos de host para os bind mounts (usados na interpolação do compose).
export SOFTMUSIC_MYSQL_INIT_DIR="${DEPLOY_DIR_HOST}/mysql/init"
export SOFTMUSIC_MONITORING_DIR="${DEPLOY_DIR_HOST}/monitoring"
export SOFTMUSIC_NGINX_DIR="${DEPLOY_DIR_HOST}/nginx"

# -----------------------------------------------------------------------------
# stage_assets: copia compose + configs do repositório para ${DEPLOY_DIR}.
# Idempotente — pode rodar em todo deploy.
# -----------------------------------------------------------------------------
stage_assets() {
  mkdir -p "${DEPLOY_DIR}"

  cp "${SRC_INFRA}/docker/docker-compose.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.infra.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.infra-legacy.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.prod.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.gpu.yml" "${DEPLOY_DIR}/"
  cp "${SRC_INFRA}/docker/docker-compose.easypanel.yml" "${DEPLOY_DIR}/"

  mkdir -p "${DEPLOY_DIR}/traefik"
  cp "${SRC_INFRA}/traefik/easypanel-softmusic.yaml" "${DEPLOY_DIR}/traefik/"

  rm -rf "${DEPLOY_DIR}/mysql" "${DEPLOY_DIR}/monitoring" "${DEPLOY_DIR}/nginx"
  cp -r "${SRC_INFRA}/docker/mysql" "${DEPLOY_DIR}/mysql"
  cp -r "${SRC_INFRA}/monitoring"   "${DEPLOY_DIR}/monitoring"
  cp -r "${SRC_INFRA}/nginx"        "${DEPLOY_DIR}/nginx"

  # Configs só para dev local — não publicar na VPS.
  rm -f "${DEPLOY_DIR}/nginx/conf.d/softmusic.conf"

  echo ">> Assets de deploy em ${DEPLOY_DIR} (host: ${DEPLOY_DIR_HOST})"
}

# -----------------------------------------------------------------------------
# load_compose_env: lê EDGE_PROXY e TRAEFIK_DOCKER_NETWORK do .env de produção.
# -----------------------------------------------------------------------------
load_compose_env() {
  EDGE_PROXY="nginx"
  TRAEFIK_DOCKER_NETWORK="easypanel"
  if [[ -f "${ENV_FILE}" ]]; then
    # shellcheck disable=SC1090
    EDGE_PROXY="$(grep -E '^EDGE_PROXY=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
    TRAEFIK_DOCKER_NETWORK="$(grep -E '^TRAEFIK_DOCKER_NETWORK=' "${ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
  fi
  EDGE_PROXY="${EDGE_PROXY:-nginx}"
  TRAEFIK_DOCKER_NETWORK="${TRAEFIK_DOCKER_NETWORK:-easypanel}"
  export EDGE_PROXY TRAEFIK_DOCKER_NETWORK
}

# -----------------------------------------------------------------------------
# compose_files: arquivos compose conforme EDGE_PROXY.
# -----------------------------------------------------------------------------
compose_files() {
  local files=(-f docker-compose.yml -f docker-compose.prod.yml)
  load_compose_env
  if [[ "${EDGE_PROXY}" == "easypanel" ]]; then
    files+=(-f docker-compose.easypanel.yml)
  fi
  printf '%s\n' "${files[@]}"
}

# -----------------------------------------------------------------------------
# deploy_edge_proxy: nginx (padrão) ou rede Traefik (EasyPanel).
# -----------------------------------------------------------------------------
deploy_edge_proxy() {
  local connect_script
  connect_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/connect-traefik-network.sh"
  load_compose_env
  if [[ "${EDGE_PROXY}" == "easypanel" ]]; then
    echo ">> EDGE_PROXY=easypanel — nginx/certbot do SoftMusic desativados"
    docker rm -f softmusic-nginx softmusic-certbot 2>/dev/null || true
    bash "${connect_script}"
    return 0
  fi
  deploy_nginx
}

# -----------------------------------------------------------------------------
# prepare_nginx_tls: ativa HTTPS quando certificados existem no volume certbot.
# Remove o bootstrap HTTP (production-http.conf) para evitar conflito de :80.
# -----------------------------------------------------------------------------
prepare_nginx_tls() {
  local nginx_conf="${DEPLOY_DIR}/nginx/conf.d"
  local ssl_example="${nginx_conf}/production-ssl.conf.example"
  local ssl_active="${nginx_conf}/production-ssl.conf"
  local http_bootstrap="${nginx_conf}/production-http.conf"
  local cert_path="/etc/letsencrypt/live/softmusic.com.br/fullchain.pem"

  if docker run --rm -v softmusic_certbot_certs:/etc/letsencrypt:ro alpine \
      test -f "${cert_path}" 2>/dev/null; then
    if [[ ! -f "${ssl_active}" && -f "${ssl_example}" ]]; then
      cp "${ssl_example}" "${ssl_active}"
      echo ">> TLS: production-ssl.conf ativado"
    fi
    if [[ -f "${http_bootstrap}" ]]; then
      rm -f "${http_bootstrap}"
      echo ">> TLS: production-http.conf removido (bootstrap HTTP)"
    fi
  else
    if [[ -f "${ssl_active}" ]]; then
      echo ">> AVISO: production-ssl.conf presente mas certificado não encontrado — nginx pode falhar" >&2
    fi
  fi
}

# -----------------------------------------------------------------------------
# deploy_nginx: sobe/recarrega o edge nginx de produção.
# -----------------------------------------------------------------------------
deploy_nginx() {
  local compose_files=(-f docker-compose.yml -f docker-compose.prod.yml)
  prepare_nginx_tls
  docker compose "${compose_files[@]}" --env-file "${ENV_FILE}" \
    --profile infra --profile app up -d --no-deps nginx \
    || echo ">> AVISO: nginx não subiu (certificados TLS ainda não emitidos?)."
}

# -----------------------------------------------------------------------------
# require_env_file: garante que o .env de produção existe.
# -----------------------------------------------------------------------------
require_env_file() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "ERRO: ${ENV_FILE} não encontrado. Rode o stage do .env (render-env.sh) antes." >&2
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# wait_http URL [tentativas]: aguarda o serviço responder (health). Só avisa se
# não responder — o deploy em si já ocorreu no `compose up`.
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# wait_container_healthy NAME [tentativas]: aguarda healthcheck do container.
# -----------------------------------------------------------------------------
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
