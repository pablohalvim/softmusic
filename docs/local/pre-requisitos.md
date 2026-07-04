# Pré-requisitos

Checklist antes de iniciar o desenvolvimento local ou o deploy em produção.

## Hardware

| Cenário | CPU | RAM | Disco | GPU |
|---------|-----|-----|-------|-----|
| Dev (infra only) | 4 cores | 8 GB | 10 GB | — |
| Dev (stack completo) | 8 cores | 16 GB | 20 GB | Opcional |
| Produção (worker) | 8+ cores | 32 GB | 100 GB | NVIDIA T4+ recomendado |

## Software

### Obrigatório

- **Git** 2.40+
- **Docker Engine** 24+ com Compose v2
- **Node.js** LTS (22.x) — para apps web e api em modo híbrido
- **Python** 3.13 — para apps/python-ai em modo híbrido

### Opcional

- **NVIDIA Container Toolkit** — aceleração GPU para Demucs
- **kubectl** 1.28+ — deploy em Kubernetes
- **Helm** 3.14+ — charts em `infra/kubernetes/helm/`
- **gh** CLI — CI/CD e releases via GitHub Actions

## Verificação rápida

```bash
git --version
docker --version
docker compose version
node --version
python --version
```

## Windows (WSL2)

1. Instale [Docker Desktop](https://www.docker.com/products/docker-desktop/) com backend WSL2
2. Clone o repositório dentro do filesystem WSL (`~/projetos/softmusic`)
3. Evite paths em `/mnt/c/` — I/O de volumes Docker fica significativamente mais lento

## Linux

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# NVIDIA (opcional)
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo mkdir -p /etc/cdi
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
sudo systemctl restart docker

# Teste (host):
nvidia-smi
docker run --rm --runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi
```

## macOS

- Docker Desktop 4.30+
- Sem suporte nativo a GPU NVIDIA — pipeline roda em CPU (mais lento)
- Para stack completo, aloque 16 GB RAM ao Docker Desktop (Settings → Resources)

## Portas utilizadas

Certifique-se de que estas portas estão livres antes de subir o Compose:

| Porta | Serviço |
|-------|---------|
| 3306 | MySQL |
| 5173 | Web |
| 5672 | RabbitMQ AMQP |
| 6379 | Redis |
| 8000 | Python AI |
| 8080 | API |
| 9090 | Prometheus |
| 15672 | RabbitMQ Management |
| 3000 | Grafana |
| 3100 | Loki |
| 4317 | OTel Collector gRPC |

## Próximo passo

[Desenvolvimento local com Docker](./desenvolvimento-docker.md)
