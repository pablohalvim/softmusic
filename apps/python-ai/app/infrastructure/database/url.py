"""Normaliza DATABASE_URL para PyMySQL/aiomysql (SSL via connect_args)."""

from __future__ import annotations

import os
import ssl
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def _truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on", "required"}


def _build_ssl_context(cafile: str | None) -> ssl.SSLContext:
    """TLS para MySQL gerenciado (ex.: DigitalOcean).

    Com CA em disco: verifica a cadeia. Sem CA (caso típico da imagem):
    cifra o canal sem verificar o cert — o CA self-signed da DO não está
    no trust store do container.
    """
    if cafile and os.path.isfile(cafile):
        ctx = ssl.create_default_context(cafile=cafile)
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        return ctx

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def prepare_database_url(database_url: str) -> tuple[str, dict[str, Any]]:
    """Remove ``ssl=…`` / ``ssl_ca=…`` da query e devolve ``connect_args``.

    ``?ssl=true`` na URL vira string e quebra o PyMySQL
    (``AttributeError: 'str' object has no attribute 'get'``).
    """
    parts = urlsplit(database_url)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    kept: list[tuple[str, str]] = []
    wants_ssl = False
    cafile: str | None = None

    for key, value in query_pairs:
        lowered = key.lower()
        if lowered == "ssl":
            wants_ssl = _truthy(value)
            continue
        if lowered in {"ssl_ca", "ssl-ca", "ca"}:
            cafile = value or None
            continue
        kept.append((key, value))

    if not cafile:
        env_ca = os.getenv("MYSQL_SSL_CA", "").strip()
        if env_ca:
            cafile = env_ca
            wants_ssl = True

    clean_url = urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment)
    )
    connect_args: dict[str, Any] = {}
    if wants_ssl:
        connect_args["ssl"] = _build_ssl_context(cafile)
    return clean_url, connect_args
