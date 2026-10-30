"""``cripto2-vol``: el modelo EWMA de v1 con mejor volatilidad (``crypto-models-v2``).

Reglas en ``docs/PREREGISTRO_CRIPTO_V2.md``. Cambia solo la varianza que entra en las
fórmulas de v1 y, al final, se recalibra:

1. estacionalidad por hora de Nueva York y fin de semana (tramos ≤ 2 h y ≤ 1 d);
2. varianza extra en la hora que sigue a un evento programado (IPC, empleo, Fed);
3. t de Student para precio final y Up/Down (ν por tramo);
4. recalibración logística por tramo.

Todo se calcula con velas de fecha ≤ ``as_of``.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import t as student_t

from radar.predict.base import MarketView, Prediction
from radar.predict.crypto import models as M
from radar.predict.crypto.binance import MINUTE_MS, Candles
from radar.predict.crypto.events import EVENT_MINUTES, EVENTS_VERSION, NY, events_overlapping
from radar.predict.crypto.predictor import (
    BUCKETS,
    CalibrationRegistry,
    CryptoEvidence,
    CryptoParams,
    CryptoPredictor,
    _ref_value_time,
)
from radar.predict.crypto.schedule import horizon_bucket
from radar.predict.crypto.terms import CryptoTerms

MODELS_V2_VERSION = "crypto-models-v2"
VOL_NAME = "cripto2-vol"
HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS
STEP_MIN = 5
PROFILE_DAYS = 30
SEASONAL_BUCKETS = ("<=2h", "<=1d")
NU_GRID: tuple[float | None, ...] = (3.0, 4.0, 6.0, 10.0, None)  # None = normal (ν = ∞)
P_CLIP = 1e-4


@dataclass
class CryptoV2Params:
    version: str = "crypto-params-v2-default"
    fitted_on: dict[str, Any] | None = None
    base_params_sha256: str | None = None
    events_version: str = EVENTS_VERSION
    k_event: float = 0.0
    nu: dict[str, float | None] = field(default_factory=lambda: dict.fromkeys(BUCKETS))
    recal: dict[str, list[float]] = field(default_factory=lambda: {b: [0.0, 1.0] for b in BUCKETS})
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CryptoV2Params:
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    @classmethod
    def load(cls, path: Path) -> CryptoV2Params:
        return cls.from_dict(json.loads(path.read_text()))

    def sha256(self) -> str:
        return hashlib.sha256(json.dumps(self.to_dict(), sort_keys=True).encode()).hexdigest()


# --- estacionalidad ------------------------------------------------------------------------


def _ny_offset_ms(t_ms: np.ndarray) -> np.ndarray:
    """Diferencia horaria de Nueva York (ms) para cada instante; cambia con el horario de verano."""
    hours = t_ms // HOUR_MS
    uniq, inv = np.unique(hours, return_inverse=True)
    offs = np.array(
        [
            datetime.fromtimestamp(int(h) * 3600, tz=UTC).astimezone(NY).utcoffset().total_seconds()  # type: ignore[union-attr]
            * 1000
            for h in uniq
        ],
        dtype=np.int64,
    )
    return offs[inv]


def ny_hour_weekend(t_ms: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Hora del día y si es sábado o domingo, en hora de Nueva York."""
    t_ms = np.asarray(t_ms, dtype=np.int64)
    if not t_ms.size:
        return np.array([], dtype=np.int64), np.array([], dtype=bool)
    local = t_ms + _ny_offset_ms(t_ms)
    hour = (local // HOUR_MS) % 24
    weekday = ((local // DAY_MS) + 3) % 7  # 1970-01-01 fue jueves; lunes = 0
    return hour, weekday >= 5


def returns_with_time(c: Candles, step_min: int = STEP_MIN) -> tuple[np.ndarray, np.ndarray]:
    """Retornos de cierre a cierre cada ``step_min`` y la apertura de la vela donde terminan."""
    if len(c) < step_min + 1:
        return np.array([]), np.array([], dtype=np.int64)
    idx = np.arange(len(c) - 1, -1, -step_min)[::-1]
    closes = c.close[idx]
    times = c.open_ms[idx]
    r = np.diff(np.log(closes))
    ok = np.diff(times) == step_min * MINUTE_MS
    return r[ok], times[1:][ok]


@dataclass(frozen=True)
class Profile:
    hour: np.ndarray  # 24 factores
    weekday: float
    weekend: float

    def factor(self, t_ms: np.ndarray) -> np.ndarray:
        h, we = ny_hour_weekend(t_ms)
        return self.hour[h] * np.where(we, self.weekend, self.weekday)

    def mean_over(self, start_ms: int, end_ms: int) -> float:
        n = int(max(2, min(4000, (end_ms - start_ms) // (STEP_MIN * MINUTE_MS))))
        grid = np.linspace(start_ms, end_ms, n, endpoint=False).astype(np.int64)
        return float(np.mean(self.factor(grid)))


def build_profile(c: Candles, day_start: datetime) -> Profile | None:
    """Perfil con los retornos de 5 min de los 30 días anteriores a ``day_start``."""
    end = int(day_start.timestamp() * 1000)
    r, t = returns_with_time(c.between_ms(end - PROFILE_DAYS * DAY_MS, end))
    if r.size < 0.5 * PROFILE_DAYS * DAY_MS / (STEP_MIN * MINUTE_MS):
        return None
    a = np.abs(r)
    m = float(a.mean())
    if m <= 0:
        return None
    h, we = ny_hour_weekend(t)
    hour = np.ones(24)
    for k in range(24):
        sel = a[h == k]
        if sel.size:
            hour[k] = (float(sel.mean()) / m) ** 2
    adj = r * r / hour[h]
    mean_adj = float(adj.mean())
    weekday = float(adj[~we].mean()) / mean_adj if (~we).any() else 1.0
    weekend = float(adj[we].mean()) / mean_adj if we.any() else 1.0
    return Profile(hour, weekday, weekend)


def deseasonalized_ewma(c: Candles, halflife_min: int, prof: Profile) -> M.VolEstimate | None:
    """EWMA (misma ventana y exigencia de datos que v1) sobre r² / perfil."""
    if not len(c):
        return None
    window = halflife_min * 6
    last = int(c.open_ms[-1])
    r, t = returns_with_time(c.between_ms(last - window * MINUTE_MS, last + 1))
    if r.size < max(12, 0.8 * window / STEP_MIN):
        return None
    w = 0.5 ** ((last - t) / MINUTE_MS / halflife_min)
    var = float(np.sum(w * r * r / prof.factor(t)) / np.sum(w) / STEP_MIN)
    return M.VolEstimate(var, int(r.size), "ewma", halflife_min=halflife_min)


# --- fórmulas con t de Student --------------------------------------------------------------


def p_above_t(spot: float, k: float | None, v: float, nu: float | None) -> float:
    """P(S_T > k) con ln(S_T/S) = −v²/2 + v·ε y ε una t de Student de varianza 1."""
    if nu is None:
        return float(M.p_above(spot, k, v))
    if k is None or k <= 0:
        return 1.0
    if v <= M.EPS:
        return float(spot > k)
    scale = v * math.sqrt((nu - 2.0) / nu)
    return float(student_t.sf((math.log(k / spot) + 0.5 * v * v) / scale, nu))


def p_terminal_t(spot: float, lower: float | None, upper: float | None, v: float,
                 nu: float | None) -> float:  # fmt: skip
    p = p_above_t(spot, lower, v, nu) - (p_above_t(spot, upper, v, nu) if upper else 0.0)
    return min(1.0, max(0.0, p))


def p_updown_future_ref_t(v: float, nu: float | None) -> float:
    if nu is None:
        return M.p_updown_future_ref(v)
    if v <= M.EPS:
        return 0.5
    return float(student_t.sf(0.5 * v / math.sqrt((nu - 2.0) / nu), nu))


def logit(p: float) -> float:
    p = min(1 - P_CLIP, max(P_CLIP, p))
    return math.log(p / (1 - p))


def recalibrate(p: float, ab: list[float]) -> float:
    a, b = ab
    return 1.0 / (1.0 + math.exp(-(a + b * logit(p))))


# --- predictor -----------------------------------------------------------------------------


class VolV2Predictor(CryptoPredictor):
    """EWMA de v1 con estacionalidad, eventos, colas gruesas y recalibración."""

    def __init__(
        self,
        params: CryptoParams | None = None,
        v2: CryptoV2Params | None = None,
        calibration: CalibrationRegistry | None = None,
        *,
        apply_recal: bool = True,
    ) -> None:
        super().__init__("ewma", params, calibration)
        self.name = VOL_NAME
        self.version = MODELS_V2_VERSION
        self.v2 = v2 or CryptoV2Params()
        self.apply_recal = apply_recal
        self._profiles: dict[tuple[str, datetime], Profile | None] = {}

    def profile(self, c: Candles, as_of: datetime) -> Profile | None:
        day0 = datetime(as_of.year, as_of.month, as_of.day, tzinfo=UTC)
        key = (c.symbol, day0)
        if key not in self._profiles:
            if len(self._profiles) > 64:
                self._profiles.clear()
            self._profiles[key] = build_profile(c, day0)
        return self._profiles[key]

    def predict_terms(
        self, market: MarketView, terms: CryptoTerms, evidence: CryptoEvidence, as_of: datetime
    ) -> Prediction:
        pred = super().predict_terms(market, terms, evidence, as_of)
        if pred.probability is None:
            return pred
        pred.details["v2_params_version"] = self.v2.version
        pred.details["v2_params_sha256"] = self.v2.sha256()
        if pred.details.get("decidido_por_datos") or not self.apply_recal:
            return pred
        ab = self.v2.recal.get(pred.details.get("bucket", ""), [0.0, 1.0])
        raw = pred.probability
        lo, hi = pred.interval or (raw, raw)
        pred.details["p_sin_recalibrar"] = raw
        pred.details["recal"] = ab
        pred.probability = recalibrate(raw, ab)
        a, b = recalibrate(lo, ab), recalibrate(hi, ab)
        pred.interval = (min(a, b, pred.probability), max(a, b, pred.probability))
        return pred

    def _vol(
        self,
        terms: CryptoTerms,
        c: Candles,
        ev: CryptoEvidence,
        as_of: datetime,
        bucket: str,
        details: dict[str, Any],
    ) -> M.VolEstimate | str:
        hl = self.params.ewma_halflife_min.get(bucket, 1440)
        details["halflife_min"] = hl
        a_ms = int(as_of.timestamp() * 1000)
        b_ms = int(terms.resolution_time.timestamp() * 1000)
        tau = max((b_ms - a_ms) / MINUTE_MS, 1e-9)
        prof = self.profile(c, as_of) if bucket in SEASONAL_BUCKETS else None
        last = int(c.open_ms[-1])
        if prof is not None:
            day = as_of.date().toordinal()
            base = self._cached(
                ("ewma2", c.symbol, last, len(c), hl, day),
                lambda: deseasonalized_ewma(c, hl, prof),
            )
            if base is None:
                return f"historia insuficiente para EWMA (vida media {hl} min)"
            g = prof.mean_over(a_ms, b_ms)
            var = base.var_per_min * g
            details["estacional"] = {"factor_medio": round(g, 4),
                                     "fin_de_semana": round(prof.weekend, 4)}  # fmt: skip
        else:
            base = self._cached(("ewma", c.symbol, last, len(c), hl), lambda: M.ewma_var(c, hl))
            if base is None:
                return f"historia insuficiente para EWMA (vida media {hl} min)"
            var = base.var_per_min
        extra = 0.0
        evs = events_overlapping(as_of, terms.resolution_time) if self.v2.k_event > 0 else []
        for t_ev, kind in evs:
            t_ms = int(t_ev.timestamp() * 1000)
            ov = (min(b_ms, t_ms + EVENT_MINUTES * MINUTE_MS) - max(a_ms, t_ms)) / MINUTE_MS
            if ov <= 0:
                continue
            per_min = (
                base.var_per_min * prof.mean_over(t_ms, t_ms + EVENT_MINUTES * MINUTE_MS)
                if prof is not None
                else base.var_per_min
            )
            extra += self.v2.k_event * per_min * ov
            details.setdefault("eventos", []).append(f"{kind} {t_ev.isoformat()}")
        return replace(base, var_per_min=var + extra / tau)

    def _closed_form(
        self,
        terms: CryptoTerms,
        c: Candles,
        as_of: datetime,
        spot: float,
        var_per_min: float,
        details: dict[str, Any] | None,
    ) -> float:
        nu = self.v2.nu.get(horizon_bucket(terms.resolution_time - as_of))
        if terms.kind == "touch" or nu is None:
            return super()._closed_form(terms, c, as_of, spot, var_per_min, details)
        if details is not None:
            details["nu"] = nu
        tau = (terms.resolution_time - as_of).total_seconds() / 60.0
        v = math.sqrt(max(var_per_min, 0.0) * max(tau, 0.0))
        if terms.kind == "terminal":
            return p_terminal_t(spot, terms.lower, terms.upper, v, nu)
        ref = self._reference(terms, c, as_of)
        if ref is None:
            span = (terms.resolution_time - _ref_value_time(terms)).total_seconds() / 60
            if details is not None:
                details["referencia"] = "futura"
            return p_updown_future_ref_t(math.sqrt(max(var_per_min, 0.0) * max(span, 0.0)), nu)
        if details is not None:
            details["referencia"] = ref
        return p_terminal_t(spot, ref, None, v, nu)
