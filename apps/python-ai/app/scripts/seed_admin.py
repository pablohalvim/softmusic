"""Seed idempotente de usuário administrador.

Diferente do bootstrap automático (``app.main._bootstrap_admin``), que só cria um
admin quando a tabela está vazia, este script cria OU atualiza um admin pelo
e-mail, podendo ser executado quantas vezes forem necessárias.

Uso (dentro do container ``softmusic-python-ai``):

    python -m app.scripts.seed_admin \
        --email pablohmsfa@gmail.com \
        --password 'Teste@321' \
        --update-password

Sem argumentos, usa ``ADMIN_BOOTSTRAP_EMAIL`` / ``ADMIN_BOOTSTRAP_PASSWORD``.
"""

from __future__ import annotations

import argparse
import asyncio
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.infrastructure.database.models import AdminUser
from app.infrastructure.database.session import run_with_session
from app.infrastructure.security.passwords import hash_password


def _new_admin_id() -> str:
    return f"adm_{secrets.token_hex(8)}"


async def _upsert_admin(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    name: str,
    role: str,
    update_password: bool,
) -> tuple[str, str, str]:
    email = email.strip().lower()
    result = await session.execute(select(AdminUser).where(AdminUser.email == email))
    admin = result.scalar_one_or_none()
    if admin is None:
        admin = AdminUser(
            id=_new_admin_id(),
            email=email,
            password_hash=hash_password(password),
            full_name=name,
            role=role,
            status="active",
        )
        session.add(admin)
        action = "created"
    else:
        admin.full_name = name or admin.full_name
        admin.role = role or admin.role
        admin.status = "active"
        if update_password:
            admin.password_hash = hash_password(password)
        action = "password_updated" if update_password else "unchanged"
    await session.commit()
    return action, admin.id, admin.email


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(
        description="Cria ou atualiza um usuário administrador (idempotente).",
    )
    parser.add_argument("--email", default=settings.admin_bootstrap_email)
    parser.add_argument("--password", default=settings.admin_bootstrap_password)
    parser.add_argument("--name", default=settings.admin_bootstrap_name)
    parser.add_argument("--role", default="superadmin")
    parser.add_argument(
        "--update-password",
        action="store_true",
        help="Redefine a senha caso o admin já exista.",
    )
    args = parser.parse_args()

    if not args.email or not args.password:
        raise SystemExit(
            "Informe --email e --password (ou configure ADMIN_BOOTSTRAP_EMAIL/PASSWORD).",
        )

    action, admin_id, email = asyncio.run(
        run_with_session(
            lambda session: _upsert_admin(
                session,
                email=args.email,
                password=args.password,
                name=args.name,
                role=args.role,
                update_password=args.update_password,
            )
        )
    )
    print(f"[seed_admin] {action}: {email} (id={admin_id}, role={args.role})")


if __name__ == "__main__":
    main()
