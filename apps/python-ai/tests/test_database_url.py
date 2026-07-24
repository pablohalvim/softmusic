import ssl

from app.infrastructure.database.url import prepare_database_url


def test_prepare_database_url_strips_ssl_true() -> None:
    url, connect_args = prepare_database_url(
        "mysql+aiomysql://u:p@host:25060/db?ssl=true&charset=utf8mb4"
    )
    assert "ssl=" not in url
    assert "charset=utf8mb4" in url
    assert isinstance(connect_args["ssl"], ssl.SSLContext)


def test_prepare_database_url_without_ssl() -> None:
    raw = "mysql+aiomysql://u:p@host:3306/db"
    url, connect_args = prepare_database_url(raw)
    assert url == raw
    assert connect_args == {}
