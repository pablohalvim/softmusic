# Deploy em produção

Guia para implantar o SoftMusic em ambiente de produção com alta disponibilidade, segurança e observabilidade.

## Visão geral

```mermaid
flowchart LR
    CDN[CDN / Cloudflare] --> LB[Load Balancer]
    LB --> NGINX[NGINX Ingress]
    NGINX --> WEB[Web Pods]
    NGINX --> API[API Pods]
    API --> AI[Python AI Pods]
    AI --> WRK[Celery Workers]
    WRK --> RMQ[RabbitMQ Cluster]
    API --> MYSQL[(MySQL Primary + Replicas)]
    API --> REDIS[(Redis Sentinel)]
    WRK --> OBJ[Object Storage S3/R2/GCS]
```

## Pré-requisitos de infraestrutura

| Componente | Requisito mínimo (produção) |
|------------|----------------------------|
| Kubernetes | 1.28+ (EKS, GKE, AKS ou self-hosted) |
| Nodes worker | 3+ (anti-affinity por AZ) |
| CPU total | 16 vCPU (escala com fila de análise) |
| RAM total | 64 GB (workers de IA) |
| GPU (opcional) | NVIDIA T4/A10 por worker Demucs |
| Object Storage | S3, R2, Azure Blob ou GCS |
| TLS | Cert-manager + Let's Encrypt ou ACM |
| DNS | Registro apontando para LB/Ingress |

## 1. Preparar secrets

Nunca commite secrets. Use um secret manager:

- **AWS:** Secrets Manager + External Secrets Operator
- **GCP:** Secret Manager
- **Azure:** Key Vault
- **Cloudflare:** Secrets Store (Workers) ou Vault

Secrets obrigatórios:

```bash
# Gerar chaves JWT (RS256 recomendado em produção)
openssl genrsa -out jwt-private.pem 4096
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem

# Criar secrets no cluster
kubectl create namespace softmusic

kubectl -n softmusic create secret generic softmusic-secrets \
  --from-literal=DATABASE_URL='mysql+aiomysql://user:pass@mysql-primary:3306/softmusic' \
  --from-literal=REDIS_URL='redis://redis-sentinel:26379/0' \
  --from-literal=CELERY_BROKER_URL='amqp://user:pass@rabbitmq:5672//' \
  --from-literal=JWT_PRIVATE_KEY="$(cat jwt-private.pem)" \
  --from-literal=JWT_PUBLIC_KEY="$(cat jwt-public.pem)" \
  --from-literal=STORAGE_ACCESS_KEY='...' \
  --from-literal=STORAGE_SECRET_KEY='...'
```

Consulte [Variáveis de ambiente](./variaveis-ambiente.md) para a lista completa.

## 2. Object Storage

Configure um bucket dedicado com lifecycle policy:

```json
{
  "Rules": [
    {
      "ID": "ExpireTempUploads",
      "Prefix": "uploads/tmp/",
      "Status": "Enabled",
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "TransitionStems",
      "Prefix": "stems/",
      "Status": "Enabled",
      "Transitions": [{ "Days": 90, "StorageClass": "STANDARD_IA" }]
    }
  ]
}
```

Variáveis:

```env
STORAGE_PROVIDER=s3
STORAGE_BUCKET=softmusic-prod
STORAGE_REGION=us-east-1
STORAGE_ENDPOINT=          # vazio para AWS; preencher para R2/MinIO
STORAGE_PUBLIC_URL=https://cdn.softmusic.app/assets
```

## 3. Banco de dados (MySQL 8)

### Configuração recomendada

- Primary + 2 read replicas
- `innodb_buffer_pool_size` = 70% RAM do node dedicado
- Backups automáticos (PITR) com retenção de 30 dias
- Conexões via pooler (ProxySQL ou RDS Proxy)

### Migrations em produção

```bash
# Job Kubernetes one-shot (idempotente)
kubectl -n softmusic apply -f infra/kubernetes/jobs/migrate.yaml
kubectl -n softmusic wait --for=condition=complete job/softmusic-migrate --timeout=300s
```

