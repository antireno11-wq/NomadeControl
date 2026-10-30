"""Evaluación en vivo (forward-v1) y cartera de papel (paper-v1), con datos SINTÉTICOS."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import Engine, insert, select
from sqlalchemy.orm import Session

from radar.db.models import (
    Event,
    ForwardInstance,
    Market,
    ModelEvaluation,
    PaperTrade,
    PredictionRecord,
    PredictionRun,
    ValuationRecord,
)
from radar.predict import forward
from radar.predict.valuation import REC_NONE, REC_SIGNAL

R = datetime(2026, 10, 27, 15, tzinfo=UTC)  # resolución de los mercados sintéticos


def test_instance_moments_use_the_preregistered_schedule() -> None:
    # una predicción sirve a cada momento d con 0 ≤ tau − d ≤ 40 min
    assert forward.instance_moments("hourly_above", 62) == [(60, 2), (45, 17), (30, 32)]
    assert forward.instance_moments("hourly_above", 50) == [(45, 5), (30, 20), (15, 35)]
    assert forward.instance_moments("hourly_above", 70) == [(60, 10), (45, 25), (30, 40)]
    assert forward.instance_moments("hourly_above", 3) == []
    assert forward.instance_moments("variante_desconocida", 60) == []


def test_final_prices_only_accepts_official_resolution() -> None:
    assert forward.final_prices([0, 1], "resolved") == [0.0, 1.0]
    assert forward.final_prices(["0.5", "0.5"], "resolved") == [0.5, 0.5]
    assert forward.final_prices([0.98, 0.02], "resolved") is None
    assert forward.final_prices([0, 1], "proposed") is None
    assert forward.final_prices([], "resolved") is None


def add_market(s: Session, mid: str, *, resolved: bool, end: datetime = R) -> None:
    s.add(Event(id=f"e{mid}", title=mid, category="crypto", first_seen_at=R, last_seen_at=R))
    s.flush()
    s.add(
        Market(
            id=mid, event_id=f"e{mid}", question=f"¿{mid}?", outcomes=["Yes", "No"],
            clob_token_ids=[f"{mid}-yes", f"{mid}-no"], end_date=end, active=True,
            closed=resolved, archived=False, accepting_orders=not resolved,
            enable_order_book=True, neg_risk=False, rules_hash="sintetico",
            uma_resolution_status="resolved" if resolved else None,
            gamma_outcome_prices=[0.0, 1.0] if resolved else [0.4, 0.6],
            first_seen_at=R, last_seen_at=R, raw={}, raw_received_at=R,
        )
    )  # fmt: skip


def add_run(s: Session, as_of: datetime) -> int:
    run = PredictionRun(kind="live", started_at=as_of, finished_at=as_of, status="success")
    s.add(run)
    s.flush()
    return run.id


def add_prediction(s: Session, run_id: int, mid: str, as_of: datetime, p: float) -> int:
    tau = (R - as_of).total_seconds() / 60
    rec = PredictionRecord(
        run_id=run_id, market_id=mid, outcome="Yes", model="cripto-rv", model_version="t",
        family="cripto", as_of=as_of, created_at=as_of, probability=p, p_low=p - 0.05,
        p_high=p + 0.05, calibration_status="validado", data_used=[],
        details={"terms": {"variant": "hourly_above", "asset": "BTC"}, "tau_min": tau},
        inputs_sha256="0" * 64,
    )  # fmt: skip
    s.add(rec)
    s.flush()
    return rec.id


def valuation(run_id: int, pred_id: int, mid: str, outcome: str, **kw: Any) -> dict[str, Any]:
    base = {
        "run_id": run_id, "prediction_id": pred_id, "market_id": mid,
        "token_id": f"{mid}-{outcome.lower()}", "outcome": outcome, "question": f"¿{mid}?",
        "category": "crypto", "variant": "hourly_above", "end_date": R, "as_of": kw["as_of"],
        "model": "cripto-rv", "calibration_status": "validado", "p_market_mid": 0.3,
        "recommendation": REC_NONE, "reasons": [], "version": "valuation-v1",
    }  # fmt: skip
    return base | kw


@pytest.mark.db
def test_capture_resolve_paper_and_evaluate(engine: Engine) -> None:
    a, b = R - timedelta(minutes=70), R - timedelta(minutes=62)
    with Session(engine) as s:
        add_market(s, "m1", resolved=True)
        ra, rb = add_run(s, a), add_run(s, b)
        pa = add_prediction(s, ra, "m1", a, 0.25)
        pb = add_prediction(s, rb, "m1", b, 0.20)
        s.execute(
            insert(ValuationRecord),
            [
                valuation(ra, pa, "m1", "Yes", as_of=a),
                valuation(rb, pb, "m1", "Yes", as_of=b),
                valuation(rb, pb, "m1", "No", as_of=b, recommendation=REC_SIGNAL,
                          ask_vwap=0.8, fill_shares=31.25, fee_per_share=0.0, p_model=0.8),
            ],
        )  # fmt: skip
        s.commit()

    forward.capture(engine)
    with Session(engine) as s:
        inst = s.scalars(select(ForwardInstance).order_by(ForwardInstance.moment_min)).all()
    # la corrida b (más cercana a cada momento) reemplaza a la a en los tres
    assert [(i.moment_min, i.prediction_id) for i in inst] == [(30, pb), (45, pb), (60, pb)]
    assert inst[0].p_market == pytest.approx(0.3) and inst[0].cluster == "BTC|2026-10-27"
    assert forward.capture(engine)["instancias_vistas"] == 3  # idempotente

    assert forward.open_paper(engine) == {"abiertas": 1, "omitidas_por_exposicion": 0}
    assert forward.open_paper(engine)["abiertas"] == 0  # una posición por mercado y resultado

    out = forward.resolve(engine, None, now=R + timedelta(minutes=10))
    assert out["instancias_completadas"] == 3 and out["posiciones_cerradas"] == 1
    with Session(engine) as s:
        trade = s.scalars(select(PaperTrade)).one()
        assert {i.y for i in s.scalars(select(ForwardInstance))} == {0.0}
    assert trade.status == "ganada"
    assert trade.pnl_usd == pytest.approx(31.25 - 25.0)
    assert trade.v2_status == "ganada"  # paper-v2 no la vendió: termina igual que paper-v1
    assert trade.v2_pnl_usd == pytest.approx(trade.pnl_usd)

    ev = forward.evaluate(engine, n_boot=20)
    assert ev["instancias"] == 1  # una predicción que sirve a varios momentos cuenta una vez
    with Session(engine) as s:
        row = s.scalars(select(ModelEvaluation)).one()
    assert (row.backtest_version, row.split, row.n) == ("forward-v1", "vivo", 1)
    assert row.status == "no_validado" and "n=1 < 200" in row.failures


@pytest.mark.db
def test_paper_respects_max_exposure(engine: Engine) -> None:
    t = R - timedelta(hours=2)
    with Session(engine) as s:
        run = add_run(s, t)
        rows = []
        for k in range(13):
            add_market(s, f"x{k}", resolved=False, end=R)
            pid = add_prediction(s, run, f"x{k}", t, 0.5)
            rows.append(valuation(run, pid, f"x{k}", "Yes", as_of=t, recommendation=REC_SIGNAL,
                                  ask_vwap=0.5, fill_shares=50.0, fee_per_share=0.0))  # fmt: skip
        s.execute(insert(ValuationRecord), rows)
        s.commit()
    # 12 × US$25 = US$300 de exposición máxima; la 13.ª no se abre
    assert forward.open_paper(engine) == {"abiertas": 12, "omitidas_por_exposicion": 1}


@pytest.mark.db
def test_suspended_pairs_come_from_the_last_live_evaluation(engine: Engine) -> None:
    from radar.predict.service import start_run

    def ev(run_id: int, lo: float, n: int) -> dict[str, Any]:
        return {
            "run_id": run_id, "created_at": R, "backtest_version": "forward-v1",
            "family": "cripto", "model": "cripto-rv", "variant": "hourly_above", "split": "vivo",
            "n": n, "n_clusters": 25, "brier": 0.1, "log_loss": 0.3, "ece": 0.01,
            "calib_in_large": 0.0, "vs_market_ll_lo": lo, "is_reference": False,
            "status": "no_validado", "failures": [], "bins": [],
        }  # fmt: skip

    assert forward.suspended_pairs(engine) == set()
    first = start_run(engine, "forward")
    with engine.begin() as conn:
        conn.execute(insert(ModelEvaluation), [ev(first, 0.01, 300)])
    assert forward.suspended_pairs(engine) == {"cripto-rv|hourly_above"}
    second = start_run(engine, "forward")
    with engine.begin() as conn:
        conn.execute(insert(ModelEvaluation), [ev(second, 0.01, 150)])  # n insuficiente
    assert forward.suspended_pairs(engine) == set()


@pytest.mark.db
def test_prune_only_removes_old_live_runs_already_captured(engine: Engine) -> None:
    from radar.retention import prune

    now = R + timedelta(days=5)
    with Session(engine) as s:
        old = add_run(s, R - timedelta(days=3))
        old_pending = add_run(s, R - timedelta(days=3))  # todavía sin capturar
        recent = add_run(s, now - timedelta(hours=1))
        for run in (old, old_pending, recent):
            add_prediction(s, run, "m1", R - timedelta(hours=1), 0.5)
        s.commit()
    with engine.begin() as conn:
        conn.execute(
            insert(ForwardInstance),
            [{"market_id": "m1", "model": "cripto-rv", "family": "cripto",
              "variant": "hourly_above", "moment_min": 60, "gap_min": 0.0, "prediction_id": 1,
              "run_id": old_pending, "outcome": "Yes", "as_of": R, "resolution_time": R,
              "cluster": "BTC|2026-10-27", "p_model": 0.5}],
        )  # fmt: skip
    out = prune(engine, live_days=2, snapshot_days=2, now=now)
    assert out["corridas_en_vivo_borradas"] == 1
    with Session(engine) as s:
        left = set(s.scalars(select(PredictionRun.id)))
        assert left == {old_pending, recent}
        assert s.scalars(select(PredictionRecord.run_id).distinct()).all()  # cascada parcial


@pytest.mark.db
def test_paper_v2_sells_when_the_bid_reaches_the_radar_value(engine: Engine) -> None:
    t0 = R - timedelta(hours=3)
    with Session(engine) as s:
        add_market(s, "m1", resolved=True)  # resolvió "No"
        runs = [add_run(s, t0 + timedelta(minutes=30 * k)) for k in range(4)]
        pids = [add_prediction(s, r, "m1", t0 + timedelta(minutes=30 * k), 0.5)
                for k, r in enumerate(runs)]  # fmt: skip

        def quote(k: int, bid: float, p: float, **kw: Any) -> dict[str, Any]:
            return valuation(runs[k], pids[k], "m1", "No", as_of=t0 + timedelta(minutes=30 * k),
                             p_model=p, sell_vwap=bid, sell_fee_per_share=0.01,
                             sell_complete=True, book_age_s=1.0) | kw  # fmt: skip

        s.execute(
            insert(ValuationRecord),
            [
                valuation(runs[0], pids[0], "m1", "No", as_of=t0, recommendation=REC_SIGNAL,
                          ask_vwap=0.6, fill_shares=40.0, fee_per_share=0.0, p_model=0.8),
                quote(1, 0.70, 0.80),  # pagan menos de lo que vale: se mantiene
                quote(2, 0.84, 0.82, sell_complete=False),  # el libro no alcanza
                quote(3, 0.84, 0.82),  # 0,84 − 0,01 ≥ 0,82: vende
            ],
        )  # fmt: skip
        s.commit()
    forward.open_paper(engine)
    assert forward.sell_early(engine) == {"vendidas": 1, "precios_revisados": 3}
    with Session(engine) as s:
        t = s.scalars(select(PaperTrade)).one()
    assert (t.status, t.v2_status, t.v2_exit_price) == ("abierta", "vendida", 0.84)
    assert t.v2_pnl_usd == pytest.approx(40 * (0.84 - 0.01) - 24.0)
    forward.resolve(engine, None, now=R + timedelta(minutes=10))
    with Session(engine) as s:
        t = s.scalars(select(PaperTrade)).one()
    assert (t.status, t.v2_status) == ("ganada", "vendida")  # la venta no se pisa
    assert t.pnl_usd == pytest.approx(40 - 24.0)
