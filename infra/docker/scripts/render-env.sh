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

# Se o .env já existe (ex.: job de app após softmusic-infra), reaproveita
# INSTALL_MYSQL / MYSQL_* quando o job atual não os passou explicitamente.
# Assim api/ia/web não sobrescrevem um banco externo configurado na infra.
if [[ -f "${ENV_FILE}" ]]; then
  _load_env_default() {
    local key="$1"
    local current="${!key:-}"
    if [[ -n "${current}" ]]; then
      return 0
    fi
    local value
    value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true)"
    if [[ -n "${value}" ]]; then
      printf -v "${key}" '%s' "${value}"
      export "${key}"
    fi
  }
  _load_env_default INSTALL_MYSQL
  _load_env_default MYSQL_HOST
  _load_env_default MYSQL_PORT
  _load_env_default MYSQL_SSL
  _load_env_default MYSQL_DATABASE
  _load_env_default MYSQL_USER
fi

# --- MySQL: local (Docker) vs externo (DigitalOcean etc.) -------------------
# INSTALL_MYSQL=1 (padrão) → sobe softmusic-mysql e aponta DATABASE_URL para ele.
# INSTALL_MYSQL=0 → não instala MySQL; use MYSQL_HOST / MYSQL_PORT externos.
INSTALL_MYSQL="${INSTALL_MYSQL:-1}"
MYSQL_DATABASE="${MYSQL_DATABASE:-softmusic}"
MYSQL_USER="${MYSQL_USER:-softmusic}"

# Host claramente externo (DigitalOcean, IP, FQDN) → força banco externo.
# Evita o caso "INSTALL_MYSQL=1 + host DO" que sobe MariaDB local à toa.
if [[ -n "${MYSQL_HOST:-}" && "${MYSQL_HOST}" != "mysql" && "${MYSQL_HOST}" != "localhost" && "${MYSQL_HOST}" != "127.0.0.1" ]]; then
  if [[ "${INSTALL_MYSQL}" != "0" ]]; then
    echo ">> AVISO: MYSQL_HOST=${MYSQL_HOST} não é o container local — forçando INSTALL_MYSQL=0 (banco externo)."
  fi
  INSTALL_MYSQL=0
fi

if [[ "${INSTALL_MYSQL}" == "0" ]]; then
  MYSQL_HOST="${MYSQL_HOST:-}"
  MYSQL_PORT="${MYSQL_PORT:-25060}"
  if [[ -z "${MYSQL_HOST}" || "${MYSQL_HOST}" == "mysql" ]]; then
    echo "ERRO: com INSTALL_MYSQL=0 defina MYSQL_HOST (host externo do banco)." >&2
    echo "      Ex.: db-mysql-nyc3-xxxxx.db.ondigitalocean.com" >&2
    exit 1
  fi
  # SSL: DigitalOcean Managed MySQL exige TLS. auto → liga em banco externo.
  MYSQL_SSL="${MYSQL_SSL:-auto}"
  if [[ "${MYSQL_SSL}" == "auto" ]]; then
    MYSQL_SSL=1
  fi
  # Root só é usado pelo container local; em externo pode ficar vazio.
  MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-unused-external-mysql}"
else
  MYSQL_HOST="${MYSQL_HOST:-mysql}"
  MYSQL_PORT="${MYSQL_PORT:-3307}"
  MYSQL_SSL="${MYSQL_SSL:-auto}"
  if [[ "${MYSQL_SSL}" == "auto" ]]; then
    MYSQL_SSL=0
  fi
fi

# --- Segredos obrigatórios (Secret text) ------------------------------------
required_secrets=(
  MYSQL_PASSWORD
  REDIS_PASSWORD
  RABBITMQ_PASSWORD
  JWT_PRIVATE_KEY
  GRAFANA_ADMIN_PASSWORD
)
if [[ "${INSTALL_MYSQL}" != "0" ]]; then
  required_secrets+=(MYSQL_ROOT_PASSWORD)
fi
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

LP_PORT="${LP_PORT:-4100}"
WEB_PORT="${WEB_PORT:-4101}"
ADMIN_PORT="${ADMIN_PORT:-4102}"
API_PORT="${API_PORT:-8081}"
GRAFANA_PORT="${GRAFANA_PORT:-4103}"

