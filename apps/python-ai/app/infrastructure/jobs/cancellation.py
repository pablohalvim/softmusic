from __future__ import annotations

import redis

from app.config import get_settings

_CANCEL_PREFIX = "softmusic:cancel:"


def _client() -> redis.Redis:
    return redis.from_url(get_settings().redis_url)


def request_cancel(job_id: str) -> None:
    _client().setex(f"{_CANCEL_PREFIX}{job_id}", 3600, "1")


def is_cancelled(job_id: str) -> bool:
    return _client().get(f"{_CANCEL_PREFIX}{job_id}") is not None


def clear_cancel(job_id: str) -> None:
    _client().delete(f"{_CANCEL_PREFIX}{job_id}")
