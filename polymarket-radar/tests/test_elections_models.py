from datetime import UTC, date, datetime, timedelta

import numpy as np
import pytest

from radar.elections.models import (
    CalibContest,
    PollObs,
    bootstrap_sigmas,
    fit_error_model,
    pollster_median,
    prob_empirical,
    prob_t,
    validate_loo,
    weighted_average,
)

D = date(2026, 10, 20)


def poll(name, days_ago, share, n=1000, key=None):
    return PollObs(name, D - timedelta(days=days_ago), share, n, key or f"{name}{days_ago}{share}")


def test_weighted_average_uses_latest_per_pollster_and_recency():
    polls = [poll("A", 10, 0.40), poll("A", 1, 0.50), poll("B", 2, 0.52), poll("C", 40, 0.10)]
    avg = weighted_average(polls, D)
    assert avg.n_pollsters == 2  # A (la más reciente) y B; C queda fuera de la ventana
    assert 0.50 < avg.value < 0.52
    assert set(avg.used_keys) == {"A10.5", "B20.52"}


def test_weighted_average_never_uses_future_polls():
    polls = [poll("A", -1, 0.9), poll("B", 1, 0.5)]
    assert weighted_average(polls, D).value == pytest.approx(0.5)


def test_median_needs_three_pollsters():
    assert pollster_median([poll("A", 1, 0.5), poll("B", 1, 0.6)], D).value is None
    m = pollster_median([poll("A", 1, 0.5), poll("B", 1, 0.6), poll("C", 1, 0.7)], D)
    assert m.value == pytest.approx(0.6)


def synthetic_contest(key, avg_share, result, close=datetime(2020, 10, 30, 20, tzinfo=UTC)):
    """SINTÉTICO: encuestas constantes en avg_share durante 30 días."""
    polls = tuple(
        PollObs(f"P{i}", close.date() - timedelta(days=d), avg_share, 1000, f"{key}-{i}-{d}")
        for i in range(4)
        for d in range(1, 30, 3)
    )
    return CalibContest(key, close, result, polls)


def test_error_model_recovers_rms_error():
    cs = [synthetic_contest("c1", 0.50, 0.52), synthetic_contest("c2", 0.50, 0.48)]
    m = fit_error_model(cs, "weighted")
    assert m.n_contests == 2
    assert m.sigma(1) == pytest.approx(0.02, abs=1e-6)  # errores ±2 p.p. constantes
    assert sorted(m.empirical(1).tolist()) == pytest.approx([-0.02, -0.02, 0.02, 0.02])


def test_probabilities_are_reproducible_and_sensible():
    sig = np.full(50, 0.02)
    a = prob_t(0.51, sig, seed=1)
    b = prob_t(0.51, sig, seed=1)
    assert a == b
    assert 0.6 < a.prob_a < 0.8  # 0.5 σ por encima de 50 % con colas t
    assert prob_t(0.49, sig, seed=1).prob_a == pytest.approx(1 - a.prob_a, abs=0.02)
    assert prob_t(0.60, sig, seed=1).prob_a > 0.99


def test_empirical_probability_uses_both_signs():
    cs = [synthetic_contest("c1", 0.50, 0.53), synthetic_contest("c2", 0.50, 0.505)]
    m = fit_error_model(cs, "weighted")
    pr = prob_empirical(0.51, m, 1, seed=3)
    # Errores ±0.03 y ±0.005: 0.51 − 0.03 < 0.5 en 1 de 4 casos.
    assert pr.prob_a == pytest.approx(0.75)
    assert pr.prob_a_low <= pr.prob_a <= pr.prob_a_high


def test_bootstrap_sigma_spread_reflects_few_contests():
    cs = [synthetic_contest("c1", 0.50, 0.51), synthetic_contest("c2", 0.50, 0.54)]
    m = fit_error_model(cs, "weighted")
    s = bootstrap_sigmas(m, 1, np.random.default_rng(0), n_boot=200)
    assert s.min() == pytest.approx(0.01, abs=1e-6) and s.max() == pytest.approx(0.04, abs=1e-6)


def test_validation_requires_enough_contests():
    cs = [synthetic_contest(f"c{i}", 0.5 + 0.01 * i, 0.5 + 0.012 * i) for i in range(1, 4)]
    rep = validate_loo(cs, "weighted")
    assert rep.status == "no_validado"
    assert any("solo 3 contiendas" in r for r in rep.reasons)
    assert rep.n_contests == 3 and rep.brier is not None
