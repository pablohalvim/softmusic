# SoftMusic

Plataforma open-source de inteligência musical — análise harmônica, rítmica, estrutural e educacional com múltiplos modelos de IA.

## Documentação

Toda a documentação está em [`docs/`](./docs/README.md):

- [Desenvolvimento local com Docker](./docs/local/desenvolvimento-docker.md)
- [Deploy em produção](./docs/producao/deploy-producao.md)

## Estrutura

```
apps/
  api/          # BFF — React Router v7 (REST)
  web/          # Frontend React 19 + PWA
  python-ai/    # FastAPI + Celery + pipeline de áudio
packages/
  types/        # Schemas Zod versionados
  shared/       # Utilitários compartilhados
  sdk/          # Cliente TypeScript
  config/       # Presets TypeScript
infra/
  docker/       # Docker Compose
```

## Início rápido (modo híbrido)

Com a infra Docker já rodando:

```bash
# 1. Dependências
pnpm install
cd apps/python-ai && pip install -e ".[dev]" && cd ../..

# 2. Infra (MySQL, Redis, RabbitMQ)
docker compose -f infra/docker/docker-compose.yml --profile infra up -d

# 3. Serviços (4 terminais)
cd apps/python-ai && python -m uvicorn app.main:app --reload --port 8000
cd apps/python-ai && python -m celery -A app.worker worker --loglevel=info --pool=solo
cd apps/api && pnpm dev
cd apps/web && pnpm dev
```

| Serviço | URL |
|---------|-----|
| Web | http://localhost:5173 |
| API | http://localhost:8080 |
| Python AI | http://localhost:8000 |
| RabbitMQ | http://localhost:15672 |

## Stack completo via Docker

```bash
docker compose -f infra/docker/docker-compose.yml --profile infra --profile app up -d --build
```

## Licença

MIT
