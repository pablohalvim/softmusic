# SoftMusic — Reverse proxy na VPS (modelo Sportshub)

Cada serviço publica uma **porta no host**. O EasyPanel (Traefik) ou Nginx na VPS
faz HTTPS e encaminha para `127.0.0.1:PORTA`.

Não usamos `softmusic-nginx` nem certbot do compose — o EasyPanel já ocupa :80/:443.

## Portas no host (defaults)

| Serviço | Container | Porta host | Domínio público |
|---------|-----------|------------|-----------------|
| Landing | `softmusic-lp` | **4100** | `softmusic.com.br`, `www` |
| App | `softmusic-web` | **4101** | `app.softmusic.com.br` |
| Admin | `softmusic-admin-web` | **4102** | `admin.softmusic.com.br` |
| API (BFF) | `softmusic-api` | **8081** | `app…/api` e `admin…/api` |
| Grafana | `softmusic-grafana` | **4103** | `grafana.softmusic.com.br` |

> **Grafana vs EasyPanel:** o painel EasyPanel usa a porta **3000 no host**
> (`easypanel:3000`). O Grafana do SoftMusic escuta **3000 só dentro do container**
> e é publicado na **4103** no host — **não há conflito**. Se `docker ps` mostrar
> `softmusic-grafana` apenas como `3000/tcp` (sem `0.0.0.0:4103`), re-rode o job
> **`softmusic-infra`** para recriar o Grafana com a porta exposta.

Na mesma VPS (referência):

| Projeto | Web | API |
|---------|-----|-----|
| Sportshub | 4000 | 3333 |
| Jenkins | — | 8080 |
| SoftMusic | 4100–4102 | **8081** |

Sobrescreva via variáveis Jenkins: `LP_PORT`, `WEB_PORT`, `ADMIN_PORT`, `API_PORT`, `GRAFANA_PORT`.

## Teste local na VPS (após deploy Jenkins)

```bash
curl -I http://127.0.0.1:4100/    # landing
curl -I http://127.0.0.1:4101/    # app
curl -I http://127.0.0.1:4102/    # admin
curl -sf http://127.0.0.1:8081/health/live && echo " API OK"
curl -I http://127.0.0.1:4103/    # grafana
```

## EasyPanel — criar domínios (Personalizado)

Em **Criar Domínio**, use **Destino → Personalizado** (não “Serviço” — os containers
foram criados pelo Jenkins, não pelo EasyPanel).

Use o IP da VPS ou `host.docker.internal` se o Traefik alcançar o host:

| Host | Caminho | URL destino (Personalizado) |
|------|---------|----------------------------|
| `softmusic.com.br` | `/` | `http://SEU_IP_VPS:4100` |
| `www.softmusic.com.br` | `/` | `http://SEU_IP_VPS:4100` |
| `app.softmusic.com.br` | `/` | `http://SEU_IP_VPS:4101` |
| `admin.softmusic.com.br` | `/` | `http://SEU_IP_VPS:4102` |
| `grafana.softmusic.com.br` | `/` | `http://SEU_IP_VPS:4103` |

**HTTPS:** ligado em cada domínio — o EasyPanel emite o certificado Let's Encrypt.

> Se `127.0.0.1` não funcionar no Personalizado, use o IP público da VPS
> (ex.: `170.0.0.60.108:4101`) — o Traefik precisa alcançar a porta publicada no host.

### `/api` no mesmo domínio (recomendado — igual Sportshub)

O nginx **dentro** dos containers `web` e `admin-web` faz proxy de `/api/` → `http://api:8080/`
(ver `infra/nginx/conf.d/spa.conf`). No EasyPanel basta **uma rota por host** (`/` → `:4101` ou `:4102`).

**Remova** rotas separadas `app…/api` e `admin…/api` no EasyPanel se existirem — elas conflitam ou mandam POST para o SPA (405).

A API continua exposta em `:8081` no host para debug/webhooks diretos se necessário.

## Troubleshooting

### `405 Method Not Allowed` em `/api/*` (não é CORS)

Se o DevTools mostra `Server: nginx` e `Content-Type: text/html` no POST `/api/...`,
a requisição está indo para o **container web (4101)**, não para a **API (8081)**.

```bash
# Deve responder JSON da API (4xx/422), NÃO 405 nginx:
curl -sI -X POST https://app.softmusic.com.br/api/auth/register \
  -H "Content-Type: application/json" -d '{}'

# API direta (sempre deve funcionar):
curl -sI -X POST http://127.0.0.1:8081/auth/register \
  -H "Content-Type: application/json" -d '{}'
```

**Correção no EasyPanel:** rota `app.softmusic.com.br` + caminho `/api` → `http://IP:8081` com middleware **Strip Prefix** `/api`.

### Certificado `CN=Easypanel` / `ERR_CERT_AUTHORITY_INVALID`

Let's Encrypt falhou. Causas comuns: DNS apontando para IP errado, Host com `/api` no nome,
muitas tentativas falhas (rate limit ~1h). Ver logs:

```bash
docker logs $(docker ps -q -f name=easypanel-traefik | head -1) 2>&1 | grep -i acme | tail -10
```

Remova `/etc/easypanel/traefik/config/custom.yaml` se existir (conflita com a UI).

## Nginx no host (alternativa ao EasyPanel UI)

Exemplo `/etc/nginx/sites-available/softmusic` (se um dia desligar o EasyPanel na 443):

```nginx
server {
    listen 443 ssl http2;
    server_name softmusic.com.br www.softmusic.com.br;
    # ssl_certificate ... (certbot)

    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name app.softmusic.com.br;

    location /api/ {
        proxy_pass http://127.0.0.1:8081/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 100m;
    }

    location / {
        proxy_pass http://127.0.0.1:4101;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name admin.softmusic.com.br;

    location /api/ {
        proxy_pass http://127.0.0.1:8081/admin/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:4102;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name grafana.softmusic.com.br;

    location / {
        proxy_pass http://127.0.0.1:4103;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Deploy Jenkins (ordem)

1. `softmusic-infra` (ou `-legacy`)
2. `softmusic-ia`
3. `softmusic-api` → publica **8081**
4. `softmusic-web` → publica **4100** e **4101**
5. `softmusic-admin` → publica **4102**

Remova containers antigos se existirem:

```bash
docker rm -f softmusic-nginx softmusic-certbot 2>/dev/null || true
```

## Referências

- [Deploy em produção](./deploy-producao.md)
- Sportshub (mesmo padrão): `D:\projetos\pessoal\sportshub\docker-compose.prod.yml`
