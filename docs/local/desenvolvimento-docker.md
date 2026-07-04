# Desenvolvimento local com Docker

Este guia descreve como executar o stack completo do SoftMusic na sua máquina usando Docker Compose.

## Pré-requisitos

| Ferramenta | Versão mínima | Verificação |
|------------|---------------|-------------|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose | v2.20+ | `docker compose version` |
| Git | 2.40+ | `git --version` |
| RAM disponível | 16 GB recomendado | Pipeline de IA consome memória |
| Disco | 20 GB livres | Modelos Demucs, Whisper e caches |

> **Windows:** use WSL2 com Docker Desktop. Monte o repositório dentro do filesystem WSL (`\\wsl$\...`) para melhor performance de I/O com volumes Docker.

> **Worker duplicado (Windows):** se você subir `celery` localmente **e** o container `softmusic-worker`, os dois consomem a mesma fila. O worker local no Windows **não tem ffmpeg** por padrão e falha em downloads do YouTube. Use **apenas um**: ou Docker (`softmusic-worker`) ou local com ffmpeg instalado (`winget install Gyan.FFmpeg`).

> **GPU (opcional):** acelera Demucs e inferência. Configure `NVIDIA Container Toolkit` e defina `CUDA_VISIBLE_DEVICES=0` no `.env`.

## 1. Clonar e configurar

```bash
git clone https://github.com/seu-org/softmusic.git
cd softmusic

cp infra/docker/.env.example infra/docker/.env
```

Edite `infra/docker/.env` conforme necessário. Valores padrão funcionam para desenvolvimento local.

## 2. Perfis de execução

O Compose suporta três perfis:

| Perfil | Comando | O que sobe |
|--------|---------|------------|
| **infra** | `--profile infra` | MySQL, Redis, RabbitMQ |
| **app** | `--profile app` | API, Python AI, Workers, Web |
| **observability** | `--profile observability` | Prometheus, Grafana, Loki |

### Apenas infraestrutura (desenvolvimento híbrido)

Útil quando você roda `apps/web` e `apps/api` com hot-reload nativo e usa Docker só para bancos e filas.

```bash
docker compose -f infra/docker/docker-compose.yml --profile infra up -d
```

Serviços disponíveis:

- MySQL: `localhost:3307` (porta interna do container; ver `MYSQL_PORT` no `.env`)
- Redis: `localhost:6379`
- RabbitMQ Management: http://localhost:15672

### Stack completo

```bash
docker compose -f infra/docker/docker-compose.yml --profile infra --profile app up -d --build
```

> Após mudanças no `python-ai`, rebuild também **worker** e **scheduler** (imagens
> separadas): `docker compose ... build python-ai worker scheduler`

Serviços adicionais:

| Serviço | URL |
|---------|-----|
| Frontend (Web) | http://localhost:5173 |
| API (BFF) | http://localhost:8080 |
| Python AI | http://localhost:8000 |
| Swagger (API) | http://localhost:8080/docs |
| OpenAPI (Python) | http://localhost:8000/docs |

### Stack completo + observabilidade

```bash
docker compose -f infra/docker/docker-compose.yml \
  --profile infra --profile app --profile observability \
  up -d --build
```

| Serviço | URL |
|---------|-----|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |

