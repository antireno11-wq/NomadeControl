"""Modelos cripto v2 (docs/PREREGISTRO_CRIPTO_V2.md) con datos SINTÉTICOS."""

from __future__ import annotations

import math
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from scipy.stats import norm

from radar.market.orderbook import Level
from radar.predict.base import DataRef, Prediction
from radar.predict.crypto import models as M
from radar.predict.crypto.events import ALL_EVENTS, EVENTS, events_overlapping
from radar.predict.crypto.mezcla import MEZCLA_NAME, book_features, mezcla_prediction
from radar.predict.crypto.options import (
    OPTIONS_NAME,
    OptionsPredictor,
    OptionSurface,
    Smile,
    digital_above,
    parse_surfaces,
)
from radar.predict.crypto.predictor import CryptoEvidence, CryptoParams, CryptoPredictor
from radar.predict.crypto.v2 import (
    VOL_NAME,
    CryptoV2Params,
    VolV2Predictor,
    build_profile,
    ny_hour_weekend,
    p_above_t,
    recalibrate,
)
from radar.predict.valuation import BookView
from tests.test_predict_crypto import synthetic_candles, terms, view

REF = DataRef(source="sintetico", kind="prueba", note="SINTÉTICO")


@pytest.fixture(scope="module")
def evidence() -> CryptoEvidence:
    return CryptoEvidence(candles={"BTCUSDT": synthetic_candles()})


# --- eventos y horario de Nueva York -----------------------------------------------------------


def test_events_are_in_new_york_time_with_daylight_saving() -> None:
    assert datetime(2026, 10, 14, 12, 30, tzinfo=UTC) in EVENTS["ipc"]  # 08:30 EDT
    assert datetime(2026, 11, 10, 13, 30, tzinfo=UTC) in EVENTS["ipc"]  # 08:30 EST
    assert datetime(2026, 10, 28, 18, 0, tzinfo=UTC) in EVENTS["fed"]  # 14:00 EDT
    assert len(EVENTS["ipc"]) == len(EVENTS["empleo"]) == 24 and len(EVENTS["fed"]) == 16
    t = datetime(2026, 11, 6, 13, 30, tzinfo=UTC)  # empleo de octubre
    assert (t, "empleo") in ALL_EVENTS
    assert events_overlapping(t + timedelta(minutes=59), t + timedelta(hours=2)) == [(t, "empleo")]
    assert events_overlapping(t + timedelta(minutes=60), t + timedelta(hours=2)) == []


def test_ny_hour_and_weekend() -> None:
    ts = np.array(
        [
            int(datetime(2026, 10, 30, 12, tzinfo=UTC).timestamp() * 1000),  # vie 08:00 EDT
            int(datetime(2026, 11, 1, 15, tzinfo=UTC).timestamp() * 1000),  # dom 10:00 EST
            int(datetime(2026, 11, 2, 3, tzinfo=UTC).timestamp() * 1000),  # dom 22:00 EST
        ]
    )
    hour, weekend = ny_hour_weekend(ts)
    assert hour.tolist() == [8, 10, 22]
    assert weekend.tolist() == [False, True, True]


def test_profile_averages_to_about_one() -> None:
    c = synthetic_candles(days=40)
    prof = build_profile(c, datetime(2026, 10, 9, tzinfo=UTC))
    assert prof is not None
    start = int(datetime(2026, 10, 2, tzinfo=UTC).timestamp() * 1000)
    assert prof.mean_over(start, start + 7 * 86_400_000) == pytest.approx(1.0, abs=0.08)


# --- fórmulas ------------------------------------------------------------------------------


def test_student_t_matches_normal_at_infinity_and_has_fatter_tails() -> None:
    v = 0.02
    for k in (95.0, 100.0, 104.0):
        assert p_above_t(100.0, k, v, None) == pytest.approx(float(M.p_above(100.0, k, v)))
    far = 106.0
    assert p_above_t(100.0, far, v, 3.0) > p_above_t(100.0, far, v, None)
    near = p_above_t(100.0, far, v, None)
    assert p_above_t(100.0, far, v, 1000.0) == pytest.approx(near, abs=1e-4)


