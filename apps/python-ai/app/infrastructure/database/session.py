from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import TypeVar
import asyncio

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

T = TypeVar("T")


def _build_engine() -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_recycle=3600,
    )


engine = _build_engine()
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def run_with_session(callback: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run async DB work with an isolated engine (safe for Celery prefork + asyncio.run)."""
    task_engine = _build_engine()
    task_session_factory = async_sessionmaker(task_engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with task_session_factory() as session:
            return await callback(session)
    finally:
        await task_engine.dispose()


def run_async_in_worker(callback: Callable[[AsyncSession], Awaitable[T]]) -> T:
    return asyncio.run(run_with_session(callback))


def dispose_engine_after_fork() -> None:
    engine.sync_engine.dispose(close=False)
