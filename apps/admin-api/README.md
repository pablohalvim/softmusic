# Admin API (`apps/admin-api`)

API interna para licenças, usuários, moderação de músicas e e-mail marketing.

- Autenticação: `admin_users` (credenciais provisionadas pela equipe)
- Rotas sob prefixo `/admin` no nginx (`admin.softmusic.com.br/api/`)
- Auditoria obrigatória em `audit_logs`

## Módulos planejados

- Bandas: listar, isentar (`billing_exempt`), suspender
- Usuários: editar dados, resetar senha
- Faturas: gerar cobrança, reenviar link Asaas
- Músicas: bloquear por `youtube_video_id`
- Campanhas de e-mail

Implementação: Fase 3 do [SaaS](../docs/arquitetura/saas-bandas-licencas.md).
