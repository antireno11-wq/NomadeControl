"""Backtest cripto: particiones, resultado desde velas y operaciones hipotéticas (SINTÉTICO)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from radar.predict.base import MarketView
from radar.predict.crypto import backtest as BT
from radar.predict.crypto.binance import Candles, to_ms
from radar.predict.crypto.terms import CryptoTerms

T0 = datetime(2026, 9, 20, tzinfo=UTC)


def flat_candles(n_min: int, price: float = 100.0, start: datetime = T0) -> Candles:
    ts = to_ms(start) + 60_000 * np.arange(n_min, dtype=np.int64)
    p = np.full(n_min, price)
    return Candles("BTCUSDT", ts, p.copy(), p.copy(), p.copy(), p.copy(), [])


def terminal_terms(obs: datetime, lower: float) -> CryptoTerms:
    return CryptoTerms(kind="terminal", asset="BTC", symbol="BTCUSDT", yes_outcome="Yes",
                       variant="daily_above", candle="1m", obs_open=obs, lower=lower)  # fmt: skip


def test_resolution_from_candles_terminal_and_alternative_candle() -> None:
    c = flat_candles(600)
    obs = T0 + timedelta(minutes=300)
    i = int(np.searchsorted(c.open_ms, to_ms(obs)))
    c.close[i] = 101.0  # la vela observada cierra arriba; la siguiente no
    t = terminal_terms(obs, 100.5)
    assert BT.resolve_from_candles(t, c) == 1.0
    assert BT.resolve_from_candles(t, c, shift_min=1) == 0.0
    missing = c.between(T0, obs)  # sin la vela observada
    assert BT.resolve_from_candles(t, missing) is None


def test_resolution_touch_and_updown_tie_rules() -> None:
    c = flat_candles(600)
    touch = CryptoTerms(kind="touch", asset="BTC", symbol="BTCUSDT", yes_outcome="Yes",
                        variant="touch_day", direction="high", barrier=100.0,
                        window_start=T0, window_end=T0 + timedelta(minutes=600))  # fmt: skip
    assert BT.resolve_from_candles(touch, c) == 1.0  # el máximo iguala el nivel: "igual o mayor"
    above = CryptoTerms(**{**touch.__dict__, "barrier": 100.01})
    assert BT.resolve_from_candles(above, c) == 0.0
    ud = CryptoTerms(kind="updown", asset="BTC", symbol="BTCUSDT", yes_outcome="Up",
                     variant="daily_updown", candle="1m", obs_open=T0 + timedelta(minutes=500),
                     ref_open=T0 + timedelta(minutes=10), ref_candle="1m", ref_field="close",
                     tie="half")  # fmt: skip
    assert BT.resolve_from_candles(ud, c) == 0.5  # empate exacto → 50-50
    up = CryptoTerms(**{**ud.__dict__, "tie": "up"})
    assert BT.resolve_from_candles(up, c) == 1.0


def test_split_boundaries_with_embargo() -> None:
    d = timedelta(hours=1)
    assert BT._split(BT.TRAIN_END - 3 * d, BT.TRAIN_END - d) == "train"
    assert BT._split(BT.TRAIN_END - d, BT.TRAIN_END + d) is None  # cruza la frontera
    assert BT._split(BT.TRAIN_END + d, BT.VALID_END - d) == "valid"
    assert BT._split(BT.VALID_END - d, BT.VALID_END + d) is None
    assert BT._split(BT.VALID_END, BT.VALID_END + d) == "test"


def test_reference_price_must_be_fresh() -> None:
    t = datetime(2026, 9, 20, 12, tzinfo=UTC)
    pts = [
        [int((t - timedelta(minutes=40)).timestamp()), 0.4],
        [int((t + timedelta(minutes=1)).timestamp()), 0.9],
    ]
    assert BT.price_at(pts, t, timedelta(hours=1))[0] == 0.4  # nunca el punto futuro
    assert BT.price_at(pts, t, timedelta(minutes=15))[0] is None  # demasiado viejo


def record(market_id: str, terms: CryptoTerms, y: float, as_of: list[datetime]) -> dict:
    return {
        "market_id": market_id,
        "event_id": "e1",
        "question": "SINTÉTICO",
        "outcomes": ["Yes", "No"],
        "yes_token": "tok",
        "outcome_yes": y,
        "end_date": terms.resolution_time.isoformat(),
        "fee_rate": 0.07,
        "terms": terms.to_dict(),
        "as_of": [a.isoformat() for a in as_of],
        "price_history": [],
        "price_fidelity_min": 1,
    }


def test_build_instances_skips_touches_already_reached() -> None:
    c = flat_candles(600)
    c.high[100] = 105.0  # toque a los 100 minutos
    touch = CryptoTerms(kind="touch", asset="BTC", symbol="BTCUSDT", yes_outcome="Yes",
                        variant="touch_day", direction="high", barrier=104.0,
                        window_start=T0, window_end=T0 + timedelta(minutes=600))  # fmt: skip
    rec = record("m1", touch, 1.0, [T0 + timedelta(minutes=50), T0 + timedelta(minutes=200)])
    inst, info = BT.build_instances([rec], {"BTCUSDT": c})
    assert [x.as_of for x in inst] == [T0 + timedelta(minutes=50)]
    assert info["skipped"]["toque_ya_ocurrido_en_as_of"] == 1
    assert info["resolution_check"]["touch_day"] == {"coincide": 1}
    assert inst[0].split == "test" and inst[0].cluster == "BTC|2026-09-20"


def make_inst(
    market_id: str, p: float, lo: float, hi: float, price: float, y: float
) -> BT.Instance:
    t = terminal_terms(T0 + timedelta(hours=5), 100.0)
    return BT.Instance(
        market_id=market_id, event_id="e", variant="daily_above", asset="BTC", symbol="BTCUSDT",
        as_of=T0, resolution=t.resolution_time, y=y, terms=t,
        market=MarketView(market_id, "q", "", ("Yes", "No"), ("a", "b")),
        price=price, price_t=T0, fee_rate=0.07, split="test", bucket="<=1d",
        cluster=f"BTC|{market_id}", preds={"rv": (p, lo, hi)},
    )  # fmt: skip


def test_hypothetical_trades_are_labelled_and_computed() -> None:
    ref = {"daily_above": {"reference": "rv"}}
    rows = [
        make_inst("m1", 0.70, 0.62, 0.78, 0.50, 1.0),  # compra YES y gana
        make_inst("m2", 0.20, 0.12, 0.28, 0.50, 1.0),  # compra NO y pierde
        make_inst("m3", 0.52, 0.45, 0.60, 0.50, 1.0),  # sin discrepancia suficiente
    ]
    out = BT.hypothetical_trades(rows, ref)
    assert "HIPOTÉTICO" in out["label"]
    assert out["n_trades"] == 2
    cost = 0.50 + 0.07 * 0.25 + 0.01
    t1, t2 = out["trades"]
    assert t1["side"] == "YES" and t1["pnl_hypothetical"] == pytest.approx(25 / cost - 25, abs=1e-3)
    assert t2["side"] == "NO" and t2["pnl_hypothetical"] == pytest.approx(-25.0)
    assert out["staked"] == 50.0
    assert out["max_drawdown"] == pytest.approx(25.0)


def test_validation_criteria_report_each_failure() -> None:
    summ = {
        "n": 150,
        "n_clusters": 10,
        "ece": {"value": 0.08},
        "calib_in_large": {"value": 0.05, "lo": 0.02, "hi": 0.08},
        "brier": {"value": 0.30},
    }
    fails = BT._criteria_failures(summ, base_brier=0.25)
    assert len(fails) == 5


def test_dataset_sha256_matches_saved_hash(tmp_path) -> None:
    """El reporte informa el mismo SHA-256 que devolvió el armado del conjunto."""
    from radar.predict.crypto.dataset import dataset_sha256, load_dataset, save_dataset

    path = tmp_path / "ds.json.gz"
    sha = save_dataset(path, [{"market_id": "m1", "price_history": [[1, 0.5]]}], {"v": "t"})
    assert dataset_sha256(path) == sha
    assert load_dataset(path)["meta"] == {"v": "t"}
