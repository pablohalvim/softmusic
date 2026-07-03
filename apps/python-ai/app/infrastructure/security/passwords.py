from __future__ import annotations

import hashlib
import hmac
import re

import bcrypt


def normalize_cpf(cpf: str) -> str:
    return re.sub(r"\D", "", cpf)


def hash_cpf(cpf: str, pepper: str) -> str:
    normalized = normalize_cpf(cpf)
    return hmac.new(pepper.encode(), normalized.encode(), hashlib.sha256).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False
