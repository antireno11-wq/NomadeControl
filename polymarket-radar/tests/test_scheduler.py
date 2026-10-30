"""El programador registra la ingesta, la poda y, si está activa, la predicción en vivo."""

from __future__ import annotations

from typing import Any

import radar.scheduler as sched
from tests.conftest import make_settings


class FakeScheduler:
    def __init__(self, **_kw: Any) -> None:
        self.jobs: list[str] = []
        FakeScheduler.last = self

    def add_job(self, fn: Any, trigger: Any, **kw: Any) -> None:
        self.jobs.append(kw["id"])

    def start(self) -> None:
        raise KeyboardInterrupt


def test_jobs_registered(monkeypatch: Any) -> None:
    monkeypatch.setattr(sched, "BlockingScheduler", FakeScheduler)
    sched.run_scheduler(make_settings(predict_interval_minutes=30))
    assert FakeScheduler.last.jobs == ["ingestion", "retention", "predict_live"]
    sched.run_scheduler(make_settings(predict_interval_minutes=0))
    assert FakeScheduler.last.jobs == ["ingestion", "retention"]


def test_predict_job_never_raises(monkeypatch: Any) -> None:
    import radar.predict.service as svc

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("fallo SINTÉTICO")

    monkeypatch.setattr(svc, "predict_live", boom)
    monkeypatch.setattr(sched, "get_engine", lambda _url: None)
    sched.predict_job(make_settings())  # registra el error y sigue


def test_retention_job_never_raises(monkeypatch: Any) -> None:
    import radar.retention as ret

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("disco lleno SINTÉTICO")

    monkeypatch.setattr(ret, "prune", boom)
    monkeypatch.setattr(sched, "get_engine", lambda _url: None)
    sched.retention_job(make_settings())  # registra el error y sigue
