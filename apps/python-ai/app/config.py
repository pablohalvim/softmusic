from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    python_ai_host: str = "0.0.0.0"
    python_ai_port: int = 8000
    database_url: str = "mysql+aiomysql://softmusic:softmusic_dev@localhost:3306/softmusic"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "amqp://softmusic:softmusic_dev@localhost:5672//"
    celery_result_backend: str = "redis://localhost:6379/1"
    # storage_provider: "local" (disco/volume) ou "s3" (S3-compatível, ex.: Cloudflare R2).
    storage_provider: str = "local"
    storage_bucket: str = "softmusic"
    storage_local_path: str = "./uploads"
    # Object storage (S3-compatível / Cloudflare R2). Só usado quando provider="s3".
    s3_endpoint_url: str = ""
    s3_region: str = "auto"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    # Prefixo opcional das chaves (para compartilhar bucket). Vazio = bucket dedicado.
    storage_prefix: str = ""
    # Validade (segundos) das URLs pré-assinadas de download.
    storage_presign_expires: int = 3600
    # Após subir os artefatos para o R2, apaga a cópia local (offload de disco).
    storage_delete_local_after_upload: bool = False
    models_cache_dir: str = "./models"
    analysis_json_version: str = "1.0.0"
    demucs_enabled: bool = True
    # htdemucs_6s separa em 6 fontes: drums, bass, other, vocals, guitar, piano.
    demucs_model: str = "htdemucs_6s"
    log_level: str = "info"
    celery_concurrency: int = 1
    cuda_visible_devices: str = "0"

    jwt_private_key: str = "dev-only-change-in-production-min-32-chars-long"
    jwt_algorithm: str = "HS256"
    jwt_access_expires_in: str = "15m"
    jwt_refresh_expires_in: str = "7d"
    admin_jwt_private_key: str = "dev-admin-change-in-production-min-32-chars"
    cpf_pepper: str = "dev-cpf-pepper-change-me"

    admin_bootstrap_email: str = ""
    admin_bootstrap_password: str = ""
    admin_bootstrap_name: str = "Administrador"

    asaas_api_key: str = ""
    asaas_environment: str = "sandbox"
    asaas_webhook_token: str = ""

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    # Resend (https://resend.com) — preferido em produção. Se vazio, cai no SMTP.
    resend_api_key: str = ""
    email_from: str = "noreply@softmusic.com.br"
    web_origin: str = "http://localhost:5173"
    lp_origin: str = "http://localhost:5180"


@lru_cache
def get_settings() -> Settings:
    return Settings()