Nunca rode `alembic upgrade` manualmente em múltiplos pods simultaneamente.

## 4. Deploy com Kubernetes

### Estrutura de manifests

```
infra/kubernetes/
├── base/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── api/
│   ├── web/
│   ├── python-ai/
│   ├── worker/
│   ├── ingress.yaml
│   └── kustomization.yaml
├── overlays/
│   ├── staging/
│   └── production/
└── helm/
    └── softmusic/
```

### Staging

```bash
kubectl apply -k infra/kubernetes/overlays/staging
kubectl -n softmusic-staging rollout status deployment/softmusic-api
kubectl -n softmusic-staging rollout status deployment/softmusic-python-ai
```

### Production

```bash
# Validar manifests
kubectl kustomize infra/kubernetes/overlays/production | kubectl apply --dry-run=server -f -

# Deploy
kubectl apply -k infra/kubernetes/overlays/production

# Verificar rollouts
kubectl -n softmusic rollout status deployment/softmusic-api --timeout=600s
kubectl -n softmusic rollout status deployment/softmusic-web --timeout=300s
kubectl -n softmusic rollout status deployment/softmusic-worker --timeout=600s
```

### Autoscaling

| Deployment | HPA métrica | Min | Max |
|------------|-------------|-----|-----|
| `softmusic-api` | CPU 70%, RPS custom | 3 | 20 |
| `softmusic-web` | CPU 60% | 2 | 10 |
| `softmusic-python-ai` | CPU 75%, queue depth | 2 | 15 |
| `softmusic-worker` | RabbitMQ queue `analysis` | 2 | 30 |

Exemplo HPA por fila (KEDA):

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: softmusic-worker
  namespace: softmusic
spec:
  scaleTargetRef:
    name: softmusic-worker
  minReplicaCount: 2
  maxReplicaCount: 30
  triggers:
    - type: rabbitmq
      metadata:
        queueName: analysis
        mode: QueueLength
        value: "5"
        hostFromEnv: CELERY_BROKER_URL
```

## 5. NGINX Ingress e TLS

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: softmusic
  namespace: softmusic
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/proxy-body-size: "100m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.softmusic.app
        - app.softmusic.app
      secretName: softmusic-tls
  rules:
    - host: app.softmusic.app
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: softmusic-web
                port:
                  number: 80
    - host: api.softmusic.app
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: softmusic-api
                port:
                  number: 8080
```

Rate limiting adicional por plano de assinatura é aplicado no BFF via Redis.

## 6. CI/CD (GitHub Actions)

Pipeline em `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and push images
        run: |
          docker build -t ghcr.io/seu-org/softmusic-api:${{ github.ref_name }} -f infra/docker/Dockerfile.api .
          docker build -t ghcr.io/seu-org/softmusic-web:${{ github.ref_name }} -f infra/docker/Dockerfile.web .
          docker build -t ghcr.io/seu-org/softmusic-python-ai:${{ github.ref_name }} -f infra/docker/Dockerfile.python-ai .
          docker push --all-tags ghcr.io/seu-org/softmusic-api
          docker push --all-tags ghcr.io/seu-org/softmusic-web
          docker push --all-tags ghcr.io/seu-org/softmusic-python-ai

      - name: Deploy to production
        run: |
          kubectl set image deployment/softmusic-api api=ghcr.io/seu-org/softmusic-api:${{ github.ref_name }} -n softmusic
          kubectl rollout status deployment/softmusic-api -n softmusic
```

