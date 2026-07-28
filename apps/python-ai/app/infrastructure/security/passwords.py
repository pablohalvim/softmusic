from __future__ import annotations

import hashlib
import hmac
import re

import bcrypt


def normalize_cpf(cpf: str) -> str:
    """Normaliza CPF/CNPJ (só dígitos). Mantém o nome por compatibilidade."""
    return re.sub(r"\D", "", cpf)


def hash_cpf(cpf: str, pepper: str) -> str:
    normalized = normalize_cpf(cpf)
    return hmac.new(pepper.encode(), normalized.encode(), hashlib.sha256).hexdigest()


def is_valid_cpf(value: str) -> bool:
    c = normalize_cpf(value)
    if len(c) != 11 or len(set(c)) == 1:
        return False
    total = sum(int(c[i]) * (10 - i) for i in range(9))
    d1 = (total * 10) % 11
    if d1 == 10:
        d1 = 0
    if d1 != int(c[9]):
        return False
    total = sum(int(c[i]) * (11 - i) for i in range(10))
    d2 = (total * 10) % 11
    if d2 == 10:
        d2 = 0
    return d2 == int(c[10])


def is_valid_cnpj(value: str) -> bool:
    c = normalize_cpf(value)
    if len(c) != 14 or len(set(c)) == 1:
        return False
    weights1 = (5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)
    weights2 = (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)
    total = sum(int(c[i]) * weights1[i] for i in range(12))
    d1 = 11 - (total % 11)
    if d1 >= 10:
        d1 = 0
    if d1 != int(c[12]):
        return False
    total = sum(int(c[i]) * weights2[i] for i in range(13))
    d2 = 11 - (total % 11)
    if d2 >= 10:
        d2 = 0
    return d2 == int(c[13])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False
