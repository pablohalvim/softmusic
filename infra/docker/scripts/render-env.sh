#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# SoftMusic — gera o .env de produção a partir de credenciais Jenkins
# =============================================================================
# Os SEGREDOS chegam como variáveis de ambiente (bindings de `withCredentials`
# no Jenkinsfile, tipo "Secret text"). As demais chaves são CONFIG com defaults
# sensatos, sobrescrevíveis por variável de ambiente do job.
#
# Escreve ${ENV_FILE} (default ${DEPLOY_DIR}/.env.production). Nunca ecoa
# segredos no log.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
source "${SCRIPT_DIR}/_common.sh"

# --- Segredos obrigatórios (Secret text) ------------------------------------
required_secrets=(
  MYSQL_ROOT_PASSWORD
  MYSQL_PASSWORD
  REDIS_PASSWORD
  RABBITMQ_PASSWORD
  JWT_PRIVATE_KEY
  GRAFANA_ADMIN_PASSWORD
)
missing=()
for s in "${required_secrets[@]}"; do
  if [[ -z "${!s:-}" ]]; then
    missing+=("${s}")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERRO: credenciais Jenkins ausentes (bindings withCredentials):" >&2
  printf '   - %s\n' "${missing[@]}" >&2
  echo "      Cadastre-as como 'Secret text' — veja infra/jenkins/credentials.md" >&2
  exit 1
fi

# --- Config (defaults sobrescrevíveis por env do job) -----------------------
NODE_ENV="${NODE_ENV:-production}"
SOFTMUSIC_ENV="${SOFTMUSIC_ENV:-production}"
LOG_LEVEL="${LOG_LEVEL:-info}"

EDGE_PROXY="${EDGE_PROXY:-nginx}"
TRAEFIK_DOCKER_NETWORK="${TRAEFIK_DOCKER_NETWORK:-easypanel}"

WEB_ORIGIN="${WEB_ORIGIN:-https://app.softmusic.com.br}"
API_BASE_URL="${API_BASE_URL:-https://app.softmusic.com.br/api}"
VITE_API_URL="${VITE_API_URL:-https://app.softmusic.com.br/api}"
VITE_APP_URL="${VITE_APP_URL:-https://app.softmusic.com.br}"
LP_ORIGIN="${LP_ORIGIN:-https://softmusic.com.br}"
ADMIN_ORIGIN="${ADMIN_ORIGIN:-https://admin.softmusic.com.br}"
VITE_ADMIN_API_URL="${VITE_ADMIN_API_URL:-${ADMIN_ORIGIN}/api}"

MYSQL_DATABASE="${MYSQL_DATABASE:-softmusic}"
MYSQL_USER="${MYSQL_USER:-softmusic}"
RABBITMQ_USER="${RABBITMQ_USER:-softmusic}"

JWT_ALGORITHM="${JWT_ALGORITHM:-HS256}"
JWT_ACCESS_EXPIRES_IN="${JWT_ACCESS_EXPIRES_IN:-15m}"
JWT_REFRESH_EXPIRES_IN="${JWT_REFRESH_EXPIRES_IN:-7d}"
ADMIN_JWT_PRIVATE_KEY="${ADMIN_JWT_PRIVATE_KEY:-${JWT_PRIVATE_KEY}}"
ADMIN_BOOTSTRAP_EMAIL="${ADMIN_BOOTSTRAP_EMAIL:-admin@softmusic.com.br}"
ADMIN_BOOTSTRAP_PASSWORD="${ADMIN_BOOTSTRAP_PASSWORD:-}"
ADMIN_BOOTSTRAP_NAME="${ADMIN_BOOTSTRAP_NAME:-Administrador}"

ASAAS_API_KEY="${ASAAS_API_KEY:-}"
ASAAS_ENVIRONMENT="${ASAAS_ENVIRONMENT:-production}"
ASAAS_WEBHOOK_TOKEN="${ASAAS_WEBHOOK_TOKEN:-}"

SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"
RESEND_API_KEY="${RESEND_API_KEY:-}"
EMAIL_FROM="${EMAIL_FROM:-noreply@softmusic.com.br}"

GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-https://grafana.softmusic.com.br}"

CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-1}"
CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
USE_GPU="${USE_GPU:-1}"
DEMUCS_ENABLED="${DEMUCS_ENABLED:-true}"
DEMUCS_MODEL="${DEMUCS_MODEL:-htdemucs_6s}"

# --- Object storage (Cloudflare R2 / S3) — opcional -------------------------
# S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY chegam como Secret text (opcionais).
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
S3_REGION="${S3_REGION:-auto}"
S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}"
S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}"
STORAGE_BUCKET="${STORAGE_BUCKET:-softmusic}"
STORAGE_PREFIX="${STORAGE_PREFIX:-}"
STORAGE_PRESIGN_EXPIRES="${STORAGE_PRESIGN_EXPIRES:-3600}"
STORAGE_DELETE_LOCAL_AFTER_UPLOAD="${STORAGE_DELETE_LOCAL_AFTER_UPLOAD:-true}"
# Liga o R2 automaticamente quando as credenciais + endpoint estão presentes.
if [[ -n "${S3_ACCESS_KEY_ID}" && -n "${S3_ENDPOINT_URL}" ]]; then
  STORAGE_PROVIDER="${STORAGE_PROVIDER:-s3}"
else
  STORAGE_PROVIDER="${STORAGE_PROVIDER:-local}"
fi

# Imagens locais (build no daemon do host, sem registry). Cada job também marca
# a imagem como :latest; o .env referencia :latest (existe sempre, e o
# --force-recreate no deploy garante que o container use a imagem recém-buildada).
# IMAGE_TAG (BUILD_NUMBER) fica registrado apenas para rastreio.
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_PREFIX="${IMAGE_PREFIX:-softmusic}"
SOFTMUSIC_API_IMAGE="${SOFTMUSIC_API_IMAGE:-${IMAGE_PREFIX}/api:latest}"
SOFTMUSIC_PYTHON_AI_IMAGE="${SOFTMUSIC_PYTHON_AI_IMAGE:-${IMAGE_PREFIX}/python-ai:latest}"
SOFTMUSIC_WEB_IMAGE="${SOFTMUSIC_WEB_IMAGE:-${IMAGE_PREFIX}/web:latest}"
SOFTMUSIC_LP_IMAGE="${SOFTMUSIC_LP_IMAGE:-${IMAGE_PREFIX}/lp:latest}"
SOFTMUSIC_ADMIN_WEB_IMAGE="${SOFTMUSIC_ADMIN_WEB_IMAGE:-${IMAGE_PREFIX}/admin-web:latest}"

# --- URL-encode das senhas usadas em URLs de conexão ------------------------
urlenc() {
  local s="$1" out="" c hex i
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) printf -v hex '%%%02X' "'$c"; out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}

MYSQL_PASSWORD_ENC="$(urlenc "${MYSQL_PASSWORD}")"
REDIS_PASSWORD_ENC="$(urlenc "${REDIS_PASSWORD}")"
RABBITMQ_PASSWORD_ENC="$(urlenc "${RABBITMQ_PASSWORD}")"

DATABASE_URL="${DATABASE_URL:-mysql+aiomysql://${MYSQL_USER}:${MYSQL_PASSWORD_ENC}@mysql:3307/${MYSQL_DATABASE}}"
REDIS_URL="${REDIS_URL:-redis://:${REDIS_PASSWORD_ENC}@redis:6379/0}"
CELERY_BROKER_URL="${CELERY_BROKER_URL:-amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD_ENC}@rabbitmq:5672//}"
CELERY_RESULT_BACKEND="${CELERY_RESULT_BACKEND:-redis://:${REDIS_PASSWORD_ENC}@redis:6379/1}"

# --- Escreve o arquivo (permissão restrita) ---------------------------------
mkdir -p "$(dirname "${ENV_FILE}")"
umask 077
cat > "${ENV_FILE}" <<EOF
# Gerado por render-env.sh — NÃO commitar. $(date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_ENV=${NODE_ENV}
SOFTMUSIC_ENV=${SOFTMUSIC_ENV}
LOG_LEVEL=${LOG_LEVEL}

