"""Posição na fila de análise."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.application.services.analysis_service import AnalysisService
from app.infrastructure.database.models import JobStatus


def _job(*, job_id: str, created_at: datetime, status: str = JobStatus.QUEUED.value):
    return SimpleNamespace(id=job_id, status=status, created_at=created_at)


@pytest.mark.asyncio
async def test_queue_position_counts_jobs_ahead() -> None:
    session = MagicMock()
    service = AnalysisService(session)
    now = datetime.now(UTC)
    job = _job(job_id="job_b", created_at=now)

    # 1º execute → total queued = 3; 2º → ahead = 1
    total_result = MagicMock()
    total_result.scalar_one.return_value = 3
    ahead_result = MagicMock()
    ahead_result.scalar_one.return_value = 1
    session.execute = AsyncMock(side_effect=[total_result, ahead_result])

    info = await service.get_queue_position(job)
    assert info == {"position": 2, "total": 3}


@pytest.mark.asyncio
async def test_queue_position_none_when_not_queued() -> None:
    session = MagicMock()
    service = AnalysisService(session)
    job = _job(
        job_id="job_x",
        created_at=datetime.now(UTC),
        status=JobStatus.PROCESSING.value,
    )
    assert await service.get_queue_position(job) is None


@pytest.mark.asyncio
async def test_queue_position_first_in_line() -> None:
    session = MagicMock()
    service = AnalysisService(session)
    job = _job(job_id="job_a", created_at=datetime.now(UTC) - timedelta(minutes=1))

    total_result = MagicMock()
    total_result.scalar_one.return_value = 1
    ahead_result = MagicMock()
    ahead_result.scalar_one.return_value = 0
    session.execute = AsyncMock(side_effect=[total_result, ahead_result])

    info = await service.get_queue_position(job)
    assert info == {"position": 1, "total": 1}
