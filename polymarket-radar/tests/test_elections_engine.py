"""Motor de discrepancias con estimaciones y cotizaciones SINTÉTICAS."""

from datetime import UTC, datetime

import pytest

from radar.elections.contests import BR_2026_R2
from radar.elections.engine import (
    EngineConfig,
    Estimate,
    Quote,
    consensus,
    evaluate,
    fee_per_share,
    token_prob,
    token_prob_low,
)
from radar.elections.market_history import (
    PRICE_BASIS_ASK,
    PRICE_BASIS_REFERENCE,
)
from radar.elections.models import ValidationReport

AS_OF = datetime(2026, 10, 24, 12, tzinfo=UTC)


def est(name, p, lo=None, hi=None):
    low = lo if lo is not None else p - 0.05
    high = hi if hi is not None else p + 0.05
    return Estimate(name, "interno", "ok", p, low, high, 0.5, 0.02, 1.3, "v", "", {})


def validation(ok: bool) -> ValidationReport:
    return ValidationReport(
        method="weighted",
        n_contests=20 if ok else 3,
        forecasts=[],
        brier=0.1,
        log_loss=0.3,
        coverage50=0.5,
        coverage90=0.9,
        status="validado" if ok else "no_validado",
        reasons=[] if ok else ["solo 3"],
    )


def ask_quote(price, **kw):
    base = {
        "market_id": "m",
        "token_id": "t",
        "label": "Lula YES",
        "candidate": "a",
        "outcome": "YES",
        "basis": PRICE_BASIS_ASK,
        "price": price,
        "observed_at": AS_OF,
        "vwap_for_size": price,
        "fill_complete": True,
        "spread": 0.01,
        "book_age_s": 60,
        "fee_rate": 0.0,
        "fee_exponent": 1,
    }
    base.update(kw)
    return Quote(**base)


def test_token_probabilities_and_unfavourable_bounds():
    e = est("x", 0.6, 0.55, 0.7)
    assert token_prob(0.6, "a", "YES") == pytest.approx(0.6)
    assert token_prob(0.6, "a", "NO") == pytest.approx(0.4)
    assert token_prob(0.6, "b", "YES") == pytest.approx(0.4)
    assert token_prob(0.6, "b", "NO") == pytest.approx(0.6)
    assert token_prob_low(e, "a", "YES") == pytest.approx(0.55)
    assert token_prob_low(e, "b", "YES") == pytest.approx(0.30)


def test_consensus_is_median_and_reports_disagreement():
    c = consensus([est("a", 0.2), est("b", 0.5), est("c", 0.9)])
    assert c.reference_prob_a == 0.5 and c.min_prob_a == 0.2 and c.max_prob_a == 0.9
    assert c.n_estimates == 3 and c.stdev_prob_a > 0.2


def test_alert_threshold_is_five_points_raw():
    es = [est("a", 0.40), est("b", 0.40)]
    d = evaluate(BR_2026_R2, es, [ask_quote(0.351)], validation(True), AS_OF)[0]
    assert d.discrepancy_pp == pytest.approx(4.9) and not d.alert
    d = evaluate(BR_2026_R2, es, [ask_quote(0.35)], validation(True), AS_OF)[0]
    assert d.discrepancy_pp == pytest.approx(5.0) and d.alert


def test_operable_signal_requires_every_condition():
    es = [est("a", 0.50, 0.45, 0.55), est("b", 0.52, 0.47, 0.57)]
    good = evaluate(BR_2026_R2, es, [ask_quote(0.30)], validation(True), AS_OF)[0]
    assert good.alert and good.signal and good.gating == []
    # ventaja conservadora = min(0.45, 0.47) − (0.30 + 0 + 0.005) = 14.5 p.p.
    assert good.conservative_edge_pp == pytest.approx(14.5)

    cases = {
        "modelo no validado": (validation(False), ask_quote(0.30), AS_OF),
        "precio no ejecutable": (
            validation(True),
            ask_quote(0.30, basis=PRICE_BASIS_REFERENCE),
            AS_OF,
        ),
        "urnas cerradas": (validation(True), ask_quote(0.30), BR_2026_R2.polls_close_utc),
        "comisión no verificado": (
            validation(True),
            ask_quote(0.30, fee_rate=0.04, fee_exponent=2),
            AS_OF,
        ),
        "liquidez insuficiente": (validation(True), ask_quote(0.30, fill_complete=False), AS_OF),
        "spread": (validation(True), ask_quote(0.30, spread=0.2), AS_OF),
        "antigüedad": (validation(True), ask_quote(0.30, book_age_s=3600), AS_OF),
    }
    for expected, (val, q, t) in cases.items():
        d = evaluate(BR_2026_R2, es, [q], val, t)[0]
        assert not d.signal, expected
        assert any(expected in g for g in d.gating), (expected, d.gating)


def test_conservative_edge_uses_least_favourable_estimate():
    # Una estimación optimista no basta: manda la peor cota inferior.
    es = [est("optimista", 0.80, 0.75, 0.85), est("pesimista", 0.36, 0.30, 0.42)]
    d = evaluate(BR_2026_R2, es, [ask_quote(0.33)], validation(True), AS_OF)[0]
    assert d.alert  # mediana 0.58 vs 0.33
    assert d.conservative_edge_pp == pytest.approx((0.30 - 0.335) * 100)
    assert not d.signal


def test_costs_include_fees_and_slippage():
    assert fee_per_share(0.5, 0.04, 1) == pytest.approx(0.01)
    assert fee_per_share(0.5, 0.0, 2) == 0.0
    assert fee_per_share(0.5, 0.04, 2) is None
    es = [est("a", 0.50, 0.40, 0.60)]
    cfg = EngineConfig(min_estimates=1)
    d = evaluate(BR_2026_R2, es, [ask_quote(0.38, fee_rate=0.04, fee_exponent=1)],
                 validation(True), AS_OF, cfg)[0]  # fmt: skip
    # 0.40 − (0.38 + 0.04·0.38·0.62 + 0.005)
    expected = (0.40 - 0.38 - 0.04 * 0.38 * 0.62 - 0.005) * 100
    assert d.conservative_edge_pp == pytest.approx(expected, abs=1e-3)  # redondeo a 3 decimales


def test_insufficient_information_never_alerts():
    d = evaluate(BR_2026_R2, [], [ask_quote(0.3)], validation(True), AS_OF)[0]
    assert not d.alert and not d.signal and d.gating == ["información insuficiente"]
