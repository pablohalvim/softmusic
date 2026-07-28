from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.infrastructure.database.models import PasswordResetCode, RefreshToken, User, UserStatus
from app.infrastructure.security.jwt_tokens import (
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.infrastructure.security.passwords import (
    hash_cpf,
    hash_password,
    is_valid_cnpj,
    is_valid_cpf,
    normalize_cpf,
    verify_password,
)

PASSWORD_RESET_TTL = timedelta(minutes=15)
PASSWORD_RESET_MAX_ATTEMPTS = 5
GENERIC_FORGOT_RESPONSE = {
    "status": "ok",
    "message": "Se o e-mail estiver cadastrado, enviaremos um código de verificação.",
}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def _hash_reset_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode()).hexdigest()


def _generate_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()

    async def register(self, payload: dict[str, Any]) -> dict[str, Any]:
        from app.application.services.band_service import BandService

        is_company = bool(payload.get("is_company"))
        cpf = normalize_cpf(str(payload["cpf"]))
        if is_company:
            if not is_valid_cnpj(cpf):
                raise ValueError("CNPJ inválido")
        elif not is_valid_cpf(cpf):
            raise ValueError("CPF inválido")
        cpf_hash = hash_cpf(cpf, self.settings.cpf_pepper)
        email = str(payload["email"]).strip().lower()
        invite_token = (payload.get("invite_token") or "").strip() or None

        pending_invite = None
        if invite_token:
            band_service = BandService(self.session)
            pending_invite = await band_service.get_pending_invite_by_token(invite_token)
            if pending_invite is None:
                raise ValueError("Convite inválido ou expirado")
            if pending_invite.email != email:
                raise ValueError("Use o mesmo e-mail do convite para se cadastrar")

        existing = await self.session.execute(
            select(User).where(
                or_(User.email == email, User.cpf_hash == cpf_hash),
                User.deleted_at.is_(None),
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError("E-mail ou documento já cadastrado")

        user = User(
            id=_new_id("usr"),
            full_name=str(payload["full_name"]).strip(),
            cpf=cpf,
            cpf_hash=cpf_hash,
            is_company=is_company,
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
            registered_by_admin_id=(
                str(payload["registered_by_admin_id"]).strip()
                if payload.get("registered_by_admin_id")
                else None
            ),
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)

        joined_band = None
        if invite_token:
            joined_band = await BandService(self.session).accept_invite(user, token=invite_token)

        if payload.get("issue_tokens") is False:
            return {"user": self.serialize_user(user)}

        tokens = await self._issue_tokens(user)
        if joined_band is not None:
            tokens["joined_band"] = joined_band
        return tokens

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
        # SPA: não rotaciona o refresh a cada /auth/refresh.
        # Rotação derruba abas/ações concorrentes e força "Não autenticado" no meio da edição.
        return {
            "access_token": create_access_token(user.id),
            "refresh_token": refresh_token,
            "user": self.serialize_user(user),
        }

    async def logout(self, refresh_token: str) -> None:
        token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
        result = await self.session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        stored = result.scalar_one_or_none()
        if stored:
            stored.revoked_at = datetime.now(UTC)
            await self.session.commit()

    async def request_password_reset(self, email: str) -> dict[str, str]:
        from app.application.services.email_service import EmailService

        normalized = email.strip().lower()
        result = await self.session.execute(
            select(User).where(
                User.email == normalized,
                User.deleted_at.is_(None),
                User.status == UserStatus.ACTIVE.value,
            )
        )
        user = result.scalar_one_or_none()
        if user is None:
            return GENERIC_FORGOT_RESPONSE

        now = datetime.now(UTC)
        pending = await self.session.execute(
            select(PasswordResetCode).where(
                PasswordResetCode.user_id == user.id,
                PasswordResetCode.used_at.is_(None),
                PasswordResetCode.expires_at > now,
            )
        )
        for item in pending.scalars().all():
            item.used_at = now

        code = _generate_reset_code()
        self.session.add(
            PasswordResetCode(
                id=_new_id("prc"),
                user_id=user.id,
                email=normalized,
                code_hash=_hash_reset_code(code),
                expires_at=now + PASSWORD_RESET_TTL,
            )
        )
        await self.session.commit()

        sent = EmailService().password_reset_code(normalized, code, user.full_name)
        if not sent:
            raise ValueError("Não foi possível enviar o e-mail. Tente novamente em instantes.")
        return GENERIC_FORGOT_RESPONSE

    async def _get_valid_reset_code(self, email: str, code: str) -> PasswordResetCode:
        normalized = email.strip().lower()
        digits = "".join(ch for ch in code if ch.isdigit())
        if len(digits) != 6:
            raise ValueError("Código inválido")

        now = datetime.now(UTC)
        result = await self.session.execute(
            select(PasswordResetCode)
            .where(
                PasswordResetCode.email == normalized,
                PasswordResetCode.used_at.is_(None),
                PasswordResetCode.expires_at > now,
            )
            .order_by(PasswordResetCode.created_at.desc())
            .limit(1)
        )
        stored = result.scalar_one_or_none()
        if stored is None:
            raise ValueError("Código inválido ou expirado")

        if stored.attempts >= PASSWORD_RESET_MAX_ATTEMPTS:
            stored.used_at = now
            await self.session.commit()
            raise ValueError("Código inválido ou expirado")

        if stored.code_hash != _hash_reset_code(digits):
            stored.attempts += 1
            if stored.attempts >= PASSWORD_RESET_MAX_ATTEMPTS:
                stored.used_at = now
            await self.session.commit()
            raise ValueError("Código inválido ou expirado")

        return stored

    async def verify_password_reset_code(self, email: str, code: str) -> dict[str, str]:
        await self._get_valid_reset_code(email, code)
        return {"status": "ok"}

    async def reset_password(self, email: str, code: str, password: str) -> dict[str, str]:
        stored = await self._get_valid_reset_code(email, code)
        user = await self.get_user(stored.user_id)
        if user is None or user.status != UserStatus.ACTIVE.value:
            raise ValueError("Usuário não encontrado")

        now = datetime.now(UTC)
        user.password_hash = hash_password(password)
        stored.used_at = now
        await self.session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await self.session.commit()
        return {"status": "ok", "message": "Senha atualizada com sucesso"}

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
            "is_company": bool(user.is_company),
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
