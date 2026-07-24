import ssl

from app.infrastructure.database.url import _build_ssl_context, prepare_database_url


def test_prepare_database_url_strips_ssl_true() -> None:
    url, connect_args = prepare_database_url(
        "mysql+aiomysql://u:p@host:25060/db?ssl=true&charset=utf8mb4"
    )
    assert "ssl=" not in url
    assert "charset=utf8mb4" in url
    ctx = connect_args["ssl"]
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_NONE
    assert ctx.check_hostname is False


def test_prepare_database_url_strips_ssl_ca_query() -> None:
    url, connect_args = prepare_database_url(
        "mysql+aiomysql://u:p@host:25060/db?ssl=true&ssl_ca=/certs/missing.crt"
    )
    assert "ssl_ca=" not in url
    assert "ssl=" not in url
    # CA ausente → mesmo modo encrypt-only (não quebra o boot).
    assert connect_args["ssl"].verify_mode == ssl.CERT_NONE


def test_build_ssl_context_without_ca() -> None:
    ctx = _build_ssl_context(None)
    assert ctx.verify_mode == ssl.CERT_NONE
    assert ctx.check_hostname is False


def test_prepare_database_url_without_ssl() -> None:
    raw = "mysql+aiomysql://u:p@host:3306/db"
    url, connect_args = prepare_database_url(raw)
    assert url == raw
    assert connect_args == {}
