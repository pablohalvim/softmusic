# Credenciais Jenkins — SoftMusic

Todos os segredos ficam em **Manage Jenkins → Credentials → System → Global credentials**.

Nunca coloque senhas no `Jenkinsfile`. Para trocar ambiente, atualize a credential e rode o pipeline novamente.

## Credenciais obrigatórias

| ID | Kind | Uso |
|----|------|-----|
| `softmusic-docker-registry-creds` | Username with password | Docker Hub — build/push das imagens |
| `softmusic-ssh-deploy-vps` | SSH Username with private key | Acesso SSH ao usuário `deploy` na VPS |
| `softmusic-deploy-host` | Secret text | IP ou DNS da VPS (sem `http://`) |
| `softmusic-deploy-host-port` | Secret text | Porta SSH (ex.: `22` ou `2230`) |
| `softmusic-production-env` | Secret file | Arquivo `.env` completo de produção |

### `softmusic-production-env`

Arquivo único copiado para `/opt/softmusic/.env.production` em cada deploy.

Baseie-se em `infra/docker/.env.production.example`. Inclua:

- MySQL, Redis, RabbitMQ
- JWT, URLs dos domínios
- Asaas (`ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`)
- Tags de imagem (`SOFTMUSIC_API_IMAGE`, etc.) — pipelines de app atualizam automaticamente

## Jobs e Jenkinsfiles

| Job Jenkins | Jenkinsfile | Quando usar |
|-------------|-------------|-------------|
| `softmusic-infra` | `infra/jenkins/Jenkinsfile.infra` | Servidor novo — MySQL **8.4** |
| `softmusic-infra-legacy` | `infra/jenkins/Jenkinsfile.infra-legacy` | CPU antiga — MySQL **5.7** |
| `softmusic-api` | `infra/jenkins/Jenkinsfile.api` | Só API BFF |
| `softmusic-ia` | `infra/jenkins/Jenkinsfile.ia` | python-ai + worker |
| `softmusic-web` | `infra/jenkins/Jenkinsfile.web` | web + LP |

## Ordem do primeiro deploy

1. Preparar VPS (`deploy` + Docker + clone em `/opt/softmusic/repo`)
2. Cadastrar credenciais
3. `softmusic-infra` **ou** `softmusic-infra-legacy`
4. `softmusic-ia` (se GPU na mesma VPS)
5. `softmusic-api`
6. `softmusic-web`
7. DNS: `softmusic.com.br`, `app.softmusic.com.br`, `admin.softmusic.com.br`

## Smoke test (job Pipeline descartável)

```groovy
pipeline {
  agent any
  environment {
    DEPLOY_HOST     = credentials('softmusic-deploy-host')
    DEPLOY_SSH_PORT = credentials('softmusic-deploy-host-port')
    DOCKER_CREDS    = credentials('softmusic-docker-registry-creds')
  }
  stages {
    stage('Registry') {
      steps {
        sh 'echo "$DOCKER_CREDS_PSW" | docker login -u "$DOCKER_CREDS_USR" --password-stdin'
        sh 'docker logout || true'
      }
    }
    stage('SSH') {
      steps {
        sshagent(credentials: ['softmusic-ssh-deploy-vps']) {
          sh '''
            ssh -o StrictHostKeyChecking=no -p $DEPLOY_SSH_PORT deploy@$DEPLOY_HOST \
              'docker version --format "{{.Server.Version}}" && id'
          '''
        }
      }
    }
  }
}
```
