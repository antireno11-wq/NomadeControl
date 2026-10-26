"""API FastAPI contra PostgreSQL con datos SINTÉTICOS."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from radar.api.main import app
from radar.config import get_settings
from radar.ingestion.pipeline import IngestionPipeline
from tests.conftest import make_clients, make_settings
from tests.test_pipeline_db import scenario

pytestmark = pytest.mark.db


@pytest.fixture
def client(engine):
    settings = make_settings()
    app.dependency_overrides[get_settings] = lambda: settings
    import radar.api.main as main_mod

    original = main_mod.get_settings
    main_mod.get_settings = lambda: settings  # usado por get_session
    yield TestClient(app), settings
    main_mod.get_settings = original
    app.dependency_overrides.clear()


def ingest(engine, settings):
    fake = scenario()
    gamma, clob = make_clients(fake, settings)
    return IngestionPipeline(
        engine,
        settings.model_copy(update={"gamma_page_size": 4}),
        gamma,
        clob,
        trigger="test",
        data_origin="synthetic",
    ).run()


def test_health_declares_paper_only(client):
    c, _ = client
    body = c.get("/api/health").json()
    assert body["database"] == "ok"
    assert body["trading_mode"] == "paper_only"
    assert body["real_trading_enabled"] is False


def test_status_without_data_says_so(client):
    c, _ = client
    body = c.get("/api/status").json()
    assert body["data_mode"] == "sin_datos"
    assert body["last_run"] is None


def test_endpoints_after_synthetic_run(client, engine):
    c, settings = client
    run_id = ingest(engine, settings)

    status = c.get("/api/status").json()
    assert status["data_mode"] == "demo_sintetica"
    assert status["last_run"]["id"] == run_id
    assert status["last_run"]["markets_discovered"] == 6
    assert status["sources"]["polymarket_clob"]["errors_last_run"] == 1
    assert status["modules"]["arbitraje"].startswith("pendiente")

    liquid = c.get("/api/markets").json()
    assert liquid["total"] == 2
    assert {m["id"] for m in liquid["items"]} == {"m1", "m2"}
    assert all(m["data_origin"] == "synthetic" for m in liquid["items"])
    assert liquid["items"][0]["url"] == "https://polymarket.com/event/synthetic-event-e1"

    every = c.get("/api/markets", params={"liquid_only": False}).json()
    assert every["total"] == 4
    assert (
        c.get("/api/markets", params={"category": "sports", "liquid_only": False}).json()["total"]
        == 2
    )
    assert c.get("/api/markets", params={"search": "m3", "liquid_only": False}).json()["total"] == 1

    detail = c.get("/api/markets/m1").json()
    assert detail["rules"].startswith("SINTÉTICO")
    assert detail["gamma_indicative"]["_nota"].startswith("Valores informados por Gamma")
    assert detail["state"]["liquid"] is True
    tok = detail["tokens"][0]
    assert tok["outcome"] == "Yes"
    assert tok["latest_snapshot"]["bids"][0]["price"] == 0.49
    assert tok["latest_snapshot"]["source_ts"] is not None

    snaps = c.get("/api/markets/m1/snapshots", params={"token_id": "m1-yes"}).json()
    assert len(snaps) == 1 and snaps[0]["best_ask"] == 0.51

    runs = c.get("/api/runs").json()
    assert runs[0]["id"] == run_id and runs[0]["book_coverage"] == pytest.approx(7 / 8)
    errors = c.get(f"/api/runs/{run_id}/errors").json()
    assert {e["error_type"] for e in errors} == {"invalid_market", "book_missing"}
    cats = c.get("/api/categories").json()
    assert {x["category"]: x["analyzed"] for x in cats} == {"crypto": 2, "sports": 2}


def test_not_found(client):
    c, _ = client
    assert c.get("/api/markets/nope").status_code == 404
    assert c.get("/api/runs/999").status_code == 404
    assert c.get("/api/runs/999/errors").status_code == 404
    assert c.get("/api/markets", params={"sort": "drop table"}).status_code == 422


def test_status_reports_run_in_progress_separately(client, engine):
    c, settings = client
    ingest(engine, settings)
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO ingestion_runs (trigger, status, data_origin, started_at, "
                "discovery_complete, gamma_pages, events_discovered, markets_discovered, "
                "markets_duplicated, markets_invalid, markets_new, markets_rules_changed, "
                "markets_closed_detected, markets_missing_from_source, markets_eligible, "
                "tokens_requested, clob_requests, books_ok, books_missing, books_invalid, "
                "books_failed, markets_analyzed, markets_liquid, snapshots_inserted, "
                "snapshots_unchanged, errors_count, eligibility_breakdown, liquidity_breakdown, "
                "stage_timings_s, config, notes) VALUES ('test','running','synthetic', now(), "
                "false,7,0,700,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,'{}','{}','{}','{}','[]')"
            )
        )
    body = c.get("/api/status").json()
    assert body["run_in_progress"]["markets_discovered"] == 700
    assert body["last_run"]["status"] == "partial"
    assert body["last_run"]["markets_discovered"] == 6


def test_election_endpoints(client, engine, tmp_path):
    import json
    from datetime import UTC, datetime

    from sqlalchemy import insert

    from radar.db.models import ElectionAlert, ElectionRun

    c, _ = client
    assert c.get("/api/elections/backtest").status_code == 404
    report = tmp_path / "backtest_x.md"
    report.write_text("# x")
    (tmp_path / "backtest_x.json").write_text(json.dumps({"timeline": [], "creado": "SINTÉTICO"}))
    now = datetime(2026, 10, 26, tzinfo=UTC)
    with engine.begin() as conn:
        run_id = conn.execute(
            insert(ElectionRun)
            .values(
                kind="backtest",
                mode="backtest_retrospectivo",
                contest_key="x",
                started_at=now,
                finished_at=now,
                status="success",
                summary={"validacion": "no_validado"},
                report_path=str(report),
            )
            .returning(ElectionRun.id)
        ).scalar_one()
        conn.execute(
            insert(ElectionAlert).values(
                run_id=run_id,
                mode="backtest_retrospectivo",
                kind="investigacion",
                contest_key="x",
                market_id="m",
                token_id="t",
                label="SINTÉTICO YES",
                as_of=now,
                created_at=now,
                price=0.2,
                price_basis="precio_referencia_no_ejecutable",
                reference_prob=0.3,
                discrepancy_pp=10.0,
                conservative_edge_pp=-1.0,
                signal=False,
                gating=["modelo no validado"],
                ledger_path="x",
                ledger_seq=1,
                sha256="a" * 64,
                prev_sha256="0" * 64,
            )
        )
    summary = c.get("/api/elections/summary").json()
    assert summary["backtest"]["summary"]["validacion"] == "no_validado"
    assert summary["discover"] is None
    assert c.get("/api/elections/backtest").json()["creado"] == "SINTÉTICO"
    alerts = c.get("/api/elections/alerts", params={"mode": "backtest_retrospectivo"}).json()
    assert len(alerts) == 1 and alerts[0]["signal"] is False and alerts[0]["sha256"] == "a" * 64
    assert c.get("/api/elections/evaluation").status_code == 404
