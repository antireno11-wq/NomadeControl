"""Predictor cripto de punta a punta con velas SINTÉTICAS y reglas reales."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from radar.predict.base import CALIB_NOT_EVALUATED, DataRef, MarketView
from radar.predict.crypto.binance import Candles, to_ms
from radar.predict.crypto.predictor import CryptoEvidence, CryptoParams, CryptoPredictor
from radar.predict.crypto.terms import CryptoTerms, parse_crypto_terms

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "crypto_rules_real.json").read_text(encoding="utf-8")
)
START = datetime(2026, 9, 1, tzinfo=UTC)


def view(key: str) -> MarketView:
    m = FIX["markets"][key]
    return MarketView(
        market_id=m["id"],
        question=m["question"],
        description=m["description"],
        outcomes=tuple(m["outcomes"]),
        token_ids=("yes", "no"),
        category="crypto",
        start_date=datetime.fromisoformat(m["start_date"]),
        end_date=datetime.fromisoformat(m["end_date"]),
    )


def synthetic_candles(
    symbol: str = "BTCUSDT",
    spot: float = 80_000.0,
    sigma_annual: float = 0.5,
    days: int = 60,
    seed: int = 7,
) -> Candles:
    rng = np.random.default_rng(seed)
    n = days * 1440
    s = sigma_annual / np.sqrt(365 * 1440)
    r = rng.normal(-0.5 * s * s, s, n)
    close = spot * np.exp(np.cumsum(r))
    open_ = np.concatenate([[spot], close[:-1]])
    high = np.maximum(open_, close) * (1 + 0.0002)
    low = np.minimum(open_, close) * (1 - 0.0002)
    ts = to_ms(START) + 60_000 * np.arange(n, dtype=np.int64)
    ref = DataRef(source="sintetico", kind="prueba", note="velas sintéticas de prueba")
    return Candles(symbol, ts, open_, high, low, close, [ref])


@pytest.fixture(scope="module")
def evidence() -> CryptoEvidence:
    return CryptoEvidence(candles={"BTCUSDT": synthetic_candles()})


def terms(key: str) -> CryptoTerms:
    t = parse_crypto_terms(view(key))
    assert isinstance(t, CryptoTerms)
    return t


def test_daily_above_prediction_has_full_output(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=6)
    p = CryptoPredictor("rv").predict(view("daily_above"), evidence, as_of)
    assert p.probability is not None and 0 <= p.probability <= 1
    assert p.interval is not None and p.interval[0] <= p.probability <= p.interval[1]
    assert (p.model, p.family, p.outcome) == ("cripto-rv", "cripto", "Yes")
    assert p.calibration_status == CALIB_NOT_EVALUATED
    assert p.data_used and p.data_used[0].source == "sintetico"
    assert p.details["tau_min"] == pytest.approx(360.0)
    assert p.as_of == as_of


def test_future_candles_do_not_change_the_prediction(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=6)
    base = CryptoPredictor("rv").predict(view("daily_above"), evidence, as_of).probability
    c = evidence.candles["BTCUSDT"]
    cut = int(np.searchsorted(c.open_ms, to_ms(as_of)))
    close = c.close.copy()
    close[cut:] *= 3.0  # el futuro cambia drásticamente
    altered = CryptoEvidence(
        candles={"BTCUSDT": Candles(c.symbol, c.open_ms, c.open, c.high * 3, c.low, close, c.refs)}
    )
    assert CryptoPredictor("rv").predict(view("daily_above"), altered, as_of).probability == base


def test_stale_data_and_resolved_contracts_abstain(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    old = CryptoEvidence(
        candles={
            "BTCUSDT": evidence.candles["BTCUSDT"].until(t.resolution_time - timedelta(days=1))
        }
    )
    p = CryptoPredictor("rv").predict(
        view("daily_above"), old, t.resolution_time - timedelta(hours=1)
    )
    assert p.probability is None and "desactualizados" in (p.abstain_reason or "")
    done = CryptoPredictor("rv").predict(view("daily_above"), evidence, t.resolution_time)
    assert done.probability is None and "ya existe" in (done.abstain_reason or "")


def test_unsupported_market_abstains_with_reason(evidence: CryptoEvidence) -> None:
    p = CryptoPredictor("rv").predict(
        view("chainlink_5m"), evidence, datetime(2025, 12, 19, tzinfo=UTC)
    )
    assert p.probability is None and "Chainlink" in (p.abstain_reason or "")


def test_dvol_only_for_btc_eth(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    p = CryptoPredictor("dvol").predict(
        view("daily_above"), evidence, t.resolution_time - timedelta(hours=3)
    )
    assert p.probability is None and "DVOL" in (p.abstain_reason or "")


def test_touch_already_reached_is_certain(evidence: CryptoEvidence) -> None:
    t = terms("touch_day")  # máximo >= 88.000 el 25-oct (ET)
    as_of = t.window_start + timedelta(hours=10)
    c = evidence.candles["BTCUSDT"]
    high = c.high.copy()
    i = int(np.searchsorted(c.open_ms, to_ms(t.window_start + timedelta(hours=1))))
    high[i] = 100_000.0
    ev = CryptoEvidence(
        candles={"BTCUSDT": Candles(c.symbol, c.open_ms, c.open, high, c.low, c.close, c.refs)}
    )
    p = CryptoPredictor("ewma").predict(view("touch_day"), ev, as_of)
    assert p.probability == 1.0 and "decidido_por_datos" in p.details


def test_methods_agree_roughly_on_gaussian_data(evidence: CryptoEvidence) -> None:
    t = terms("daily_above")
    as_of = t.resolution_time - timedelta(hours=12)
    params = CryptoParams(bootstrap_paths=4000)
    probs = {
        m: CryptoPredictor(m, params).predict(view("daily_above"), evidence, as_of).probability
        for m in ("rv", "ewma", "bootstrap")
    }
    assert all(v is not None for v in probs.values())
    assert max(probs.values()) - min(probs.values()) < 0.08


def test_updown_hourly_before_and_during_candle(evidence: CryptoEvidence) -> None:
    t = terms("hourly_updown")
    pred = CryptoPredictor("rv")
    before = pred.predict(view("hourly_updown"), evidence, t.ref_open - timedelta(minutes=10))
    assert before.probability == pytest.approx(0.5, abs=0.01)
    assert before.details["referencia"] == "futura"
    during = pred.predict(view("hourly_updown"), evidence, t.ref_open + timedelta(minutes=30))
    assert during.probability is not None and isinstance(during.details["referencia"], float)
