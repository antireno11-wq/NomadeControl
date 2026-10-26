"""Probabilidades para contratos cripto (``crypto-models-v1``).

Supuesto común: el precio es una martingala sin deriva en el horizonte de la
predicción (no se intenta adivinar la dirección). Lo que distingue a los modelos
es cómo estiman la dispersión futura:

- ``rv``: volatilidad realizada con retornos de 5 minutos en una ventana hacia atrás.
- ``ewma``: volatilidad con pesos exponenciales (más reactiva).
- ``dvol``: volatilidad implícita de opciones (índice DVOL de Deribit; solo BTC y ETH).
- ``bootstrap``: simulación de trayectorias remuestreando bloques de retornos
  históricos reales (conserva colas gruesas y agrupamiento de volatilidad).

Tipos de contrato:

- Precio final (vela observada) sobre/bajo un nivel o en un rango: fórmula
  log-normal ``P(S_T > K) = Φ((ln(S/K) − v²/2)/v)`` con ``v = σ√τ``.
- Toque de un nivel dentro de una ventana: primer paso de un movimiento browniano
  con deriva ``−σ²/2`` (principio de reflexión). Con velas de 1 minuto el máximo
  observado (High) equivale a monitoreo continuo.
- Up/Down: igual que precio final, con la referencia conocida o futura.

Ninguna fórmula usa el resultado ni precios de Polymarket.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.stats import norm

from radar.predict.crypto.binance import MINUTE_MS, Candles

MODELS_VERSION = "crypto-models-v1"
MINUTES_PER_YEAR = 365 * 24 * 60
EPS = 1e-12


# --- estimadores de volatilidad (varianza por minuto, en log) --------------------------------


@dataclass(frozen=True)
class VolEstimate:
    var_per_min: float
    n_returns: int
    method: str
    lookback_min: int | None = None
    halflife_min: int | None = None

    @property
    def sigma_annual(self) -> float:
        return math.sqrt(self.var_per_min * MINUTES_PER_YEAR)


def step_returns(c: Candles, step_min: int) -> tuple[np.ndarray, np.ndarray]:
    """Retornos logarítmicos de cierre a cierre cada ``step_min`` minutos, contando desde el
    final; se descartan los pares separados por huecos. Devuelve (retornos, edad en min)."""
    if len(c) < step_min + 1:
        return np.array([]), np.array([])
    idx = np.arange(len(c) - 1, -1, -step_min)[::-1]
    closes = c.close[idx]
    times = c.open_ms[idx]
    r = np.diff(np.log(closes))
    dt = np.diff(times)
    ok = dt == step_min * MINUTE_MS
    age = (times[-1] - times[1:]) / MINUTE_MS
    return r[ok], age[ok]


def realized_var(c: Candles, lookback_min: int, step_min: int = 5) -> VolEstimate | None:
    if not len(c):
        return None
    sub = c.between_ms(int(c.open_ms[-1]) - lookback_min * MINUTE_MS, int(c.open_ms[-1]) + 1)
    r, _age = step_returns(sub, step_min)
    expected = lookback_min / step_min
    if r.size < max(12, 0.8 * expected):
        return None
    return VolEstimate(
        float(np.mean(r * r) / step_min), int(r.size), "rv", lookback_min=lookback_min
    )


def ewma_var(c: Candles, halflife_min: int, step_min: int = 5) -> VolEstimate | None:
    if not len(c):
        return None
    window = halflife_min * 6
    sub = c.between_ms(int(c.open_ms[-1]) - window * MINUTE_MS, int(c.open_ms[-1]) + 1)
    r, age = step_returns(sub, step_min)
    if r.size < max(12, 0.8 * window / step_min):
        return None
    w = 0.5 ** (age / halflife_min)
    var = float(np.sum(w * r * r) / np.sum(w) / step_min)
    return VolEstimate(var, int(r.size), "ewma", halflife_min=halflife_min)


def dvol_var(dvol_pct: float) -> VolEstimate:
    s = dvol_pct / 100.0
    return VolEstimate(s * s / MINUTES_PER_YEAR, 0, "dvol")


# --- fórmulas cerradas (martingala log-normal) -----------------------------------------------


def p_above(spot: float | np.ndarray, k: float | None, v: float) -> float | np.ndarray:
    """P(S_T > k) con ln S_T ~ N(ln S − v²/2, v²). ``k=None`` → 1."""
    if k is None:
        return np.ones_like(spot, dtype=float) if isinstance(spot, np.ndarray) else 1.0
    if v <= EPS:
        return (
            np.asarray(spot > k, dtype=float) if isinstance(spot, np.ndarray) else float(spot > k)
        )
    d = (np.log(np.asarray(spot) / k) - 0.5 * v * v) / v
    out = norm.cdf(d)
    return out if isinstance(spot, np.ndarray) else float(out)


def p_terminal(spot: float, lower: float | None, upper: float | None, v: float) -> float:
    """P(lower < S_T < upper) (los bordes tienen probabilidad cero en el continuo)."""
    p = float(p_above(spot, lower, v)) - (
        float(p_above(spot, upper, v)) if upper is not None else 0.0
    )
    return min(1.0, max(0.0, p))


def p_touch_running(spot: float | np.ndarray, k: float, direction: str, v: float) -> np.ndarray:
    """P(el máximo (o mínimo) alcance k antes de T), con la ventana ya abierta.

    X = ln(S_t/S_0) tiene deriva ν = −σ²/2. Para una barrera superior b = ln(k/S) > 0:
    P = Φ((−b − v²/2)/v) + (S/k)·Φ((−b + v²/2)/v). Simétrico para la inferior.
    """
    s = np.asarray(spot, dtype=float)
    out = np.ones_like(s)
    if direction == "high":
        live = s < k
        if v > EPS and np.any(live):
            b = np.log(k / s[live])
            out[live] = norm.cdf((-b - 0.5 * v * v) / v) + (s[live] / k) * norm.cdf(
                (-b + 0.5 * v * v) / v
            )
        elif np.any(live):
            out[live] = 0.0
    else:
        live = s > k
        if v > EPS and np.any(live):
            b = np.log(k / s[live])
            out[live] = norm.cdf((b + 0.5 * v * v) / v) + (s[live] / k) * norm.cdf(
                (b - 0.5 * v * v) / v
            )
        elif np.any(live):
            out[live] = 0.0
    return np.clip(out, 0.0, 1.0)


_GH_X, _GH_W = np.polynomial.hermite_e.hermegauss(80)


def p_touch_delayed(spot: float, k: float, direction: str, v_pre: float, v_win: float) -> float:
    """Toque dentro de una ventana que aún no empieza: se integra el precio al inicio."""
    if v_pre <= EPS:
        return float(p_touch_running(spot, k, direction, v_win))
    x = -0.5 * v_pre * v_pre + v_pre * _GH_X
    vals = p_touch_running(spot * np.exp(x), k, direction, v_win)
    return float(np.clip(np.sum(_GH_W * vals) / math.sqrt(2 * math.pi), 0.0, 1.0))


def p_updown_future_ref(v: float) -> float:
    """P(cierre >= referencia) cuando la referencia aún no se conoce: Φ(−v/2)."""
    return float(norm.cdf(-0.5 * v)) if v > EPS else 0.5


# --- bootstrap por bloques -------------------------------------------------------------------


@dataclass(frozen=True)
class BootstrapSpec:
    step_min: int
    n_steps: int
    last_frac: float  # fracción del último paso (horizontes no múltiplos del paso)


def bootstrap_step(tau_min: float) -> int:
    if tau_min <= 2 * 24 * 60:
        return 5
    return 60


def martingale_returns(r: np.ndarray) -> np.ndarray:
    """Centra los retornos para que E[exp(r)] = 1 (sin deriva en precio)."""
    r = r - r.mean()
    return r - math.log(float(np.mean(np.exp(r))))


def simulate_log_paths(
    returns: np.ndarray,
    n_steps: int,
    n_paths: int,
    rng: np.random.Generator,
    *,
    block: int = 12,
    last_frac: float = 1.0,
    scale: float = 1.0,
) -> np.ndarray:
    """Trayectorias acumuladas de log-precio (n_paths, n_steps) por bootstrap estacionario."""
    n = returns.size
    if n == 0 or n_steps <= 0:
        return np.zeros((n_paths, max(n_steps, 0)))
    # bootstrap estacionario (Politis-Romano): cada paso continúa el bloque con prob 1-1/block
    starts = rng.integers(0, n, size=(n_paths, n_steps))
    cont = rng.random((n_paths, n_steps)) >= 1.0 / block
    idx = np.empty((n_paths, n_steps), dtype=np.int64)
    idx[:, 0] = starts[:, 0]
    for j in range(1, n_steps):
        idx[:, j] = np.where(cont[:, j], (idx[:, j - 1] + 1) % n, starts[:, j])
    steps = returns[idx] * scale
    if last_frac < 1.0:
        steps[:, -1] *= math.sqrt(max(last_frac, 0.0))
    return np.cumsum(steps, axis=1)


def bridge_cross_prob(
    x0: np.ndarray, x1: np.ndarray, b: float, var_step: float, up: bool
) -> np.ndarray:
    """Probabilidad de cruzar b entre dos puntos (puente browniano)."""
    if var_step <= EPS:
        return np.zeros_like(x0)
    if up:
        d0, d1 = b - x0, b - x1
    else:
        d0, d1 = x0 - b, x1 - b
    p = np.exp(-2.0 * np.clip(d0, 0, None) * np.clip(d1, 0, None) / var_step)
    return np.where((d0 > 0) & (d1 > 0), p, 1.0)
