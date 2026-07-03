# Monitoramento e observabilidade

Stack de observabilidade do SoftMusic: métricas (Prometheus), visualização (Grafana), logs (Loki) e traces (OpenTelemetry).

## Arquitetura

```
Apps (API, Python AI, Workers)
    │
    ├── /metrics ──────────► Prometheus
    ├── stdout JSON ───────► Promtail ──► Loki
    └── OTLP gRPC/HTTP ──► OTel Collector ──► Tempo/Jaeger (traces)
                                                    │
Grafana ◄── datasources: Prometheus, Loki, Tempo
```

Arquivos de configuração em `infra/monitoring/`.

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

Dashboards pré-configurados em `infra/monitoring/grafana/dashboards/`:

- **SoftMusic Overview** — RPS, latência p50/p95/p99, taxa de erro
- **Analysis Pipeline** — jobs enfileirados, tempo por estágio, falhas por modelo
- **Infrastructure** — CPU/memória por pod, conexões MySQL, Redis hit rate
- **Celery Workers** — throughput, task duration, retries

## Métricas expostas

### API (BFF)

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `http_requests_total` | Counter | Total de requisições por método, rota, status |
| `http_request_duration_seconds` | Histogram | Latência HTTP |
| `auth_token_validations_total` | Counter | Validações JWT |
| `rate_limit_exceeded_total` | Counter | Requisições bloqueadas por rate limit |
| `analysis_jobs_created_total` | Counter | Jobs de análise criados |

Endpoint: `GET /metrics` (protegido em produção via network policy).

### Python AI

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `analysis_pipeline_stage_duration_seconds` | Histogram | Duração por estágio (normalize, demucs, harmony, etc.) |
| `analysis_pipeline_failures_total` | Counter | Falhas por estágio e tipo de erro |
| `model_inference_duration_seconds` | Histogram | Tempo de inferência por modelo |
| `active_analysis_jobs` | Gauge | Jobs em processamento |

### Celery Workers

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `celery_tasks_total` | Counter | Tasks por nome e estado |
| `celery_task_duration_seconds` | Histogram | Duração de tasks |
| `celery_queue_length` | Gauge | Tamanho da fila `analysis` |

## Logs estruturados

Todos os serviços emitem JSON para stdout:

```json
{
  "timestamp": "2026-07-02T14:30:00.000Z",
  "level": "info",
  "service": "softmusic-api",
  "trace_id": "abc123def456",
  "span_id": "789ghi",
  "message": "Analysis job created",
  "job_id": "job_01HXYZ",
  "user_id": "usr_01HABC",
  "source_type": "upload"
}
```

Campos obrigatórios: `timestamp`, `level`, `service`, `message`.

Campos de correlação: `trace_id`, `span_id`, `job_id`, `song_id`, `user_id`.

### Consultas LogQL (Loki)

```logql
# Erros nos últimos 15 minutos
{service=~"softmusic-.*"} |= "error" | json | level="error"

# Pipeline lento (> 5 min)
{service="softmusic-worker"} | json | message="Pipeline completed" | duration > 300

# Falhas Demucs
{service="softmusic-python-ai"} | json | stage="demucs" | level="error"
```

## Traces (OpenTelemetry)

Instrumentação automática em:

- HTTP handlers (FastAPI, React Router)
- Chamadas entre API ↔ Python AI
- Tasks Celery (propagação de contexto)
- Queries SQLAlchemy
- Operações de object storage

Configuração:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
OTEL_SERVICE_NAME=softmusic-api
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

Em produção, sample rate de 10% reduz custo; aumente para 100% em staging.

## Alertas recomendados

Definidos em `infra/monitoring/prometheus/alerts.yml`:

| Alerta | Condição | Severidade | Ação |
|--------|----------|------------|------|
| `HighErrorRate` | 5xx > 1% por 5 min | critical | PagerDuty |
| `AnalysisQueueBacklog` | Fila `analysis` > 100 por 10 min | warning | Scale workers |
| `AnalysisPipelineFailure` | Falhas > 5/min por 5 min | critical | Investigar logs |
| `MySQLConnectionsHigh` | Conexões > 80% pool | warning | Verificar leaks |
| `RedisDown` | Redis unreachable 1 min | critical | Failover Sentinel |
| `PodCrashLooping` | Restarts > 3 em 10 min | critical | kubectl describe |
| `DiskSpaceLow` | < 15% livre | warning | Expandir volume |

### Exemplo de alerta Prometheus

```yaml
groups:
  - name: softmusic
    rules:
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Taxa de erro HTTP acima de 1%"
          description: "{{ $value | humanizePercentage }} de requisições retornando 5xx"

      - alert: AnalysisQueueBacklog
        expr: celery_queue_length{queue="analysis"} > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Fila de análise com backlog"
          description: "{{ $value }} jobs aguardando processamento"
```

## Health checks

| Endpoint | Tipo | Uso |
|----------|------|-----|
| `GET /health/live` | Liveness | Processo vivo (sem deps) |
| `GET /health/ready` | Readiness | MySQL, Redis, RabbitMQ, Python AI |
| `GET /health` | Aggregated | Status completo + versão |

Kubernetes probes:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```

## SLOs sugeridos

| SLI | SLO | Janela |
|-----|-----|--------|
| Disponibilidade API | 99.9% | 30 dias |
| Latência p95 `GET /songs/{id}/analysis` | < 200 ms (cache hit) | 7 dias |
| Latência p95 pipeline completo | < 8 min (música 4 min) | 7 dias |
| Taxa de sucesso de análise | > 98% | 7 dias |

Error budget: quando SLO de disponibilidade cai abaixo de 99.9%, congelar deploys de feature até recuperação.

## Runbook: pipeline travado

1. Verificar fila RabbitMQ: http://localhost:15672 → queue `analysis`
2. Logs do worker: `kubectl logs -l app=softmusic-worker --tail=200`
3. Métrica `analysis_pipeline_failures_total` no Grafana
4. Se OOM: escalar memória do worker ou reduzir `CELERY_CONCURRENCY`
5. Reprocessar jobs failed: `celery -A app.worker call app.tasks.retry_failed --args='["job_id"]'`
6. DLQ: jobs após 3 retries vão para fila `analysis.dlq` — investigar manualmente

## Runbook: latência alta na API

1. Dashboard **SoftMusic Overview** → latência p95 por rota
2. Verificar Redis hit rate (cache de análises)
3. Traces: identificar span lento (DB vs Python AI)
4. MySQL: `SHOW PROCESSLIST`, slow query log
5. Escalar replicas API via HPA se CPU > 70%
