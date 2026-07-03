# Variáveis de ambiente

Referência completa de configuração por serviço. Copie `infra/docker/.env.example` como base.

## Convenções

- Valores sensíveis: prefixo `SECRET_` ou armazenados em secret manager
- URLs: incluir schema (`mysql+aiomysql://`, `redis://`, `amqp://`)
- Produção: nunca use valores padrão de desenvolvimento
- Booleanos: `true` / `false` (lowercase)

---

## Global

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `NODE_ENV` | Sim | `development` | `development`, `staging`, `production` |
| `SOFTMUSIC_ENV` | Sim | `local` | Identificador do ambiente |
| `LOG_LEVEL` | Não | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | Não | `json` | `json` ou `pretty` (somente dev) |
| `TZ` | Não | `UTC` | Timezone dos containers |

---

## API (BFF) — `apps/api`

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `API_HOST` | Não | `0.0.0.0` | Bind address |
| `API_PORT` | Não | `8080` | Porta HTTP |
| `API_BASE_URL` | Sim (prod) | `http://localhost:8080` | URL pública da API |
| `WEB_ORIGIN` | Sim | `http://localhost:5173` | CORS allowed origin |
| `DATABASE_URL` | Sim | — | MySQL connection string |
| `REDIS_URL` | Sim | — | Redis para cache, rate limit, sessões |
| `PYTHON_AI_URL` | Sim | `http://python-ai:8000` | URL interna do serviço de IA |
| `JWT_ALGORITHM` | Sim | `RS256` | `RS256` (prod) ou `HS256` (dev only) |
| `JWT_PRIVATE_KEY` | Sim | — | Chave privada PEM (RS256) ou secret (HS256) |
| `JWT_PUBLIC_KEY` | Sim (RS256) | — | Chave pública PEM |
| `JWT_ACCESS_EXPIRES_IN` | Não | `15m` | TTL do access token |
| `JWT_REFRESH_EXPIRES_IN` | Não | `7d` | TTL do refresh token |
| `RATE_LIMIT_WINDOW_MS` | Não | `60000` | Janela de rate limit |
| `RATE_LIMIT_MAX_REQUESTS` | Não | `100` | Requisições por janela (plano free) |
| `UPLOAD_MAX_SIZE_MB` | Não | `100` | Tamanho máximo de upload |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Não | — | Endpoint OpenTelemetry |
| `OTEL_SERVICE_NAME` | Não | `softmusic-api` | Nome do serviço em traces |

---

## Python AI — `apps/python-ai`

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `PYTHON_AI_HOST` | Não | `0.0.0.0` | Bind address |
| `PYTHON_AI_PORT` | Não | `8000` | Porta HTTP |
| `DATABASE_URL` | Sim | — | MySQL (SQLAlchemy async) |
| `REDIS_URL` | Sim | — | Cache de resultados e locks |
| `CELERY_BROKER_URL` | Sim | — | RabbitMQ AMQP URL |
| `CELERY_RESULT_BACKEND` | Sim | — | Redis URL para resultados Celery |
| `CELERY_CONCURRENCY` | Não | `2` | Workers Celery por processo |
| `CELERY_TASK_SOFT_TIME_LIMIT` | Não | `3600` | Soft limit em segundos |
| `CELERY_TASK_TIME_LIMIT` | Não | `3900` | Hard limit em segundos |
| `STORAGE_PROVIDER` | Sim | `local` | `local`, `s3`, `gcs`, `azure` |
| `STORAGE_BUCKET` | Sim (cloud) | `softmusic-uploads` | Nome do bucket |
| `STORAGE_REGION` | Sim (S3) | — | Região AWS/GCP |
| `STORAGE_ENDPOINT` | Não | — | Endpoint custom (R2, MinIO) |
| `STORAGE_ACCESS_KEY` | Sim (cloud) | — | Access key |
| `STORAGE_SECRET_KEY` | Sim (cloud) | — | Secret key |
| `STORAGE_PUBLIC_URL` | Não | — | CDN base URL para assets |
| `MODELS_CACHE_DIR` | Não | `/models` | Cache local de modelos |
| `DEMUCS_MODEL` | Não | `htdemucs` | Modelo Demucs v4 |
| `WHISPER_MODEL` | Não | `large-v3` | Modelo Whisper (lyrics only) |
| `CUDA_VISIBLE_DEVICES` | Não | — | GPUs disponíveis (`0`, `0,1`, vazio=CPU) |
| `ANALYSIS_JSON_VERSION` | Não | `1.0.0` | Versão do schema de saída |
| `OTEL_SERVICE_NAME` | Não | `softmusic-python-ai` | Nome em traces |

