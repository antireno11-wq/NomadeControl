"""Fórmulas de los modelos cripto contra simulaciones independientes (datos SINTÉTICOS)."""

from __future__ import annotations

import math

import numpy as np
import pytest
from scipy.stats import norm

from radar.predict.crypto import models as M


def gbm_paths(spot: float, v_total: float, n_steps: int, n_paths: int, seed: int) -> np.ndarray:
    """Trayectorias de precio log-normal sin deriva (martingala), pasos finos."""
    rng = np.random.default_rng(seed)
    dv = v_total / math.sqrt(n_steps)
    z = rng.standard_normal((n_paths, n_steps))
    x = np.cumsum(-0.5 * dv * dv + dv * z, axis=1)
    return spot * np.exp(x)


def test_at_the_money_terminal_is_slightly_below_half() -> None:
    v = 0.05
    assert M.p_above(100.0, 100.0, v) == pytest.approx(norm.cdf(-v / 2))
    assert M.p_above(100.0, None, v) == 1.0
    assert M.p_above(100.0, 90.0, 0.0) == 1.0 and M.p_above(100.0, 110.0, 0.0) == 0.0


def test_terminal_matches_monte_carlo() -> None:
    paths = gbm_paths(100.0, 0.08, 1, 400_000, seed=1)[:, -1]
    for lo, hi in ((95.0, None), (98.0, 102.0), (None, 97.0)):
        mc = np.mean(((paths > lo) if lo else True) & ((paths < hi) if hi else True))
        assert M.p_terminal(100.0, lo, hi, 0.08) == pytest.approx(mc, abs=0.004)


@pytest.mark.parametrize(("k", "direction"), [(105.0, "high"), (96.0, "low")])
def test_touch_running_matches_fine_monte_carlo(k: float, direction: str) -> None:
    v = 0.06
    paths = gbm_paths(100.0, v, 2000, 20_000, seed=2)
    hit = (paths.max(axis=1) >= k) if direction == "high" else (paths.min(axis=1) <= k)
    p = float(M.p_touch_running(100.0, k, direction, v))
    # la simulación discreta subestima levemente los cruces: tolerancia acorde
    assert p == pytest.approx(hit.mean(), abs=0.015)
    assert p >= hit.mean() - 0.002


def test_touch_already_beyond_barrier_is_certain() -> None:
    assert float(M.p_touch_running(110.0, 105.0, "high", 0.05)) == 1.0
    assert float(M.p_touch_running(90.0, 95.0, "low", 0.05)) == 1.0
    assert float(M.p_touch_running(100.0, 105.0, "high", 0.0)) == 0.0


def test_delayed_window_matches_monte_carlo_and_reduces_to_running() -> None:
    v_pre, v_win = 0.04, 0.05
    assert M.p_touch_delayed(100.0, 106.0, "high", 0.0, v_win) == pytest.approx(
        float(M.p_touch_running(100.0, 106.0, "high", v_win))
    )
    n_pre, n_win = 400, 500
    total = math.sqrt(v_pre**2 + v_win**2)
    paths = gbm_paths(100.0, total, n_pre + n_win, 20_000, seed=3)
    # los pasos tienen igual varianza: la ventana empieza en el paso con la fracción v_pre²
    start = round((v_pre**2 / total**2) * (n_pre + n_win))
    mc = np.mean(paths[:, start:].max(axis=1) >= 106.0)
    assert M.p_touch_delayed(100.0, 106.0, "high", v_pre, v_win) == pytest.approx(mc, abs=0.015)


def test_updown_with_future_reference() -> None:
    assert M.p_updown_future_ref(0.0) == 0.5
    assert M.p_updown_future_ref(0.02) == pytest.approx(norm.cdf(-0.01))


def test_bootstrap_with_gaussian_returns_reproduces_closed_form() -> None:
    rng = np.random.default_rng(4)
    r = M.martingale_returns(rng.normal(0, 0.002, 20_000))
    assert float(np.mean(np.exp(r))) == pytest.approx(1.0, abs=1e-12)
    n = 288
    x = M.simulate_log_paths(r, n, 20_000, np.random.default_rng(5), block=1)[:, -1]
    v = 0.002 * math.sqrt(n)
    assert np.mean(100 * np.exp(x) > 103) == pytest.approx(M.p_above(100.0, 103.0, v), abs=0.01)


def test_bridge_crossing_probability() -> None:
    x0 = np.array([0.0, 0.0, 0.2])
    x1 = np.array([0.0, 0.1, 0.0])
    p = M.bridge_cross_prob(x0, x1, 0.1, 0.01, up=True)
    assert p[0] == pytest.approx(math.exp(-2 * 0.1 * 0.1 / 0.01))
    assert p[1] == 1.0 and p[2] == 1.0  # un extremo ya está en/más allá de la barrera