Versionamento: [Semantic Versioning](https://semver.org/) com [Conventional Commits](https://www.conventionalcommits.org/).

## 7. Docker Compose em produção (single-node)

Para VPS ou bare-metal sem Kubernetes:

```bash
cp infra/docker/.env.example infra/docker/.env.production
# Editar .env.production com valores de produção

docker compose -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production \
  --profile infra --profile app --profile observability \
  up -d --build
```

O overlay `docker-compose.prod.yml` adiciona:

- Restart policy `always`
- Limites de CPU/memória
- NGINX com TLS (Let's Encrypt via certbot sidecar)
- Desabilita portas expostas de MySQL/Redis/RabbitMQ

## 8. Checklist de go-live

### Segurança

- [ ] JWT RS256 com rotação de chaves
- [ ] RBAC configurado (admin, user, api_key)
- [ ] Rate limiting ativo (NGINX + Redis)
- [ ] CORS restrito aos domínios de produção
- [ ] Secrets fora do repositório
- [ ] Network policies entre namespaces
- [ ] Pod Security Standards (restricted)
- [ ] Scan de imagens (Trivy/Snyk) no CI

### Resiliência

- [ ] Health checks (`/health/live`, `/health/ready`) em todos os pods
- [ ] PDB (Pod Disruption Budget) minAvailable: 1
- [ ] Retry policies no Celery (max 3, exponential backoff)
- [ ] Circuit breaker no BFF para chamadas ao Python AI
- [ ] Graceful shutdown (SIGTERM, drain 30s)

### Dados

- [ ] Backups MySQL testados (restore drill mensal)
- [ ] Migrations versionadas (Alembic)
- [ ] Soft delete e audit logs habilitados
- [ ] Retention policy de uploads temporários

### Observabilidade

- [ ] Prometheus scraping configurado
- [ ] Dashboards Grafana importados (`infra/monitoring/grafana/dashboards/`)
- [ ] Alertas críticos (ver [Monitoramento](./monitoramento.md))
- [ ] OpenTelemetry exportando traces
- [ ] Logs estruturados JSON → Loki

### Performance

- [ ] CDN para assets estáticos e stems públicos
- [ ] Redis cache para análises idempotentes (hash do áudio)
- [ ] Connection pooling (API → MySQL, Python → MySQL)
- [ ] HPA/KEDA validado sob carga

## 9. Smoke test pós-deploy

```bash
API=https://api.softmusic.app

# Health
curl -sf "$API/health/ready" | jq .status

# Métricas
curl -sf "$API/metrics" | head -5

# Análise end-to-end (com token de serviço)
JOB=$(curl -sf -X POST "$API/songs/analyze" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":{"type":"http","url":"https://cdn.softmusic.app/samples/demo.mp3"}}' \
  | jq -r .job_id)

# Poll até completed (max 10 min)
until [ "$(curl -sf "$API/jobs/$JOB" -H "Authorization: Bearer $SERVICE_TOKEN" | jq -r .status)" = "completed" ]; do
  sleep 10
done

curl -sf "$API/songs/$(curl -sf "$API/jobs/$JOB" -H "Authorization: Bearer $SERVICE_TOKEN" | jq -r .song_id)/analysis" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Accept: application/vnd.softmusic.v1+json" \
  | jq '.harmony.key, .rhythm.bpm, .structure.sections | length'
```

## 10. Rollback

### Kubernetes

```bash
kubectl -n softmusic rollout undo deployment/softmusic-api
kubectl -n softmusic rollout undo deployment/softmusic-python-ai
kubectl -n softmusic rollout undo deployment/softmusic-worker
```

### Docker Compose

```bash
export SOFTMUSIC_VERSION=v1.2.3  # versão anterior
docker compose -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.prod.yml \
  --env-file infra/docker/.env.production \
  up -d
```

## 11. Manutenção

| Tarefa | Frequência |
|--------|------------|
| Rotação de JWT keys | 90 dias |
| Rotação de DB credentials | 90 dias |
| Restore drill MySQL | Mensal |
| Atualização de modelos IA | Conforme release |
| Patch de segurança (nodes) | Semanal |
| Revisão de alertas | Quinzenal |

## Referências

- [Variáveis de ambiente](./variaveis-ambiente.md)
- [Monitoramento e observabilidade](./monitoramento.md)
- [Desenvolvimento local com Docker](../local/desenvolvimento-docker.md)
