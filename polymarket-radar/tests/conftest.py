from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Engine, create_engine, text

from radar.config import Settings
from radar.ingestion.clob import ClobClient
from radar.ingestion.gamma import GammaClient
from radar.ingestion.http import ApiClient
from tests.fakes import FakePolymarket

FIXTURES = Path(__file__).parent / "fixtures"
TEST_DB_URL = os.environ.get("TEST_DATABASE_URL")
PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def real_sample() -> dict[str, Any]:
    """Respuestas REALES capturadas de las APIs (ver _provenance en el archivo)."""
    return json.loads((FIXTURES / "real_sample.json").read_text(encoding="utf-8"))


def make_settings(**overrides: Any) -> Settings:
    base = {
        "database_url": TEST_DB_URL or "postgresql+psycopg://invalid/invalid",
        "http_max_retries": 2,
        "http_backoff_base_s": 0.0,
        "http_backoff_max_s": 0.0,
        "gamma_rate_per_s": 1000.0,
        "clob_rate_per_s": 1000.0,
        "clob_books_batch_size": 200,
        "clob_concurrency": 2,
        "liq_max_spread": 0.05,
        "liq_depth_band": 0.02,
        "liq_min_depth_usd": 100.0,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def make_clients(fake: FakePolymarket, settings: Settings) -> tuple[GammaClient, ClobClient]:
    transport = fake.transport()

    def api(name: str, base: str, rate: float) -> ApiClient:
        return ApiClient(
            base,
            name=name,
            rate_per_s=rate,
            max_retries=settings.http_max_retries,
            backoff_base_s=0.0,
            backoff_max_s=0.0,
            transport=transport,
            sleep=lambda _s: None,
        )

    return (
        GammaClient(api("gamma", "https://gamma.test", 1000.0), page_size=settings.gamma_page_size),
        ClobClient(
            api("clob", "https://clob.test", 1000.0), batch_size=settings.clob_books_batch_size
        ),
    )


@pytest.fixture(scope="session")
def migrated_engine() -> Iterator[Engine]:
    if not TEST_DB_URL:
        pytest.skip("TEST_DATABASE_URL no definida: se omiten pruebas con PostgreSQL")
    from alembic import command
    from alembic.config import Config

    engine = create_engine(TEST_DB_URL)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(PROJECT_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    cfg.attributes["database_url"] = TEST_DB_URL
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    yield engine
    engine.dispose()


TABLES = [
    "paper_trades",
    "forward_instances",
    "valuations",
    "predictions",
    "model_evaluations",
    "prediction_runs",
    "election_alerts",
    "election_estimates",
    "election_runs",
    "election_markets",
    "orderbook_snapshots",
    "market_state",
    "tokens",
    "markets",
    "events",
    "ingestion_errors",
    "ingestion_runs",
]


@pytest.fixture
def engine(migrated_engine: Engine) -> Engine:
    with migrated_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
    return migrated_engine