---

## Web — `apps/web`

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `VITE_API_URL` | Sim | `http://localhost:8080` | URL da API (build-time) |
| `VITE_APP_NAME` | Não | `SoftMusic` | Nome exibido |
| `VITE_PWA_ENABLED` | Não | `true` | Habilita PWA |
| `VITE_VAPID_PUBLIC_KEY` | Sim (push) | — | Chave pública Web Push |

---

## MySQL

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `MYSQL_ROOT_PASSWORD` | Sim | — | Senha root |
| `MYSQL_DATABASE` | Sim | `softmusic` | Nome do database |
| `MYSQL_USER` | Sim | `softmusic` | Usuário da aplicação |
| `MYSQL_PASSWORD` | Sim | — | Senha da aplicação |
| `MYSQL_PORT` | Não | `3306` | Porta exposta (dev only) |

---

## Redis

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `REDIS_PASSWORD` | Sim (prod) | — | Senha Redis |
| `REDIS_PORT` | Não | `6379` | Porta exposta (dev only) |

---

## RabbitMQ

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `RABBITMQ_USER` | Sim | `softmusic` | Usuário AMQP |
| `RABBITMQ_PASSWORD` | Sim | — | Senha AMQP |
| `RABBITMQ_PORT` | Não | `5672` | Porta AMQP |
| `RABBITMQ_MANAGEMENT_PORT` | Não | `15672` | UI de management |

---

## Observabilidade

| Variável | Obrigatória | Padrão (dev) | Descrição |
|----------|-------------|--------------|-----------|
| `GRAFANA_ADMIN_USER` | Não | `admin` | Usuário admin Grafana |
| `GRAFANA_ADMIN_PASSWORD` | Sim | — | Senha admin Grafana |
| `PROMETHEUS_PORT` | Não | `9090` | Porta Prometheus |
| `GRAFANA_PORT` | Não | `3000` | Porta Grafana |
| `LOKI_URL` | Não | `http://loki:3100` | URL interna Loki |

---

## Exemplo `.env` de desenvolvimento

```env
# Global
NODE_ENV=development
SOFTMUSIC_ENV=local
LOG_LEVEL=debug

# MySQL
MYSQL_ROOT_PASSWORD=root_dev_only
MYSQL_DATABASE=softmusic
MYSQL_USER=softmusic
MYSQL_PASSWORD=softmusic_dev
MYSQL_PORT=3306

# Redis
REDIS_PASSWORD=
REDIS_PORT=6379

# RabbitMQ
RABBITMQ_USER=softmusic
RABBITMQ_PASSWORD=softmusic_dev
RABBITMQ_PORT=5672
RABBITMQ_MANAGEMENT_PORT=15672

# Connection strings (apps)
DATABASE_URL=mysql+aiomysql://softmusic:softmusic_dev@mysql:3306/softmusic
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=amqp://softmusic:softmusic_dev@rabbitmq:5672//
CELERY_RESULT_BACKEND=redis://redis:6379/1

# API
API_PORT=8080
API_BASE_URL=http://localhost:8080
WEB_ORIGIN=http://localhost:5173
PYTHON_AI_URL=http://python-ai:8000
JWT_ALGORITHM=HS256
JWT_PRIVATE_KEY=dev-only-change-in-production-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Python AI
PYTHON_AI_PORT=8000
STORAGE_PROVIDER=local
STORAGE_BUCKET=softmusic-uploads
MODELS_CACHE_DIR=/models
CELERY_CONCURRENCY=2
ANALYSIS_JSON_VERSION=1.0.0

# Web
VITE_API_URL=http://localhost:8080
VITE_PWA_ENABLED=true

# Observability
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin_dev_only
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
```

## Exemplo overrides de produção

```env
NODE_ENV=production
SOFTMUSIC_ENV=production
LOG_LEVEL=info
LOG_FORMAT=json

JWT_ALGORITHM=RS256
# JWT_PRIVATE_KEY e JWT_PUBLIC_KEY via secret manager

STORAGE_PROVIDER=s3
STORAGE_BUCKET=softmusic-prod
STORAGE_REGION=us-east-1

REDIS_PASSWORD=<strong-password>
MYSQL_ROOT_PASSWORD=<strong-password>
MYSQL_PASSWORD=<strong-password>
RABBITMQ_PASSWORD=<strong-password>

CELERY_CONCURRENCY=4
RATE_LIMIT_MAX_REQUESTS=60

OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.softmusic.internal:4317
```