def test_recalibration_identity_and_shrink() -> None:
    assert recalibrate(0.8, [0.0, 1.0]) == pytest.approx(0.8)
    assert 0.5 < recalibrate(0.8, [0.0, 0.5]) < 0.8


# --- cripto2-vol ---------------------------------------------------------------------------


def test_vol_v2_predicts_and_recalibrates(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=6)
    v2 = CryptoV2Params(recal={b: [0.0, 0.5] for b in ("<=2h", "<=1d", "<=7d", ">7d")})
    p = VolV2Predictor(CryptoParams(), v2).predict(view("daily_above"), evidence, as_of)
    assert p.model == VOL_NAME and p.probability is not None
    assert p.details["recal"] == [0.0, 0.5]
    raw = p.details["p_sin_recalibrar"]
    assert p.probability == pytest.approx(recalibrate(raw, [0.0, 0.5]))
    assert p.interval[0] <= p.probability <= p.interval[1]
    assert "estacional" in p.details


def test_vol_v2_adds_variance_for_an_event(evidence: CryptoEvidence) -> None:
    t = terms("hourly_above")
    ev_t = t.resolution_time - timedelta(minutes=30)
    as_of = t.resolution_time - timedelta(minutes=50)
    fake = [(ev_t, "ipc")]
    import radar.predict.crypto.v2 as V

    orig = V.events_overlapping
    V.events_overlapping = lambda a, b: [x for x in fake if x[0] < b]  # type: ignore[assignment]
    try:
        base = VolV2Predictor(CryptoParams(), CryptoV2Params(k_event=0.0), apply_recal=False)
        bump = VolV2Predictor(CryptoParams(), CryptoV2Params(k_event=2.0), apply_recal=False)
        p0 = base.predict(view("hourly_above"), evidence, as_of)
        p1 = bump.predict(view("hourly_above"), evidence, as_of)
    finally:
        V.events_overlapping = orig  # type: ignore[assignment]
    assert p1.details["sigma_anual"] > p0.details["sigma_anual"]
    assert p1.details["eventos"]


def test_vol_v2_never_reads_future_candles(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=3)
    c = evidence.candles["BTCUSDT"]
    later = c.open_ms > int(as_of.timestamp() * 1000)
    close = c.close.copy()
    close[later] *= 1.5
    other = CryptoEvidence(candles={"BTCUSDT": replace(c, close=close)})
    pred = VolV2Predictor(CryptoParams(), CryptoV2Params())
    a = pred.predict(view("daily_above"), evidence, as_of).probability
    b = (
        VolV2Predictor(CryptoParams(), CryptoV2Params())
        .predict(view("daily_above"), other, as_of)
        .probability
    )
    assert a == pytest.approx(b)


# --- cripto2-opciones ----------------------------------------------------------------------


def flat_surface(now: datetime, sigma: float, spot: float) -> OptionSurface:
    x = np.linspace(-0.5, 0.5, 11)
    smiles = tuple(
        Smile(now + timedelta(days=d), spot, spot, x, np.full_like(x, sigma)) for d in (1, 7, 30)
    )
    return OptionSurface("BTC", now, smiles, REF)


def test_digital_with_flat_smile_is_black_n_d2() -> None:
    now = datetime(2026, 10, 30, 12, tzinfo=UTC)
    surf = flat_surface(now, 0.5, 100.0)
    t = now + timedelta(days=3)
    years = 3 / 365
    for k in (90.0, 100.0, 110.0):
        d2 = (math.log(100.0 / k) - 0.5 * 0.25 * years) / (0.5 * math.sqrt(years))
        got = digital_above(surf, k, t, now, 100.0)
        assert got == pytest.approx(float(norm.cdf(d2)), abs=2e-3)


