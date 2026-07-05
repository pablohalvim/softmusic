#!/usr/bin/env bash
# Finaliza o edge Traefik/EasyPanel após deploy do admin (último job da sequência).
# Só executa quando EDGE_PROXY=easypanel no .env.production.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

load_compose_env
if [[ "${EDGE_PROXY}" != "easypanel" ]]; then
  echo ">> EDGE_PROXY=${EDGE_PROXY} — finalize EasyPanel ignorado"
  exit 0
fi

TRAEFIK_SRC="${DEPLOY_DIR}/traefik/easypanel-softmusic.yaml"
TRAEFIK_SRC_HOST="${DEPLOY_DIR_HOST}/traefik/easypanel-softmusic.yaml"
TRAEFIK_DEST_DIR="${EASYPANEL_TRAEFIK_CONFIG_DIR:-/etc/easypanel/traefik/config}"
TRAEFIK_DEST_NAME="${EASYPANEL_TRAEFIK_CONFIG_NAME:-softmusic.yaml}"

if [[ ! -f "${TRAEFIK_SRC}" ]]; then
  echo "ERRO: ${TRAEFIK_SRC} não encontrado. Rode stage_assets antes." >&2
  exit 1
fi

echo ">> EasyPanel: publicando rotas Traefik em ${TRAEFIK_DEST_DIR}/${TRAEFIK_DEST_NAME}"

if ! docker run --rm \
  -v "${TRAEFIK_SRC_HOST}:/src.yaml:ro" \
  -v "${TRAEFIK_DEST_DIR}:/dest" \
  alpine sh -c "cp /src.yaml /dest/${TRAEFIK_DEST_NAME} && chmod 644 /dest/${TRAEFIK_DEST_NAME}"; then
  echo "ERRO: não foi possível copiar config Traefik para ${TRAEFIK_DEST_DIR}" >&2
  echo "     Verifique se o EasyPanel está instalado nesse caminho no host." >&2
  exit 1
fi

echo ">> EasyPanel: removendo nginx/certbot conflitantes (se existirem)"
docker rm -f softmusic-nginx softmusic-certbot 2>/dev/null || true

echo ">> EasyPanel: conectando containers à rede ${TRAEFIK_DOCKER_NETWORK}"
bash "${SCRIPT_DIR}/connect-traefik-network.sh"

TRAEFIK_CID="$(docker ps -q -f name=easypanel-traefik | head -1 || true)"
if [[ -n "${TRAEFIK_CID}" ]]; then
  echo ">> EasyPanel: reiniciando Traefik (${TRAEFIK_CID})"
  docker restart "${TRAEFIK_CID}" >/dev/null
  sleep 3
else
  TRAEFIK_SVC="$(docker service ls --filter name=easypanel-traefik --format '{{.ID}}' 2>/dev/null | head -1 || true)"
  if [[ -n "${TRAEFIK_SVC}" ]]; then
    echo ">> EasyPanel: forçando update do serviço Traefik (${TRAEFIK_SVC})"
    docker service update --force "${TRAEFIK_SVC}" >/dev/null
    sleep 5
  else
    echo ">> AVISO: container/serviço easypanel-traefik não encontrado — reinicie manualmente no painel"
  fi
fi

echo ">> EasyPanel: smoke test (best-effort)"
for url in \
  "https://softmusic.com.br/" \
  "https://app.softmusic.com.br/" \
  "https://app.softmusic.com.br/api/health/live" \
  "https://admin.softmusic.com.br/"; do
  if curl -sfI --max-time 15 "${url}" >/dev/null 2>&1; then
    echo "   OK  ${url}"
  else
    echo "   ??  ${url} (ainda não responde — DNS/TLS podem levar alguns minutos)"
  fi
done

echo ">> EasyPanel: finalize concluído"
