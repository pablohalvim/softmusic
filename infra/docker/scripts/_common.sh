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

  rm -rf "${DEPLOY_DIR}/mysql" "${DEPLOY_DIR}/monitoring" "${DEPLOY_DIR}/nginx"
  cp -r "${SRC_INFRA}/docker/mysql" "${DEPLOY_DIR}/mysql"
  cp -r "${SRC_INFRA}/monitoring"   "${DEPLOY_DIR}/monitoring"
  cp -r "${SRC_INFRA}/nginx"        "${DEPLOY_DIR}/nginx"

  echo ">> Assets de deploy em ${DEPLOY_DIR} (host: ${DEPLOY_DIR_HOST})"
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
