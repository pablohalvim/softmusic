# Deploy em produção (VPS única + Jenkins em container + Docker Compose)

Guia direto para subir o SoftMusic numa **única VPS** onde o **Jenkins roda
dentro de um container** e fala com o daemon Docker do **host** via
`/var/run/docker.sock`. O deploy é **local, sem SSH**: as imagens são buildadas
no daemon do host (**sem push para registry**) e o `docker compose` sobe os
serviços na própria máquina.

> Mesmo padrão do projeto `sportshub` que já roda nesta VPS.
> Objetivo: criar 1 pipeline de infra + 1 para cada app (API, IA, Web),
> cadastrar as credenciais e subir a versão em ~30 min.

## Arquitetura no servidor

```mermaid
flowchart TB
    subgraph VPS["VPS (uma máquina)"]
      subgraph JC["Container Jenkins (usuário 1000, --group-add docker)"]
        JENKINS["Jenkins"]
      end
      subgraph DOCKER["Docker Engine do host — projeto compose 'softmusic'"]
        NGINX[nginx + TLS] --> WEB[web / lp / admin-web]
        NGINX --> API[api BFF]
        API --> AI[python-ai + worker]
        API --> MYSQL[(MySQL)]
        API --> REDIS[(Redis)]
        AI --> RMQ[RabbitMQ]
        OBS[Prometheus · Loki · Promtail · Grafana · OTel]
      end
      JENKINS -->|/var/run/docker.sock| DOCKER
    end
    DNS[DNS] --> NGINX
```

Tudo roda no mesmo Docker Engine, no **projeto compose `softmusic`** (rede
`softmusic-network`). Como o Jenkins fala com o daemon do host via socket, todo
**bind mount** de configuração (observabilidade, nginx, `mysql/init`) precisa
apontar para um caminho que o **host** enxergue. Por isso os pipelines **copiam**
os arquivos de deploy para o `DEPLOY_DIR` (dentro do volume do Jenkins) e os bind
mounts usam esse caminho na visão do host (`DEPLOY_DIR_HOST`).

## Pré-requisitos (uma vez só)

### 1. Container do Jenkins com acesso ao Docker do host

```bash
DOCKER_GID=$(getent group docker | cut -d: -f3)

docker run -d \
  --name jenkins \
  --restart unless-stopped \
  -p 8080:8080 -p 50000:50000 \
  -v /dados/jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /usr/bin/docker:/usr/bin/docker \
  --group-add "$DOCKER_GID" \
  jenkins/jenkins:lts

# Se usar docker compose no pipeline, monte o plugin (caminho pode variar):
#   -v /usr/libexec/docker/cli-plugins/docker-compose:/usr/local/lib/docker/cli-plugins/docker-compose
```

Teste dentro do container:

```bash
docker exec -u jenkins jenkins docker ps
docker exec -u jenkins jenkins docker compose version
```

### 2. DEPLOY_DIR

Os pipelines gravam compose + configs em `DEPLOY_DIR`. Defaults (ajustáveis por
*Environment variables* do job):

| Variável | Visão do Jenkins | No host |
|----------|------------------|---------|
| `DEPLOY_DIR` | `/var/jenkins_home/deploy/softmusic` | `/dados/jenkins_home/deploy/softmusic` |
| `DEPLOY_DIR_HOST` | `/dados/jenkins_home/deploy/softmusic` | (mesmo caminho no host) |

Se o `jenkins_home` estiver montado de outro caminho no host, ajuste
`DEPLOY_DIR_HOST`.

### 3. DNS + TLS

Aponte `softmusic.com.br`, `app.softmusic.com.br` e `admin.softmusic.com.br`
para o IP da VPS. O `nginx`/`certbot` do overlay de produção cuidam do HTTPS
(ver seção TLS).

## Passo 1 — Credenciais no Jenkins (Secret text)

**Manage Jenkins → Credentials → System → Global credentials.** Todas como
**Secret text** (evita o erro de upload de "Secret file"):

| ID | Obrigatória | Conteúdo |
|----|-------------|----------|
| `softmusic-mysql-root-password` | Sim | Senha root do MySQL |
| `softmusic-mysql-password` | Sim | Senha do usuário `softmusic` |
| `softmusic-redis-password` | Sim | Senha do Redis |
| `softmusic-rabbitmq-password` | Sim | Senha do RabbitMQ |
| `softmusic-jwt-private-key` | Sim | Chave JWT da API (mín. 32 chars) |
| `softmusic-grafana-admin-password` | Sim | Senha admin do Grafana |
| `softmusic-admin-jwt-private-key` | Recomendada | Chave JWT do admin |
| `softmusic-admin-bootstrap-password` | Recomendada | Senha do admin inicial |
| `softmusic-asaas-api-key` | Se usar Asaas | API key do Asaas |
| `softmusic-asaas-webhook-token` | Se usar Asaas | Token do webhook Asaas |

As demais chaves (domínios, portas, URLs de conexão) têm defaults em
`infra/docker/scripts/render-env.sh` — sobrescrevíveis por *Environment
variables* do job. **Não há credencial de registry** (build é local).

Detalhes: [Credenciais e jobs do Jenkins](../../infra/jenkins/credentials.md).

## Passo 2 — Criar os pipelines

Crie **5 jobs** do tipo *Pipeline* (um por Jenkinsfile), todos com
**"Pipeline script from SCM"**:

