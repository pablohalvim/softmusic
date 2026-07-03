# SoftMusic — Documentação

Plataforma de inteligência musical open-source. Esta documentação cobre arquitetura, desenvolvimento local e implantação em produção.

## Índice

| Documento | Descrição |
|-----------|-----------|
| [Visão geral da arquitetura](./arquitetura/visao-geral.md) | Monorepo, serviços, pipeline de áudio |
| [SaaS — bandas e licenças](./arquitetura/saas-bandas-licencas.md) | Produto comercial, billing, permissões |
| [Tutorial VPS + Jenkins](./producao/tutorial-vps-deploy-jenkins.html) | Deploy em produção com pipelines Jenkins |
| [Credenciais Jenkins](../infra/jenkins/credentials.md) | IDs das credentials obrigatórias |
| [Pré-requisitos](./local/pre-requisitos.md) | Hardware, software e portas necessárias |
| [Desenvolvimento local com Docker](./local/desenvolvimento-docker.md) | Subir todo o stack localmente com Docker Compose |
| [Deploy em produção](./producao/deploy-producao.md) | VPS única + Jenkins local + Docker Compose (fonte do tutorial HTML) |
| [Variáveis de ambiente](./producao/variaveis-ambiente.md) | Referência completa de configuração por serviço |
| [Monitoramento e observabilidade](./producao/monitoramento.md) | Prometheus, Grafana, Loki e OpenTelemetry |

## Estrutura do monorepo

```
softmusic/
├── apps/
│   ├── web/           # App cliente (app.softmusic.com.br)
│   ├── lp/            # Landing page (softmusic.com.br)
│   ├── admin-web/     # Painel interno (admin.softmusic.com.br)
│   ├── admin-api/     # API admin (planejado)
│   ├── api/           # BFF — React Router v7 Framework Mode
│   ├── python-ai/     # Serviço de análise musical (FastAPI)
│   └── workers/       # Workers Celery para pipeline assíncrono
├── packages/
│   ├── ui/            # Componentes shadcn/ui compartilhados
│   ├── shared/        # Utilitários compartilhados
│   ├── sdk/           # SDK cliente TypeScript
│   ├── types/         # Tipos e schemas Zod versionados
│   └── config/        # ESLint, TypeScript, Tailwind presets
├── infra/
│   ├── docker/        # Docker Compose (dev e prod)
│   ├── kubernetes/    # Manifests e Helm charts
│   ├── nginx/         # Reverse proxy e TLS
│   └── monitoring/    # Prometheus, Grafana, Loki
└── docs/              # Esta pasta
```

## Início rápido

```bash
# 1. Clonar o repositório
git clone https://github.com/seu-org/softmusic.git
cd softmusic

# 2. Configurar variáveis de ambiente
cp infra/docker/.env.example infra/docker/.env

# 3. Subir o stack local
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Verificar saúde dos serviços
curl http://localhost:8080/health
```

Para instruções detalhadas, consulte [Desenvolvimento local com Docker](./local/desenvolvimento-docker.md).

## API principal

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/songs/analyze` | Inicia análise a partir de URL ou referência de storage |
| `POST` | `/songs/upload` | Upload de MP3, WAV, FLAC ou OGG |
| `GET` | `/songs/{id}` | Metadados da música |
| `GET` | `/songs/{id}/analysis` | Relatório musical completo (JSON versionado) |
| `GET` | `/songs/{id}/timeline` | Estrutura da música com timestamps |
| `GET` | `/songs/{id}/chords` | Progressão de acordes |
| `GET` | `/songs/{id}/lyrics` | Letra alinhada |
| `GET` | `/songs/{id}/waveform` | Dados de forma de onda |
| `GET` | `/songs/{id}/stems` | Stems separados (Demucs) |
| `GET` | `/jobs/{id}` | Status do job de análise |

## Suporte

- Issues: GitHub Issues do repositório
- Versão da API: `v1` (header `Accept: application/vnd.softmusic.v1+json`)
