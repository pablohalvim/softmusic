from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.config import get_settings


def _parse_duration(value: str, default_minutes: int) -> timedelta:
    value = value.strip().lower()
    if value.endswith("m"):
        return timedelta(minutes=int(value[:-1] or default_minutes))
    if value.endswith("h"):
        return timedelta(hours=int(value[:-1] or 1))
    if value.endswith("d"):
        return timedelta(days=int(value[:-1] or 1))
    return timedelta(minutes=default_minutes)


def create_access_token(user_id: str, *, admin: bool = False) -> str:
    settings = get_settings()
    key = settings.admin_jwt_private_key if admin else settings.jwt_private_key
    expires = _parse_duration(settings.jwt_access_expires_in, 15)
    payload = {
        "sub": user_id,
        "type": "admin_access" if admin else "access",
        "exp": datetime.now(UTC) + expires,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, token_id: str) -> str:
    settings = get_settings()
    expires = _parse_duration(settings.jwt_refresh_expires_in, 60 * 24 * 7)
    payload = {
        "sub": user_id,
        "tid": token_id,
        "type": "refresh",
        "exp": datetime.now(UTC) + expires,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, settings.jwt_private_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, *, admin: bool = False) -> dict[str, Any]:
    settings = get_settings()
    key = settings.admin_jwt_private_key if admin else settings.jwt_private_key
    return jwt.decode(token, key, algorithms=[settings.jwt_algorithm])