| Job Jenkins | Script Path | Quando usar |
|-------------|-------------|-------------|
| `softmusic-infra` | `infra/jenkins/Jenkinsfile.infra` | Servidor com MySQL **8.4** |
| `softmusic-infra-legacy` | `infra/jenkins/Jenkinsfile.infra-legacy` | CPU antiga → **MariaDB 10.5.28** |
| `softmusic-api` | `infra/jenkins/Jenkinsfile.api` | API (BFF) |
| `softmusic-ia` | `infra/jenkins/Jenkinsfile.ia` | python-ai + worker (**aplica migrations**) |
| `softmusic-web` | `infra/jenkins/Jenkinsfile.web` | web + landing page |

Crie **infra OU infra-legacy** — não os dois.

## Passo 3 — Deploy (ordem para subir a versão)

1. **`softmusic-infra`** (ou `-legacy`) — provisiona MySQL + Redis + RabbitMQ +
   toda a observabilidade. Só precisa rodar de novo se mudar algo de infra.
2. **`softmusic-ia`** — builda a imagem, sobe python-ai + worker e **aplica as
   migrations** (`alembic upgrade head` no entrypoint). Toda mudança de schema
   entra aqui.
3. **`softmusic-api`** — builda e sobe a API.
4. **`softmusic-web`** — builda e sobe web + landing page (+ nginx).

> **Regra de ouro sobre migrations:** o banco só é migrado pelo job
> **`softmusic-ia`**. A API não aplica migrations. Se um deploy depende de
> schema novo, rode a **IA antes**.

O que cada job faz (local, sem SSH nem registry):

1. `checkout scm` → clona o repo no workspace do Jenkins.
2. (apps) `docker build` da imagem no daemon do host, marcando `:latest` (sem
   push).
3. `render-env.sh` monta `DEPLOY_DIR/.env.production` a partir das credenciais
   Secret text (senhas URL-encoded nas URLs de conexão).
4. `deploy-*.sh` copia compose + configs para `DEPLOY_DIR` e roda
   `docker compose up -d --no-deps --force-recreate <serviço>` + health check.

> O `admin-web` **não** é deployado pelas pipelines atuais (nenhuma builda a
> imagem). Para publicá-lo, crie um `Jenkinsfile.admin` no mesmo molde e rode o
> `deploy-web.sh` com `DEPLOY_ADMIN_WEB=1`.

## Observabilidade

Os dois jobs de infra sobem a stack completa: Prometheus, Loki, Promtail,
Grafana e OpenTelemetry Collector (`WITH_OBSERVABILITY=1`). O `deploy-infra.sh`
verifica no fim se todos os containers subiram. Detalhes em
[Monitoramento](./monitoramento.md).

Grafana atende em `GRAFANA_ROOT_URL` (ex.: `https://grafana.softmusic.com.br`).

## TLS / NGINX

O overlay `docker-compose.prod.yml` inclui `nginx` (portas 80/443) e um
`certbot` sidecar. Na primeira vez, emita os certificados (DNS já apontando para
a VPS):

```bash
docker run --rm \
  -v softmusic_certbot_certs:/etc/letsencrypt \
  -v softmusic_certbot_www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d softmusic.com.br -d app.softmusic.com.br -d admin.softmusic.com.br \
  --email voce@dominio.com --agree-tos --no-eff-email
```

O `softmusic-web` sobe o nginx usando esses certificados. Enquanto não houver
certificado, o `deploy-web.sh` apenas avisa (não falha) que o nginx não subiu.

## Smoke test manual (opcional)

```bash
# na VPS (host)
docker exec softmusic-mysql mysqladmin ping -h localhost --silent && echo "MySQL OK"
curl -sf http://127.0.0.1:8000/health && echo " python-ai OK"
curl -sf http://127.0.0.1:8080/health/live && echo " api OK"
curl -sf http://127.0.0.1:5173/ >/dev/null && echo " web OK"

cd /dados/jenkins_home/deploy/softmusic
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production ps
```

## Rollback

Sem registry, o rollback é rebuildar a imagem a partir do commit anterior
(rode o job apontando para o ref anterior). As imagens antigas ainda ficam no
daemon do host marcadas por `BUILD_NUMBER` até o `docker image prune`.

## Troubleshooting rápido

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `permission denied` no `/var/run/docker.sock` | Jenkins sem `--group-add` do GID do docker | Recriar o container do Jenkins (pré-requisito 1) |
| Observabilidade/nginx sobem com config vazia | `DEPLOY_DIR_HOST` errado (bind mount não visível no host) | Ajustar `DEPLOY_DIR_HOST` para o caminho real do `jenkins_home` no host |
| Deploy infra aborta citando variável | Credencial Secret text ausente/vazia | Cadastrar a credencial e re-rodar |
| Coluna/tabela nova não existe | Migration não aplicada | Rodar o job **`softmusic-ia`** |
| `image not found` no compose up | Job de app não buildou antes | Rodar o job de app (ele builda e sobe) |
| MySQL em restart loop | CPU incompatível com MySQL 8.4 | Usar `softmusic-infra-legacy` |
| 502 nos domínios | nginx sem certificado / app não subiu | Emitir TLS; ver `docker logs softmusic-nginx` |

## Referências

- [Credenciais e jobs do Jenkins](../../infra/jenkins/credentials.md)
- [Variáveis de ambiente](./variaveis-ambiente.md)
- [Monitoramento e observabilidade](./monitoramento.md)
- [Desenvolvimento local com Docker](../local/desenvolvimento-docker.md)
