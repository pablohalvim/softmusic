# SoftMusic SaaS — Bandas, licenças e billing

Documento de referência para o produto comercial: regras de negócio, segurança, domínios e integração Asaas.

## Decisões de produto (fechadas)

| # | Decisão |
|---|---------|
| 1 | Um owner pode ter **várias bandas**; todas as assinaturas são cobradas em **uma única fatura mensal** |
| 2 | Um usuário pode ser membro de **várias bandas**; ao ver músicas, **escolhe a banda** no contexto |
| 3 | **5 dias** de tolerância após vencimento (`past_due`) antes de suspender |
| 4 | Cobrança **pró-rata** ao adicionar membro; valor extra só se **ultrapassar** o limite do plano (10 ou 20) |
| 5 | **Trial de 2 dias** — pode ver cifras, **não pode** enviar músicas para análise |
| 6 | Cadastro: nome completo, CPF, data de nascimento, endereço completo, e-mail, telefone — tudo obrigatório exceto **complemento** |
| 7 | Domínios: **LP** (`softmusic.com.br`), **app** (`app.softmusic.com.br`), **admin** (`admin.softmusic.com.br`); login com **e-mail ou CPF** + senha |

## Portais

| Domínio | App | Público |
|---------|-----|---------|
| `softmusic.com.br` | `apps/lp` | Landing page + planos + botão Login |
| `app.softmusic.com.br` | `apps/web` | Cadastro, bandas, biblioteca, cifras, faturas (owner) |
| `admin.softmusic.com.br` | `apps/admin-web` | Equipe SoftMusic (credenciais internas) |

APIs:

| Serviço | Responsabilidade |
|---------|------------------|
| `apps/api` | BFF cliente: auth, bandas, músicas, billing proxy, webhooks Asaas |
| `apps/admin-api` | Admin: usuários, bandas, moderação, campanhas, auditoria |
| `apps/python-ai` | Pipeline de análise (inalterado em essência) |

## Planos e precificação

| Plano | Código | Base/mês | Inclui | Extra/membro |
|-------|--------|----------|--------|--------------|
| Individual | `individual` | R$ 29,90 | 1 membro | R$ 19,90 |
| Banda 10 | `band_10` | R$ 129,90 | 10 membros | R$ 9,90 |
| Banda 20 | `band_20` | R$ 199,90 | 20 membros | R$ 8,90 |

### Fatura consolidada (owner)

```
fatura_mensal = Σ (para cada banda do owner) preço_banda

preço_banda = base_plano + max(0, membros_ativos - limite_plano) × preço_extra
```

- Uma **conta de billing** (`billing_accounts`) por owner.
- Um **cliente Asaas** por conta de billing.
- Uma **assinatura Asaas** com valor recalculado quando bandas/membros mudam.
- Faturas (`invoices`) com **line items** por banda.

## Estados

### Banda (`bands.status`)

| Status | Ver cifra | Analisar | Observação |
|--------|-----------|----------|------------|
| `draft` | Não | Não | Criada, sem checkout |
| `trial` | Sim | **Não** | 2 dias após ativação inicial |
| `pending_payment` | Não | Não | Aguardando 1º pagamento |
| `active` | Sim | Sim* | Assinatura em dia ou isenta |
| `past_due` | Sim | Sim* | Até 5 dias após vencimento |
| `suspended` | Não | Não | Inadimplência |
| `cancelled` | Não | Não | Cancelada pelo owner |

\* Membro precisa de `can_analyze_songs` ou ser owner.

### Isenção (`billing_exempt`)

Bandas parceiras: `billing_exempt = true` — sem cobrança Asaas, acesso `active` permanente.

## Papéis e permissões

| Ação | Visitante | Cadastrado | Membro | Analista | Owner | Admin |
|------|-----------|------------|--------|----------|-------|-------|
| Ver LP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Login app | — | ✓ | ✓ | ✓ | ✓ | — |
| Ver cifra | ✗ | ✗ | ✓* | ✓* | ✓* | ✓ |
| Analisar música | ✗ | ✗ | ✗ | ✓* | ✓* | ✓ |
| Convidar membros | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Faturas | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Painel admin | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

\* Banda `active`, `past_due` ou `trial` (análise bloqueada em `trial`).

## Biblioteca global + vínculo por banda

- Catálogo global de `songs` (deduplicação por `youtube_video_id`).
- `band_songs` liga música ↔ banda.
- Analisar = criar/reutilizar song + vincular à banda ativa.
- Moderação: `songs.moderation_status = blocked` impede novos vínculos e novas análises.

## Autenticação

### App cliente

- **Login:** e-mail **ou** CPF (somente dígitos) + senha.
- JWT access (15 min) + refresh (7 dias) em cookie httpOnly ou header.
- Senha: bcrypt/argon2, mínimo 8 caracteres.

### Admin

- Tabela `admin_users` separada — sem cadastro público.
- Credenciais provisionadas pela equipe.
- MFA recomendado em produção.

## Integração Asaas

- Checkout transparente: **PIX** e **cartão de crédito**.
- Webhooks em `POST /webhooks/asaas` (API cliente).
- Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `SUBSCRIPTION_UPDATED`.
- Owner acessa faturas em `/billing` no app.

## Segurança

- Segredos apenas em variáveis de ambiente / Jenkins Credentials.
- Admin API em rede restrita ou IP allowlist.
- `audit_logs` para ações admin e billing.
- Rate limit em login e cadastro.
- CPF armazenado criptografado ou hasheado para busca (HMAC com pepper).
- LGPD: exportação e exclusão de conta (soft delete).

## Modelo de dados

Ver migration `003_saas_users_bands_billing.py` e `apps/python-ai/app/infrastructure/database/models.py`.

Entidades principais: `users`, `bands`, `band_members`, `band_invites`, `band_songs`, `billing_accounts`, `billing_subscription_items`, `invoices`, `invoice_line_items`, `admin_users`, `audit_logs`, `song_blocks`.

## Deploy

Pipelines Jenkins em `infra/jenkins/` — ver [Tutorial VPS + Jenkins](../producao/tutorial-vps-deploy-jenkins.html).
