from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.auth_service import AuthService
from app.infrastructure.database.models import AdminUser, User
from app.infrastructure.database.session import get_session
from app.infrastructure.security.jwt_tokens import decode_token


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Não autenticado")
    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Token inválido") from exc
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Token inválido")
    auth = AuthService(session)
    user = await auth.get_user(str(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    return user


async def get_current_admin(
    authorization: Annotated[str | None, Header()] = None,
    session: AsyncSession = Depends(get_session),
) -> AdminUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Não autenticado")
    token = authorization.split(" ", 1)[1]
    try:
        payload = decode_token(token, admin=True)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Token inválido") from exc
    if payload.get("type") != "admin_access":
        raise HTTPException(status_code=401, detail="Token inválido")
    from sqlalchemy import select

    result = await session.execute(
        select(AdminUser).where(AdminUser.id == str(payload["sub"]), AdminUser.status == "active")
    )
    admin = result.scalar_one_or_none()
    if admin is None:
        raise HTTPException(status_code=401, detail="Admin não encontrado")
    return admin


def get_band_id(x_band_id: Annotated[str | None, Header(alias="X-Band-Id")] = None) -> str | None:
    return x_band_id
