"""v2 en la evaluación en vivo: variables del libro y comparación con v1 (SINTÉTICO)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import Engine, insert, select
from sqlalchemy.orm import Session

from radar.db.models import ForwardInstance, PredictionRecord, PredictionRun
from radar.predict import forward
from tests.conftest import make_settings
from tests.test_forward import R, add_market, add_run


@pytest.mark.db
def test_capture_copies_the_book_features(engine: Engine) -> None:
    as_of = R - timedelta(minutes=62)
    feats = {"mid": 0.42, "spread": 0.04, "desequilibrio": 0.3, "cambio_mid": None}
    with Session(engine) as s:
        add_market(s, "m1", resolved=False)
        run = add_run(s, as_of)
        s.add(
            PredictionRecord(
                run_id=run, market_id="m1", outcome="Yes", model="cripto2-mezcla",
                model_version="crypto-models-v2", family="cripto", as_of=as_of, created_at=as_of,
                probability=0.45, p_low=0.45, p_high=0.45, calibration_status="no_evaluado",
                data_used=[], inputs_sha256="0" * 64,
                details={"terms": {"variant": "hourly_above", "asset": "BTC"},
                         "tau_min": 62.0, "features": feats},
            )
        )  # fmt: skip
        s.commit()
    forward.capture(engine)
    with Session(engine) as s:
        got = s.scalars(select(ForwardInstance.features)).all()
    assert got and all(g == feats for g in got)  # una por cada momento al que sirve


@pytest.mark.db
def test_compare_v2_pairs_each_v2_instance_with_the_v1_reference(engine: Engine) -> None:
    rows = []
    for i in range(40):
        y = float(i % 2)
        for model, p in (("cripto2-vol", 0.8 if y else 0.2), ("cripto-ewma", 0.6 if y else 0.4)):
            rows.append(
                {"market_id": f"m{i}", "model": model, "family": "cripto",
                 "variant": "hourly_above", "moment_min": 60, "gap_min": 1.0,
                 "prediction_id": i * 10 + (model == "cripto-ewma"), "run_id": 1,
                 "outcome": "Yes", "as_of": R, "resolution_time": R,
                 "cluster": f"BTC|d{i % 25}", "p_model": p, "p_market": 0.5, "y": y}
            )  # fmt: skip
    with engine.begin() as conn:
        conn.execute(insert(ForwardInstance), rows)
    out = forward.compare_v2(make_settings(), engine, n_boot=100)
    res = out["pares"]["cripto2-vol|hourly_above"]
    assert res["referencia_v1"] == "cripto-ewma"  # data/models/crypto_calibration.json
    assert res["vs_v1"]["n"] == 40 and res["supera_v1"] is True
    assert res["supera_mercado"] is True
    assert "cripto-ewma|hourly_above" not in out["pares"]  # solo modelos v2
    with Session(engine) as s:
        assert (
            s.scalars(select(PredictionRun.kind).where(PredictionRun.id == out["run_id"])).one()
            == "forward-v2"
        )
