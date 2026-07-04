# Credenciais e deploy do Jenkins — SoftMusic

Cenário desta VPS: o **Jenkins roda dentro de um container** e fala com o daemon
Docker do **host** via `/var/run/docker.sock`. O deploy é **local** (sem SSH):
as imagens são buildadas no daemon do host (**sem push para registry**) e o
`docker compose` sobe os serviços na própria máquina.

> Mesmo padrão do projeto `sportshub` que já roda nesta VPS.

## Pré-requisitos do container Jenkins (uma vez)

O usuário `jenkins` (UID 1000) precisa falar com o Docker do host. Recrie o
container do Jenkins com o socket, o binário do Docker e o `--group-add` do GID
do grupo `docker` do host:

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

# Se usar docker compose no pipeline, monte também o plugin:
#   -v /usr/libexec/docker/cli-plugins/docker-compose:/usr/local/lib/docker/cli-plugins/docker-compose
```

Teste dentro do container antes de rodar os jobs:

```bash
docker exec -u jenkins jenkins docker ps
docker exec -u jenkins jenkins docker compose version
```

### DEPLOY_DIR (onde o compose e as configs são gravados)

Os pipelines copiam os arquivos de deploy (compose + configs de observabilidade
+ nginx + mysql/init) para um diretório dentro do volume do Jenkins. Isso é
necessário porque os **bind mounts** precisam de um caminho que o daemon do
**host** enxergue.

| Variável | Default (visão do Jenkins) | No host |
|----------|----------------------------|---------|
| `DEPLOY_DIR` | `/var/jenkins_home/deploy/softmusic` | `/dados/jenkins_home/deploy/softmusic` |
| `DEPLOY_DIR_HOST` | `/dados/jenkins_home/deploy/softmusic` | (mesmo caminho no host) |

Se o seu `jenkins_home` estiver montado de outro caminho no host, ajuste
`DEPLOY_DIR_HOST` na configuração do job (Environment variables) ou no
`environment {}` do Jenkinsfile.

## Credenciais (tipo "Secret text")

Crie em **Manage Jenkins → Credentials → System → Global credentials**, todas
como **Secret text** (evita o problema de upload de "Secret file"). O
`render-env.sh` monta o `.env` de produção a partir delas.

| ID | Obrigatória | Conteúdo |
|----|-------------|----------|
| `softmusic-mysql-root-password` | Sim | Senha root do MySQL |
| `softmusic-mysql-password` | Sim | Senha do usuário `softmusic` no MySQL |
| `softmusic-redis-password` | Sim | Senha do Redis |
| `softmusic-rabbitmq-password` | Sim | Senha do RabbitMQ |
| `softmusic-jwt-private-key` | Sim | Chave JWT da API (mín. 32 chars) |
| `softmusic-grafana-admin-password` | Sim | Senha admin do Grafana |
| `softmusic-admin-jwt-private-key` | Recomendada | Chave JWT do admin (default = JWT da API) |
| `softmusic-admin-bootstrap-password` | Recomendada | Senha do admin inicial |
| `softmusic-asaas-api-key` | Se usar Asaas | API key do Asaas |
| `softmusic-asaas-webhook-token` | Se usar Asaas | Token do webhook Asaas |

Gerar senha/chave forte:

```bash
openssl rand -base64 32
```

> As demais chaves do `.env` (domínios, portas, URLs de conexão, modelo Demucs,
> etc.) têm **defaults** em `infra/docker/scripts/render-env.sh` e podem ser
> sobrescritas por *Environment variables* do job. As URLs de conexão
> (`DATABASE_URL`, `REDIS_URL`, `CELERY_*`) são montadas automaticamente com as
> senhas **URL-encoded**.

### Quais credenciais cada job exige

O `withCredentials` do Jenkins **falha se qualquer ID não existir**. Por isso os
jobs pedem apenas o que precisam:

- **`softmusic-infra` / `-legacy`**: apenas as **6 obrigatórias** (mysql-root,
  mysql, redis, rabbitmq, jwt-private-key, grafana-admin-password). **Não**
  precisa de admin/Asaas para provisionar a infra.
- **`softmusic-api` / `-ia` / `-web` / `-admin`**: exigem as 6 acima **+**
  `admin-jwt-private-key`, `admin-bootstrap-password`, `asaas-api-key` e
  `asaas-webhook-token`. Se ainda não usa Asaas, cadastre esses dois IDs com um
  valor placeholder (ex.: `disabled`) — o pagamento só é ativado quando a chave
  real for informada.

## Jobs e Jenkinsfiles

Todos são *Pipeline* com **"Pipeline script from SCM"** apontando para o
respectivo caminho. **Não há credencial de registry** (build é local).

| Job Jenkins | Jenkinsfile | O que faz |
|-------------|-------------|-----------|
| `softmusic-infra` | `infra/jenkins/Jenkinsfile.infra` | MySQL **8.4** + Redis + RabbitMQ + observabilidade |
| `softmusic-infra-legacy` | `infra/jenkins/Jenkinsfile.infra-legacy` | Igual, com **MariaDB 10.5.28** (CPU antiga) |
| `softmusic-api` | `infra/jenkins/Jenkinsfile.api` | Builda e sobe a API (BFF) |
| `softmusic-ia` | `infra/jenkins/Jenkinsfile.ia` | Builda e sobe python-ai + worker (**aplica migrations**) |
| `softmusic-web` | `infra/jenkins/Jenkinsfile.web` | Builda e sobe web + landing page (+ nginx) |
| `softmusic-admin` | `infra/jenkins/Jenkinsfile.admin` | Builda e sobe o painel admin-web (+ nginx) |

## Ordem do primeiro deploy

1. Recriar o container do Jenkins com socket + `--group-add` (acima)
2. Cadastrar as credenciais Secret text
3. `softmusic-infra` **ou** `softmusic-infra-legacy` (não os dois)
4. `softmusic-ia` (sobe a IA e **aplica as migrations**)
5. `softmusic-api`
6. `softmusic-web`
7. `softmusic-admin` (opcional — painel administrativo)
8. Emitir certificados TLS e configurar DNS dos domínios

Guia completo: [docs/producao/deploy-producao.md](../../docs/producao/deploy-producao.md).