WEB_ORIGIN="${WEB_ORIGIN:-https://app.softmusic.com.br}"
API_BASE_URL="${API_BASE_URL:-https://app.softmusic.com.br/api}"
VITE_API_URL="${VITE_API_URL:-https://app.softmusic.com.br/api}"
VITE_APP_URL="${VITE_APP_URL:-https://app.softmusic.com.br}"
VITE_GOOGLE_MAPS_API_KEY="${VITE_GOOGLE_MAPS_API_KEY:-}"
LP_ORIGIN="${LP_ORIGIN:-https://softmusic.com.br}"
ADMIN_ORIGIN="${ADMIN_ORIGIN:-https://admin.softmusic.com.br}"
VITE_ADMIN_API_URL="${VITE_ADMIN_API_URL:-${ADMIN_ORIGIN}/api}"

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
# Host + URL pública — evita "origin not allowed" (CSRF) atrás do reverse proxy.
if [[ -z "${GRAFANA_CSRF_TRUSTED_ORIGINS:-}" ]]; then
  _gf_host="${GRAFANA_ROOT_URL#*://}"
  _gf_host="${_gf_host%%/*}"
  GRAFANA_CSRF_TRUSTED_ORIGINS="${_gf_host},${GRAFANA_ROOT_URL}"
fi
GRAFANA_CSRF_ADDITIONAL_HEADERS="${GRAFANA_CSRF_ADDITIONAL_HEADERS:-X-Forwarded-Host}"

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

# Flag consumida pelo python-ai (prepare_database_url → connect_args SSL).
# Não use connect_args cru no PyMySQL: ?ssl=true como string quebra (_create_ssl_ctx).
DATABASE_SSL_QUERY=""
if [[ "${MYSQL_SSL}" == "1" || "${MYSQL_SSL}" == "true" ]]; then
  DATABASE_SSL_QUERY="?ssl=true"
fi

DATABASE_URL="${DATABASE_URL:-mysql+aiomysql://${MYSQL_USER}:${MYSQL_PASSWORD_ENC}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}${DATABASE_SSL_QUERY}}"
REDIS_URL="${REDIS_URL:-redis://:${REDIS_PASSWORD_ENC}@redis:6379/0}"
CELERY_BROKER_URL="${CELERY_BROKER_URL:-amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD_ENC}@rabbitmq:5672//}"
CELERY_RESULT_BACKEND="${CELERY_RESULT_BACKEND:-redis://:${REDIS_PASSWORD_ENC}@redis:6379/1}"

if [[ "${INSTALL_MYSQL}" == "0" ]]; then
  echo ">> MySQL: EXTERNO → ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE} (ssl=${MYSQL_SSL})"
else
  echo ">> MySQL: LOCAL (container) → ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"
fi

# --- Escreve o arquivo (permissão restrita) ---------------------------------
mkdir -p "$(dirname "${ENV_FILE}")"
umask 077
cat > "${ENV_FILE}" <<EOF
# Gerado por render-env.sh — NÃO commitar. $(date -u +%Y-%m-%dT%H:%M:%SZ)
NODE_ENV=${NODE_ENV}
SOFTMUSIC_ENV=${SOFTMUSIC_ENV}
LOG_LEVEL=${LOG_LEVEL}

LP_PORT=${LP_PORT}
WEB_PORT=${WEB_PORT}
ADMIN_PORT=${ADMIN_PORT}
API_PORT=${API_PORT}
GRAFANA_PORT=${GRAFANA_PORT}

WEB_ORIGIN=${WEB_ORIGIN}
API_BASE_URL=${API_BASE_URL}
VITE_API_URL=${VITE_API_URL}
VITE_APP_URL=${VITE_APP_URL}
VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}
LP_ORIGIN=${LP_ORIGIN}
ADMIN_ORIGIN=${ADMIN_ORIGIN}
VITE_ADMIN_API_URL=${VITE_ADMIN_API_URL}

INSTALL_MYSQL=${INSTALL_MYSQL}
MYSQL_HOST=${MYSQL_HOST}
MYSQL_PORT=${MYSQL_PORT}
MYSQL_SSL=${MYSQL_SSL}
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
GRAFANA_CSRF_TRUSTED_ORIGINS=${GRAFANA_CSRF_TRUSTED_ORIGINS}
GRAFANA_CSRF_ADDITIONAL_HEADERS=${GRAFANA_CSRF_ADDITIONAL_HEADERS}

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
