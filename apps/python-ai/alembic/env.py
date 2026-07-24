from alembic import context
from sqlalchemy import create_engine, pool

from app.config import get_settings
from app.infrastructure.database.models import Base
from app.infrastructure.database.url import prepare_database_url

config = context.config
settings = get_settings()
sync_url, connect_args = prepare_database_url(
    settings.database_url.replace("+aiomysql", "+pymysql")
)
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        sync_url,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
