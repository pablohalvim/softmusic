# Monitoramento e observabilidade

Stack de observabilidade do SoftMusic: métricas (Prometheus), visualização (Grafana), logs (Loki) e coletor OTel.

## Arquitetura

```
Apps (API, Python AI)
    │
    ├── /metrics ──────────► Prometheus
    ├── stdout ────────────► Promtail ──► Loki
    └── OTLP gRPC/HTTP ──► OTel Collector (metrics→:8889; traces→logging)

Grafana ◄── datasources: Prometheus, Loki
         ◄── dashboards: infra/monitoring/grafana/dashboards/
```

Arquivos em `infra/monitoring/`. O job **`softmusic-infra`** (`deploy-infra.sh`) copia essa pasta para o deploy dir e sobe o profile `observability` — datasources e dashboards entram sozinhos no Grafana (file provisioning). Não é preciso configurar nada na UI.

## Ativar localmente

```bash
docker compose -f infra/docker/docker-compose.yml \
  --profile infra --profile app --profile observability \
  up -d
```

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| Grafana | http://localhost:3000 | Ver `.env` |
| Prometheus | http://localhost:9090 | — |
| RabbitMQ Management | http://localhost:15672 | Ver `.env` |

### Dashboards provisionados

Pasta Grafana **SoftMusic** (JSONs em `infra/monitoring/grafana/dashboards/`):

| Dashboard | UID | Conteúdo |
|-----------|-----|----------|
| SoftMusic Overview | `softmusic-overview` | Targets UP/DOWN, CPU/RSS, event loop lag (API) |
| SoftMusic Logs | `softmusic-logs` | Volume + stream Loki (`service=~softmusic-.*`) |
| SoftMusic Prometheus Targets | `softmusic-targets` | Tabela `up` + scrape duration/samples |

Para alterar: edite o JSON no repo e re-rode `softmusic-infra` (ou reinicie o Grafana). O provider recarrega a cada 30s.

## Métricas expostas (hoje)

Scrapes em `infra/monitoring/prometheus/prometheus.yml`: `api:8080/metrics`, `python-ai:8000/metrics`, `rabbitmq:15692`, Prometheus self.

### API (BFF) e Python AI

Ambos expõem **métricas default** do runtime (`prom-client` / `prometheus_client`):

| Família | Exemplos |
|---------|----------|
| Processo | `process_cpu_seconds_total`, `process_resident_memory_bytes` |
| Node (API) | `nodejs_eventloop_lag_seconds`, `nodejs_heap_size_*` |
| Python (IA) | `python_info`, GC collectors |

Endpoint: `GET /metrics`.

### Métricas de negócio (planejadas)

Ainda **não instrumentadas** — alertas em `alerts.yml` que dependem delas ficam sem série até existir o exporter:

| Métrica | Uso previsto |
|---------|--------------|
| `http_requests_total` / `http_request_duration_seconds` | RPS, latência, 5xx |
| `analysis_pipeline_*` / `model_inference_*` | Pipeline Demucs/harmony |
| `celery_tasks_*` / `celery_queue_length` | Workers / backlog |

## Logs

Promtail coleta só containers `/softmusic-.*` e etiqueta `service=softmusic-<nome>`.

### Consultas LogQL (Loki)

```logql
# Tudo SoftMusic
{service=~"softmusic-.*"}

# Erros (texto)
{service=~"softmusic-.*"} |= "error"

# Só API
{service="softmusic-api"}
```

## Traces (OpenTelemetry)

O collector recebe OTLP (`4317`/`4318`). Hoje traces vão para o exporter **logging** (sem Tempo/Jaeger no compose). Datasource de traces no Grafana ainda não está provisionado.

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_SERVICE_NAME=softmusic-api
```

## Alertas (Prometheus)

Definidos em `infra/monitoring/prometheus/alerts.yml` (ativos de verdade hoje):

| Alerta | Condição | Severidade | Nota |
|--------|----------|------------|------|
| `ServiceDown` | `up == 0` por 2 min | critical | Funciona com scrapes atuais |
| `HighErrorRate` | 5xx > 1% por 5 min | critical | Precisa de `http_requests_total` |
| `AnalysisQueueBacklog` | fila `analysis` > 100 por 10 min | warning | Precisa de `celery_queue_length` |

## Health checks

| Endpoint | Tipo | Uso |
|----------|------|-----|
| `GET /health/live` | Liveness | Processo vivo (sem deps) — usado no Docker healthcheck do python-ai |
| `GET /health` | Readiness | DB (+ GPU best-effort no python-ai) |

## Runbook rápido

1. Grafana → **SoftMusic Prometheus Targets**: algum `DOWN`?
2. Grafana → **SoftMusic Logs**: filtrar o serviço e procurar `error`.
3. Fila RabbitMQ: management UI → queue `analysis`.
4. Logs do container: `docker logs softmusic-python-ai --tail 200` (ou worker/api).