EDGE_PROXY=${EDGE_PROXY}
TRAEFIK_DOCKER_NETWORK=${TRAEFIK_DOCKER_NETWORK}

WEB_ORIGIN=${WEB_ORIGIN}
API_BASE_URL=${API_BASE_URL}
VITE_API_URL=${VITE_API_URL}
VITE_APP_URL=${VITE_APP_URL}
LP_ORIGIN=${LP_ORIGIN}
ADMIN_ORIGIN=${ADMIN_ORIGIN}
VITE_ADMIN_API_URL=${VITE_ADMIN_API_URL}

MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
DATABASE_URL=${DATABASE_URL}

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=${REDIS_URL}
RABBITMQ_USER=${RABBITMQ_USER}
RABBITMQ_PASSWORD=${RABBITMQ_PASSWORD}
CELERY_BROKER_URL=${CELERY_BROKER_URL}
CELERY_RESULT_BACKEND=${CELERY_RESULT_BACKEND}

JWT_ALGORITHM=${JWT_ALGORITHM}
JWT_PRIVATE_KEY=${JWT_PRIVATE_KEY}
JWT_ACCESS_EXPIRES_IN=${JWT_ACCESS_EXPIRES_IN}
JWT_REFRESH_EXPIRES_IN=${JWT_REFRESH_EXPIRES_IN}
ADMIN_JWT_PRIVATE_KEY=${ADMIN_JWT_PRIVATE_KEY}
ADMIN_BOOTSTRAP_EMAIL=${ADMIN_BOOTSTRAP_EMAIL}
ADMIN_BOOTSTRAP_PASSWORD=${ADMIN_BOOTSTRAP_PASSWORD}
ADMIN_BOOTSTRAP_NAME=${ADMIN_BOOTSTRAP_NAME}

ASAAS_API_KEY=${ASAAS_API_KEY}
ASAAS_ENVIRONMENT=${ASAAS_ENVIRONMENT}
ASAAS_WEBHOOK_TOKEN=${ASAAS_WEBHOOK_TOKEN}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
RESEND_API_KEY=${RESEND_API_KEY}
EMAIL_FROM=${EMAIL_FROM}

GRAFANA_ADMIN_USER=${GRAFANA_ADMIN_USER}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
GRAFANA_ROOT_URL=${GRAFANA_ROOT_URL}

CELERY_CONCURRENCY=${CELERY_CONCURRENCY}
CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}
USE_GPU=${USE_GPU}
DEMUCS_ENABLED=${DEMUCS_ENABLED}
DEMUCS_MODEL=${DEMUCS_MODEL}

STORAGE_PROVIDER=${STORAGE_PROVIDER}
STORAGE_BUCKET=${STORAGE_BUCKET}
STORAGE_PREFIX=${STORAGE_PREFIX}
STORAGE_PRESIGN_EXPIRES=${STORAGE_PRESIGN_EXPIRES}
STORAGE_DELETE_LOCAL_AFTER_UPLOAD=${STORAGE_DELETE_LOCAL_AFTER_UPLOAD}
S3_ENDPOINT_URL=${S3_ENDPOINT_URL}
S3_REGION=${S3_REGION}
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}

IMAGE_TAG=${IMAGE_TAG}
SOFTMUSIC_API_IMAGE=${SOFTMUSIC_API_IMAGE}
SOFTMUSIC_PYTHON_AI_IMAGE=${SOFTMUSIC_PYTHON_AI_IMAGE}
SOFTMUSIC_WEB_IMAGE=${SOFTMUSIC_WEB_IMAGE}
SOFTMUSIC_LP_IMAGE=${SOFTMUSIC_LP_IMAGE}
SOFTMUSIC_ADMIN_WEB_IMAGE=${SOFTMUSIC_ADMIN_WEB_IMAGE}
EOF

chmod 600 "${ENV_FILE}"
echo ">> .env de produção gerado em ${ENV_FILE}"
