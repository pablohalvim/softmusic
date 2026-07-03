from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.infrastructure.database.models import RefreshToken, User, UserStatus
from app.infrastructure.security.jwt_tokens import (
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.infrastructure.security.passwords import hash_cpf, hash_password, normalize_cpf, verify_password


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()

    async def register(self, payload: dict[str, Any]) -> dict[str, Any]:
        cpf = normalize_cpf(str(payload["cpf"]))
        cpf_hash = hash_cpf(cpf, self.settings.cpf_pepper)
        email = str(payload["email"]).strip().lower()

        existing = await self.session.execute(
            select(User).where(
                or_(User.email == email, User.cpf_hash == cpf_hash),
                User.deleted_at.is_(None),
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError("E-mail ou CPF já cadastrado")

        user = User(
            id=_new_id("usr"),
            full_name=str(payload["full_name"]).strip(),
            cpf=cpf,
            cpf_hash=cpf_hash,
            birth_date=date.fromisoformat(str(payload["birth_date"])),
            email=email,
            phone=str(payload["phone"]).strip(),
            address_street=str(payload["address_street"]).strip(),
            address_number=str(payload["address_number"]).strip(),
            address_complement=(
                str(payload["address_complement"]).strip()
                if payload.get("address_complement")
                else None
            ),
            address_neighborhood=str(payload["address_neighborhood"]).strip(),
            address_city=str(payload["address_city"]).strip(),
            address_state=str(payload["address_state"]).strip().upper(),
            address_zip=normalize_cpf(str(payload["address_zip"]))[:8],
            password_hash=hash_password(str(payload["password"])),
            status=UserStatus.ACTIVE.value,
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return await self._issue_tokens(user)

    async def login(self, login: str, password: str) -> dict[str, Any]:
        login_value = login.strip().lower()
        cpf_digits = normalize_cpf(login)
        query = select(User).where(User.deleted_at.is_(None), User.status == UserStatus.ACTIVE.value)
        if "@" in login_value:
            query = query.where(User.email == login_value)
        else:
            query = query.where(User.cpf_hash == hash_cpf(cpf_digits, self.settings.cpf_pepper))

        result = await self.session.execute(query)
        user = result.scalar_one_or_none()
        if user is None or not verify_password(password, user.password_hash):
            raise ValueError("Credenciais inválidas")
        return await self._issue_tokens(user)

    async def refresh(self, refresh_token: str) -> dict[str, Any]:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("Token inválido")
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        result = await self.session.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked_at.is_(None),
            )
        )
        stored = result.scalar_one_or_none()
        if stored is None or stored.expires_at < datetime.now(UTC):
            raise ValueError("Refresh token expirado")

        user = await self.get_user(str(payload["sub"]))
        if user is None:
            raise ValueError("Usuário não encontrado")
        return await self._issue_tokens(user, rotate_from=stored)

    async def logout(self, refresh_token: str) -> None:
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        result = await self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        if stored:
            stored.revoked_at = datetime.now(UTC)
            await self.session.commit()

    async def get_user(self, user_id: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.id == user_id, User.deleted_at.is_(None))
        )
        return result.scalar_one_or_none()

    def serialize_user(self, user: User) -> dict[str, Any]:
        return {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "cpf": user.cpf,
            "phone": user.phone,
            "birth_date": user.birth_date.isoformat(),
            "address": {
                "street": user.address_street,
                "number": user.address_number,
                "complement": user.address_complement,
                "neighborhood": user.address_neighborhood,
                "city": user.address_city,
                "state": user.address_state,
                "zip": user.address_zip,
            },
        }

    async def _issue_tokens(self, user: User, rotate_from: RefreshToken | None = None) -> dict[str, Any]:
        token_id = _new_id("rtk")
        refresh = create_refresh_token(user.id, token_id)
        token_hash = hashlib.sha256(refresh.encode()).hexdigest()
        expires = decode_token(refresh)["exp"]
        if isinstance(expires, int):
            expires_at = datetime.fromtimestamp(expires, tz=UTC)
        else:
            expires_at = datetime.now(UTC)

        if rotate_from:
            rotate_from.revoked_at = datetime.now(UTC)

        self.session.add(
            RefreshToken(
                id=token_id,
                user_id=user.id,
                token_hash=token_hash,
                expires_at=expires_at,
            )
        )
        await self.session.commit()
        return {
            "access_token": create_access_token(user.id),
            "refresh_token": refresh,
            "user": self.serialize_user(user),
        }
