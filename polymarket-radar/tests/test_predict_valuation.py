"""Valoración contra libro ejecutable y puertas de la señal (datos SINTÉTICOS)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from radar.market.orderbook import Level
from radar.predict.base import CALIB_NOT_EVALUATED, CALIB_VALIDATED, MarketView, Prediction
from radar.predict.valuation import (
    REC_ABSTAIN,
    REC_ALERT,
    REC_INSUFFICIENT,
    REC_NONE,
    REC_SIGNAL,
    SUSPENDED_REASON,
    BookView,
    attach_sell_quote,
    value_token,
)

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
MARKET = MarketView(
    market_id="m1",
    question="¿Sintético?",
    description="",
    outcomes=("Yes", "No"),
    token_ids=("tok-yes", "tok-no"),
    fee_rate=0.07,
    fee_exponent=1,
)


def pred(p: float | None, lo: float, hi: float, status: str = CALIB_VALIDATED) -> Prediction:
    return Prediction(
        market_id="m1",
        outcome="Yes",
        probability=p,
        interval=(lo, hi) if p is not None else None,
        model="cripto-rv",
        model_version="test",
        family="cripto",
        as_of=NOW,
        calibration_status=status,
        abstain_reason=None if p is not None else "sin datos",
    )


def book(
    asks: list[tuple[float, float]], bids: list[tuple[float, float]], age_s: float = 5
) -> BookView:
    return BookView(
        "tok-yes",
        [Level(p, s) for p, s in bids],
        [Level(p, s) for p, s in asks],
        NOW - timedelta(seconds=age_s),
    )


DEEP = book([(0.50, 1000), (0.52, 1000)], [(0.49, 1000)])


def test_signal_only_when_every_gate_passes() -> None:
    v = value_token(MARKET, "Yes", pred(0.70, 0.62, 0.78), DEEP, NOW, supera_mercado=True)
    assert v.recommendation == REC_SIGNAL and v.reasons == []
    assert v.ask_vwap == pytest.approx(0.50)
    assert v.edge_pp == pytest.approx(20.0)
    fee = 0.07 * 0.5 * 0.5
    assert v.fee_per_share == pytest.approx(fee)
    assert v.ev_net_per_share == pytest.approx(0.20 - fee - 0.005)
    assert v.ev_conservative_per_share == pytest.approx(0.62 - 0.50 - fee - 0.005)
    assert v.liquidity_risk == "bajo"


@pytest.mark.parametrize(
    ("kwargs", "fragment"),
    [
        ({"status": CALIB_NOT_EVALUATED}, "no validado"),
        ({"supera": False}, "no superó al mercado"),
        ({"lo": 0.45}, "conservadora"),
    ],
)
def test_failing_gate_downgrades_to_research_alert(kwargs: dict, fragment: str) -> None:
    p = pred(0.70, kwargs.get("lo", 0.62), 0.78, kwargs.get("status", CALIB_VALIDATED))
    v = value_token(MARKET, "Yes", p, DEEP, NOW, supera_mercado=kwargs.get("supera", True))
    assert v.recommendation == REC_ALERT
    assert any(fragment in r for r in v.reasons)


def test_live_suspension_only_removes_the_signal() -> None:
    p = pred(0.70, 0.62, 0.78)
    v = value_token(MARKET, "Yes", p, DEEP, NOW, supera_mercado=True, suspendido=True)
    assert v.recommendation == REC_ALERT and v.reasons == [SUSPENDED_REASON]
    weak = value_token(MARKET, "Yes", pred(0.52, 0.45, 0.6), DEEP, NOW, supera_mercado=True,
                       suspendido=True)  # fmt: skip
    assert weak.recommendation == REC_NONE


def test_thin_book_and_stale_book_block_the_signal() -> None:
    thin = book([(0.50, 10)], [(0.49, 10)])
    v = value_token(MARKET, "Yes", pred(0.70, 0.62, 0.78), thin, NOW, supera_mercado=True)
    assert not v.fill_complete and v.recommendation == REC_ALERT
    assert any("liquidez" in r for r in v.reasons)
    old = book([(0.50, 1000)], [(0.49, 1000)], age_s=3600)
    v = value_token(MARKET, "Yes", pred(0.70, 0.62, 0.78), old, NOW, supera_mercado=True)
    assert any("antigüedad" in r for r in v.reasons)


def test_no_side_uses_complementary_probability_and_interval() -> None:
    no_book = BookView("tok-no", [Level(0.45, 1000)], [Level(0.48, 1000)], NOW)
    v = value_token(MARKET, "No", pred(0.70, 0.62, 0.78), no_book, NOW, supera_mercado=True)
    assert v.p_model == pytest.approx(0.30)
    assert (v.p_low, v.p_high) == (pytest.approx(0.22), pytest.approx(0.38))
    assert v.recommendation == REC_NONE


def test_insufficient_information_and_abstention() -> None:
    v = value_token(MARKET, "Yes", pred(0.7, 0.6, 0.8), None, NOW, supera_mercado=True)
    assert v.recommendation == REC_INSUFFICIENT
    empty = book([], [(0.49, 100)])
    assert value_token(MARKET, "Yes", pred(0.7, 0.6, 0.8), empty, NOW,
                       supera_mercado=True).recommendation == REC_INSUFFICIENT  # fmt: skip
    unverified = MarketView(**{**MARKET.__dict__, "fee_exponent": 2})
    v = value_token(unverified, "Yes", pred(0.7, 0.6, 0.8), DEEP, NOW, supera_mercado=True)
    assert v.recommendation == REC_INSUFFICIENT and "comisión" in v.reasons[0]
    v = value_token(MARKET, "Yes", pred(None, 0, 0), DEEP, NOW, supera_mercado=True)
    assert v.recommendation == REC_ABSTAIN and v.reasons == ["sin datos"]


def test_sell_quote_walks_the_bids_for_open_positions_only() -> None:
    book_ = book([(0.50, 1000)], [(0.49, 30), (0.47, 100)])
    v = value_token(MARKET, "Yes", pred(0.70, 0.62, 0.78), book_, NOW, supera_mercado=True)
    attach_sell_quote(v, book_, None, MARKET)
    assert v.sell_vwap is None  # sin posición abierta no se cotiza la venta
    attach_sell_quote(v, book_, 50.0, MARKET)
    assert v.sell_complete is True
    assert v.sell_vwap == pytest.approx((30 * 0.49 + 20 * 0.47) / 50)
    assert v.sell_fee_per_share == pytest.approx(0.07 * v.sell_vwap * (1 - v.sell_vwap))
    assert v.recommendation == REC_SIGNAL  # no cambia la recomendación
