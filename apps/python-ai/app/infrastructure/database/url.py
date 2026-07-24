"""Normaliza DATABASE_URL para PyMySQL/aiomysql (SSL via connect_args)."""

from __future__ import annotations

import ssl
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def _truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on", "required"}


def prepare_database_url(database_url: str) -> tuple[str, dict[str, Any]]:
    """Remove ``ssl=…`` da query e devolve ``connect_args`` compatíveis com PyMySQL.

    ``?ssl=true`` na URL vira string e quebra o PyMySQL
    (``AttributeError: 'str' object has no attribute 'get'``).
    """
    parts = urlsplit(database_url)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    kept: list[tuple[str, str]] = []
    wants_ssl = False

    for key, value in query_pairs:
        if key.lower() == "ssl":
            wants_ssl = _truthy(value)
            continue
        kept.append((key, value))

    clean_url = urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment)
    )
    connect_args: dict[str, Any] = {}
    if wants_ssl:
        # SSLContext é aceito pelo PyMySQL; habilita TLS sem certificado cliente.
        connect_args["ssl"] = ssl.create_default_context()
    return clean_url, connect_args
