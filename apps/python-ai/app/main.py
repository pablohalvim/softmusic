from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import select, text

from app.config import get_settings
from app.infrastructure.database.models import AdminUser
from app.infrastructure.database.session import SessionLocal, engine
from app.infrastructure.security.passwords import hash_password
from app.logging import configure_logging
from app.presentation.api.router import router as internal_router
from app.presentation.api.saas_router import router as saas_router


async def _bootstrap_admin() -> None:
    settings = get_settings()
    if not settings.admin_bootstrap_email or not settings.admin_bootstrap_password:
        return
    async with SessionLocal() as session:
        result = await session.execute(select(AdminUser).limit(1))
        if result.scalar_one_or_none() is not None:
            return
        admin = AdminUser(
            id="adm_bootstrap",
            email=settings.admin_bootstrap_email.strip().lower(),
            password_hash=hash_password(settings.admin_bootstrap_password),
            full_name=settings.admin_bootstrap_name,
            role="superadmin",
            status="active",
        )
        session.add(admin)
        await session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging(get_settings().log_level)
    await _bootstrap_admin()
    yield
    await engine.dispose()


app = FastAPI(
    title="SoftMusic AI",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(internal_router)
app.include_router(saas_router)


@app.get("/health")
async def health() -> dict[str, str]:
    from app.infrastructure.ml.device import device_info_as_dict

    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    gpu = device_info_as_dict()
    return {
        "status": "healthy",
        "service": "python-ai",
        "gpu_available": str(gpu["available"]).lower(),
        "gpu_device": gpu["device_name"] or "",
        "gpu_backend": gpu["backend"],
    }


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