def test_parse_surfaces_keeps_out_of_the_money_and_decimal_strikes() -> None:
    now = datetime(2026, 10, 30, 12, tzinfo=UTC)
    rows = []
    for k in ("1d0", "1d1", "1d2", "1d3", "1d4", "1d5"):
        for cp in ("C", "P"):
            rows.append({"instrument_name": f"XRP_USDC-6NOV26-{k}-{cp}", "mark_iv": 60.0,
                         "underlying_price": 1.25, "estimated_delivery_price": 1.249})  # fmt: skip
    surf = parse_surfaces(rows, now, REF)["XRP"]
    sm = surf.smiles[0]
    assert sm.expiry == datetime(2026, 11, 6, 8, tzinfo=UTC)
    strikes = sorted(round(math.exp(x) * sm.forward, 4) for x in sm.x)
    assert strikes == [1.0, 1.1, 1.2, 1.3, 1.4, 1.5]  # put < 1,25 y call ≥ 1,25: uno por nivel
    assert sm.sigma(1.25) == pytest.approx(0.6)
    few = parse_surfaces(rows[:6], now, REF)  # 3 niveles: menos del mínimo
    assert "XRP" not in few


def test_options_predictor_abstains_without_live_snapshot(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=6)
    p = OptionsPredictor().predict(view("daily_above"), evidence, as_of)
    assert p.model == OPTIONS_NAME and p.probability is None
    assert "solo en vivo" in (p.abstain_reason or "")


def test_options_predictor_close_to_lognormal_with_flat_smile(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=6)
    c = evidence.candles_until("BTCUSDT", as_of)
    spot = float(c.close[-1])
    surf = replace(flat_surface(as_of - timedelta(minutes=1), 0.5, spot), asset="BTC")
    ev = CryptoEvidence(candles=evidence.candles, options={"BTC": surf})
    p = OptionsPredictor().predict(view("daily_above"), ev, as_of)
    v = 0.5 * math.sqrt(6 / (365 * 24))
    assert p.probability == pytest.approx(float(M.p_above(spot, t.lower, v)), abs=0.01)
    late = replace(surf, received_at=as_of - timedelta(minutes=11))
    old = CryptoEvidence(candles=evidence.candles, options={"BTC": late})
    assert OptionsPredictor().predict(view("daily_above"), old, as_of).probability is None


# --- cripto2-mezcla ------------------------------------------------------------------------


def book(bid: float, ask: float, bid_size: float = 100, ask_size: float = 50) -> BookView:
    now = datetime(2026, 10, 30, tzinfo=UTC)
    return BookView("yes", [Level(bid, bid_size), Level(bid - 0.1, 999)],
                    [Level(ask, ask_size), Level(ask + 0.1, 999)], now)  # fmt: skip


def test_book_features_count_depth_near_the_mid() -> None:
    f = book_features(book(0.40, 0.44))
    assert f is not None
    assert f["mid"] == pytest.approx(0.42) and f["spread"] == pytest.approx(0.04)
    assert f["desequilibrio"] == pytest.approx((100 - 50) / 150)
    assert book_features(BookView("yes", [], [Level(0.5, 1)], datetime.now(UTC))) is None


def test_mezcla_averages_logits_and_needs_book_and_a_model(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=6)
    v = view("daily_above")
    vol = CryptoPredictor("ewma").predict(v, evidence, as_of)
    vol = replace(vol, model=VOL_NAME, probability=0.7)
    preds: dict[str, Prediction] = {VOL_NAME: vol}
    prev = (0.40, as_of - timedelta(minutes=30))
    m = mezcla_prediction(v, t, preds, book(0.40, 0.44), prev, as_of)
    z = (math.log(0.7 / 0.3) + math.log(0.42 / 0.58)) / 2
    assert m.model == MEZCLA_NAME
    assert m.probability == pytest.approx(1 / (1 + math.exp(-z)))
    assert m.details["features"]["cambio_mid"] == pytest.approx(0.02)
    stale = mezcla_prediction(v, t, preds, book(0.40, 0.44), (0.4, as_of - timedelta(hours=2)),
                              as_of)  # fmt: skip
    assert stale.details["features"]["cambio_mid"] is None
    assert mezcla_prediction(v, t, preds, None, None, as_of).probability is None
    assert mezcla_prediction(v, t, {}, book(0.40, 0.44), None, as_of).probability is None