Credenciais padrão do Grafana: ver `.env` (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`).

## 3. Migrations

O schema do banco é gerenciado **somente via Alembic** (não use `create_all` em runtime).

### Stack Docker (automático)

O container `python-ai` executa `alembic upgrade head` no startup. Se o banco já tiver tabelas criadas anteriormente (ex.: dev local), ele faz `alembic stamp head` automaticamente.

### Manual (se necessário)

```bash
# Aplicar migrations
docker compose -f infra/docker/docker-compose.yml exec python-ai alembic upgrade head

# Banco já tem tabelas, mas sem histórico Alembic (erro "Table already exists")
docker compose -f infra/docker/docker-compose.yml exec python-ai alembic stamp head
```

> O BFF (`apps/api`) não possui migrations próprias — persiste dados via `python-ai`.

## 4. Verificar saúde

```bash
# Health check agregado via NGINX interno (quando perfil app ativo)
curl -sf http://localhost:8080/health | jq .

# Serviços individuais
curl -sf http://localhost:8080/health/live
curl -sf http://localhost:8000/health
curl -sf http://localhost:8080/health/ready
```

Resposta esperada (`200 OK`):

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "services": {
    "mysql": "up",
    "redis": "up",
    "rabbitmq": "up",
    "python_ai": "up"
  }
}
```

## 5. Testar análise de música

### Upload de arquivo

```bash
curl -X POST http://localhost:8080/songs/upload \
  -H "Authorization: Bearer <seu-jwt>" \
  -F "file=@./samples/demo.mp3" \
  -F "options={\"educational_level\":\"intermediate\"}"
```

### Análise por link do YouTube

Na UI: http://localhost:5173/analyze → aba **YouTube**

Via API:

```bash
curl -X POST http://localhost:8080/songs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "type": "youtube",
      "url": "https://www.youtube.com/watch?v=VIDEO_ID"
    },
    "options": {
      "educational_level": "intermediate"
    }
  }'
```

O worker usa **yt-dlp** + **ffmpeg** para baixar o áudio, extrair título/canal e executar o pipeline.

### Análise por URL HTTP direta

```bash
curl -X POST http://localhost:8080/songs/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "type": "http",
      "url": "https://example.com/track.mp3"
    },
    "options": {
      "educational_level": "intermediate"
    }
  }'
```

### Acompanhar job

```bash
curl http://localhost:8080/jobs/{job_id} \
  -H "Authorization: Bearer <seu-jwt>"
```

### Obter análise completa

```bash
curl http://localhost:8080/songs/{song_id}/analysis \
  -H "Authorization: Bearer <seu-jwt>" \
  -H "Accept: application/vnd.softmusic.v1+json"
```

## 6. Desenvolvimento com hot-reload

Para iterar rapidamente sem rebuild de imagem:

```bash
# Terminal 1 — infra
docker compose -f infra/docker/docker-compose.yml --profile infra up -d

# Terminal 2 — API
cd apps/api && npm install && npm run dev

# Terminal 3 — Web
cd apps/web && npm install && npm run dev

# Terminal 4 — Python AI
cd apps/python-ai && pip install -e ".[dev]" && uvicorn app.main:app --reload --port 8000

# Terminal 5 — Celery worker
cd apps/python-ai && celery -A app.worker worker --loglevel=info
```

Variáveis para apontar apps locais aos containers:

```env
DATABASE_URL=mysql+aiomysql://softmusic:softmusic@localhost:3306/softmusic
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=amqp://softmusic:softmusic@localhost:5672//
PYTHON_AI_URL=http://localhost:8000
```

## 7. Volumes e persistência

| Volume | Conteúdo |
|--------|----------|
| `softmusic_mysql_data` | Dados MySQL |
| `softmusic_redis_data` | Persistência Redis (AOF) |
| `softmusic_rabbitmq_data` | Filas RabbitMQ |
| `softmusic_uploads` | Arquivos de áudio enviados |
| `softmusic_models` | Cache de modelos de IA |
| `softmusic_grafana_data` | Dashboards Grafana |

Limpar dados e recomeçar:

```bash
docker compose -f infra/docker/docker-compose.yml down -v
```

## 8. Logs e debugging

```bash
# Todos os serviços
docker compose -f infra/docker/docker-compose.yml logs -f

# Serviço específico
docker compose -f infra/docker/docker-compose.yml logs -f python-ai
docker compose -f infra/docker/docker-compose.yml logs -f worker

# Entrar no container
docker compose -f infra/docker/docker-compose.yml exec python-ai bash
```

## 9. Solução de problemas

### MySQL não inicia

```bash
docker compose -f infra/docker/docker-compose.yml logs mysql
```

Verifique se a porta 3307 não está em uso: `netstat -an | findstr 3307` (Windows) ou `ss -tlnp | grep 3307` (Linux).

### Worker não processa jobs

1. Confirme RabbitMQ: http://localhost:15672
2. Verifique fila `analysis` no painel
3. Logs do worker: `docker compose ... logs worker`

### Out of memory (Demucs / Whisper)

- Reduza workers Celery: `CELERY_CONCURRENCY=1` no `.env`
- Use perfil CPU-only desabilitando GPU
- Aumente memória do Docker Desktop (Settings → Resources)

### Permissão negada em volumes (Linux)

```bash
sudo chown -R $USER:$USER infra/docker/volumes
```

## 10. Parar o ambiente

```bash
# Parar containers (preserva volumes)
docker compose -f infra/docker/docker-compose.yml --profile infra --profile app down

# Parar e remover volumes
docker compose -f infra/docker/docker-compose.yml down -v
```

## Próximos passos

- [Variáveis de ambiente](../producao/variaveis-ambiente.md) — referência completa
- [Deploy em produção](../producao/deploy-producao.md) — Kubernetes e go-live
- [Monitoramento](../producao/monitoramento.md) — métricas e alertas
