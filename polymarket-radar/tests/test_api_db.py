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


def test_prediction_endpoints(client, engine):
    """Corridas de predicción y evaluación SINTÉTICAS: la API las expone tal cual."""
    from datetime import UTC, datetime

    import numpy as np
    from sqlalchemy import insert

    from radar.db.models import PredictionRecord, ValuationRecord
    from radar.predict import metrics as MX
    from radar.predict import service

    c, _ = client
    assert c.get("/api/opportunities").json()["items"] == []
    assert c.get("/api/predict/quality").json()["run"] is None

    now = datetime(2026, 10, 26, 12, tzinfo=UTC)
    live = service.start_run(engine, "live")
    with engine.begin() as conn:
        pid = conn.execute(
            insert(PredictionRecord)
            .values(run_id=live, market_id="m1", outcome="Yes", model="cripto-rv",
                    model_version="t", family="cripto", as_of=now, created_at=now,
                    probability=0.7, p_low=0.6, p_high=0.8, calibration_status="sin_evaluar",
                    data_used=[], details={"origen": "SINTÉTICO"}, inputs_sha256="0" * 64)
            .returning(PredictionRecord.id)
        ).scalar_one()  # fmt: skip
        for outcome, edge, rec in (
            ("Yes", 20.0, "alerta_investigacion"),
            ("No", -20.0, "sin_ventaja"),
        ):
            conn.execute(
                insert(ValuationRecord).values(
                    run_id=live, prediction_id=pid, market_id="m1", token_id=f"t-{outcome}",
                    outcome=outcome, question="¿SINTÉTICO?", category="crypto",
                    variant="daily_above", as_of=now, model="cripto-rv",
                    calibration_status="sin_evaluar", edge_pp=edge, recommendation=rec,
                    reasons=["modelo no validado"], version="valuation-v1",
                )
            )  # fmt: skip
    service.finish_run(engine, live, "success", {"crypto": {"recomendaciones": {}}})

    rng = np.random.default_rng(0)
    p = rng.uniform(0, 1, 300)
    y = (rng.uniform(0, 1, 300) < p).astype(float)
    cl = [f"d{i % 30}" for i in range(300)]
    summ = MX.summarize(p, y, cl, n_boot=50) | {
        "status": "no_validado",
        "validation_failures": ["SINTÉTICO"],
        "supera_mercado": False,
        "vs_market": {"log_loss_diff": {"value": 0.01, "lo": -0.01, "hi": 0.03}},
    }
    report = {
        "version": "crypto-backtest-v1",
        "reference_by_variant": {"daily_above": {"reference": "rv"}},
        "test": {"by_variant": {"daily_above": {"market": MX.summarize(p, y, cl, n_boot=50),
                                                "models": {"rv": summ}}}},
    }  # fmt: skip
    bt = service.start_run(engine, "backtest")
    assert service.persist_evaluations(engine, bt, report) == 2
    service.finish_run(engine, bt, "success", {"validados": []})

    s = c.get("/api/predict/summary").json()
    assert s["live"]["run_id"] == live and s["backtest"]["run_id"] == bt
    opp = c.get("/api/opportunities").json()
    assert [i["outcome"] for i in opp["items"]] == ["Yes", "No"]  # ordenado por diferencia
    only = c.get("/api/opportunities", params={"recommendation": "alerta_investigacion"}).json()
    assert len(only["items"]) == 1 and only["items"][0]["url"] is None
    q = c.get("/api/predict/quality").json()
    models = {i["model"]: i for i in q["items"]}
    assert set(models) == {"cripto-rv", service.MARKET_MODEL}
    assert models["cripto-rv"]["is_reference"] and models["cripto-rv"]["n"] == 300
    assert len(models["cripto-rv"]["bins"]) == 10
    preds = c.get("/api/markets/m1/predictions").json()
    assert preds[0]["probability"] == 0.7 and preds[0]["details"]["origen"] == "SINTÉTICO"
