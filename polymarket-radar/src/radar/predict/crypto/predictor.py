"""Predictores cripto que implementan ``predict(market, evidence, as_of_time)``.

Cuatro métodos (``rv``, ``ewma``, ``dvol``, ``bootstrap``) comparten el lector de
contratos y la evidencia. Los parámetros ajustables (ventana de volatilidad, vida
media, cocientes para el intervalo) vienen de ``CryptoParams``, que se ajusta solo
con el período de entrenamiento del backtest; sin ajuste se usan valores por
defecto declarados aquí.

El intervalo refleja la incertidumbre de la volatilidad: se recalcula la
probabilidad con σ multiplicada por los cuantiles 10 y 90 del cociente
"volatilidad realizada después / volatilidad estimada" medido en entrenamiento.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from radar.predict.base import (
    CALIB_NOT_EVALUATED,
    DataRef,
    MarketView,
    Prediction,
    abstain,
)
from radar.predict.crypto import models as M
from radar.predict.crypto.binance import Candles, from_ms, to_ms
from radar.predict.crypto.deribit import DvolSeries
from radar.predict.crypto.schedule import horizon_bucket
from radar.predict.crypto.terms import CryptoTerms, Unsupported, parse_crypto_terms

FAMILY = "cripto"
METHODS = ("rv", "ewma", "dvol", "bootstrap")
MAX_STALENESS = timedelta(minutes=5)
BUCKETS = ("<=2h", "<=1d", "<=7d", ">7d")


@dataclass
class CryptoParams:
    version: str = "crypto-params-default"
    fitted_on: dict[str, str] | None = None
    rv_lookback_min: dict[str, int] = field(
        default_factory=lambda: dict.fromkeys(BUCKETS, 7 * 1440)
    )
    ewma_halflife_min: dict[str, int] = field(default_factory=lambda: dict.fromkeys(BUCKETS, 1440))
    bootstrap_lookback_min: int = 30 * 1440
    bootstrap_paths: int = 4000
    # cuantiles 10/90 del cociente vol. realizada / vol. estimada, por método y tramo
    vol_ratio_q: dict[str, dict[str, list[float]]] = field(
        default_factory=lambda: {m: {b: [0.75, 1.35] for b in BUCKETS} for m in METHODS}
    )
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CryptoParams:
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

    @classmethod
    def load(cls, path: Path) -> CryptoParams:
        return cls.from_dict(json.loads(path.read_text()))

    def sha256(self) -> str:
        return hashlib.sha256(json.dumps(self.to_dict(), sort_keys=True).encode()).hexdigest()


@dataclass
class CryptoEvidence:
    """Datos disponibles. El predictor siempre corta en ``as_of``."""

    candles: dict[str, Candles]
    dvol: dict[str, DvolSeries] = field(default_factory=dict)
    # Fotos de opciones de Deribit por activo (``cripto2-opciones``; solo en vivo).
    options: dict[str, Any] = field(default_factory=dict)

    def candles_until(self, symbol: str, as_of: datetime) -> Candles | None:
        c = self.candles.get(symbol)
        return c.until(as_of) if c is not None else None


@dataclass
class CalibrationRegistry:
    """Estado de calibración por (modelo, variante), resultado de la evaluación."""

    status: dict[str, str] = field(default_factory=dict)
    source: str | None = None

    def get(self, model: str, variant: str) -> str:
        return self.status.get(f"{model}|{variant}", CALIB_NOT_EVALUATED)

    @classmethod
    def load(cls, path: Path) -> CalibrationRegistry:
        if not path.exists():
            return cls()
        d = json.loads(path.read_text())
        return cls(status=d.get("status", {}), source=str(path))


def _refs_used(c: Candles, start_ms: int, end_ms: int) -> list[DataRef]:
    out = []
    for r in c.refs:
        lo = to_ms(datetime.fromisoformat(r.observed_from)) if r.observed_from else None
        hi = to_ms(datetime.fromisoformat(r.observed_until)) if r.observed_until else None
        if lo is None or hi is None or (hi >= start_ms and lo < end_ms):
            out.append(r)
    return out


def _ref_value_time(terms: CryptoTerms) -> datetime:
    """Instante en que queda fijado el valor de referencia de un Up/Down."""
    assert terms.ref_open is not None
    if terms.ref_field == "open":
        return terms.ref_open  # apertura de la vela
    return terms.ref_open + timedelta(minutes=1)  # cierre de la vela de 1 minuto


class CryptoPredictor:
    family = FAMILY

    def __init__(
        self,
        method: str,
        params: CryptoParams | None = None,
        calibration: CalibrationRegistry | None = None,
    ) -> None:
        if method not in METHODS:
            raise ValueError(f"método desconocido: {method}")
        self.method = method
        self.name = f"cripto-{method}"
        self.version = M.MODELS_VERSION
        self.params = params or CryptoParams()
        self.calibration = calibration or CalibrationRegistry()
        self._memo: dict[tuple[Any, ...], Any] = {}

    def _cached(self, key: tuple[Any, ...], fn: Any) -> Any:
        """Memoria corta: los niveles de un mismo evento comparten activo, as_of y horizonte."""
        if key not in self._memo:
            if len(self._memo) > 256:
                self._memo.clear()
            self._memo[key] = fn()
        return self._memo[key]

    def applies(self, market: MarketView) -> str | None:
        t = parse_crypto_terms(market)
        return t.reason if isinstance(t, Unsupported) else None

    # --- predicción ----------------------------------------------------------------------

    def predict(
        self, market: MarketView, evidence: CryptoEvidence, as_of_time: datetime
    ) -> Prediction:
        terms = parse_crypto_terms(market)
        if isinstance(terms, Unsupported):
            return self._abstain(market, as_of_time, terms.reason)
        return self.predict_terms(market, terms, evidence, as_of_time)

    def predict_terms(
        self, market: MarketView, terms: CryptoTerms, evidence: CryptoEvidence, as_of: datetime
    ) -> Prediction:
        if terms.yes_outcome not in market.outcomes:
            return self._abstain(market, as_of, "resultado YES/Up no está en el mercado", terms)
        if as_of >= terms.resolution_time:
            return self._abstain(market, as_of, "el dato que resuelve ya existe en as_of", terms)
        c = evidence.candles_until(terms.symbol, as_of)
        if c is None or not len(c):
            return self._abstain(market, as_of, f"sin velas de {terms.symbol}", terms)
        last_close_t = from_ms(c.open_ms[-1]) + timedelta(minutes=1)
        if as_of - last_close_t > MAX_STALENESS:
            return self._abstain(
                market, as_of, f"datos desactualizados: última vela cerró {last_close_t}", terms
            )
        spot = float(c.close[-1])
        tau_min = (terms.resolution_time - as_of).total_seconds() / 60.0
        bucket = horizon_bucket(terms.resolution_time - as_of)
        details: dict[str, Any] = {
            "terms": terms.to_dict(),
            "spot": spot,
            "spot_time": last_close_t.isoformat(),
            "tau_min": round(tau_min, 3),
            "bucket": bucket,
            "params_version": self.params.version,
            "params_sha256": self.params.sha256(),
        }

        # Contratos ya decididos por datos observados (toques ya ocurridos, etc.)
        settled = self._settled(terms, c, as_of)
        if settled is not None:
            p, why = settled
            details["decidido_por_datos"] = why
            return self._result(market, terms, as_of, p, (p, p), c, details, None)

        vol = self._vol(terms, c, evidence, as_of, bucket, details)
        if isinstance(vol, str):
            return self._abstain(market, as_of, vol, terms, details)
        details["sigma_anual"] = round(vol.sigma_annual, 6)
        details["n_returns"] = vol.n_returns
        q = self.params.vol_ratio_q.get(self.method, {}).get(bucket, [0.75, 1.35])
        details["vol_ratio_q"] = q

        if self.method == "bootstrap":
            out = self._bootstrap(terms, c, as_of, spot, tau_min, q, details)
            if isinstance(out, str):
                return self._abstain(market, as_of, out, terms, details)
            p, lo, hi = out
        else:
            p = self._closed_form(terms, c, as_of, spot, vol.var_per_min, details)
            alt = [
                self._closed_form(terms, c, as_of, spot, vol.var_per_min * f * f, None) for f in q
            ]
            lo, hi = min([p, *alt]), max([p, *alt])
        dvol_ref = details.pop("_dvol_ref", None)
        return self._result(market, terms, as_of, p, (lo, hi), c, details, dvol_ref)

    # --- piezas ----------------------------------------------------------------------------

    def _settled(self, terms: CryptoTerms, c: Candles, as_of: datetime) -> tuple[float, str] | None:
        if terms.kind != "touch":
            return None
        assert terms.window_start and terms.barrier is not None
        if as_of <= terms.window_start:
            return None
        sub = c.between(terms.window_start, as_of)
        if not len(sub):
            return None
        if terms.direction == "high" and float(sub.high.max()) >= terms.barrier:
            return 1.0, "el máximo ya alcanzó el nivel antes de as_of"
        if terms.direction == "low" and float(sub.low.min()) <= terms.barrier:
            return 1.0, "el mínimo ya alcanzó el nivel antes de as_of"
        return None

    def _vol(
        self,
        terms: CryptoTerms,
        c: Candles,
        ev: CryptoEvidence,
        as_of: datetime,
        bucket: str,
        details: dict[str, Any],
    ) -> M.VolEstimate | str:
        if self.method == "rv" or self.method == "bootstrap":
            lb = (
                self.params.bootstrap_lookback_min
                if self.method == "bootstrap"
                else self.params.rv_lookback_min.get(bucket, 7 * 1440)
            )
            last = int(c.open_ms[-1])
            v = self._cached(("rv", c.symbol, last, len(c), lb), lambda: M.realized_var(c, lb))
            details["lookback_min"] = lb
            return v or f"historia insuficiente para volatilidad realizada ({lb} min)"
        if self.method == "ewma":
            hl = self.params.ewma_halflife_min.get(bucket, 1440)
            details["halflife_min"] = hl
            last = int(c.open_ms[-1])
            v = self._cached(("ewma", c.symbol, last, len(c), hl), lambda: M.ewma_var(c, hl))
            return v or f"historia insuficiente para EWMA (vida media {hl} min)"
        # dvol
        series = ev.dvol.get(terms.asset)
        if series is None:
            return f"sin volatilidad implícita verificable para {terms.asset} (DVOL solo BTC/ETH)"
        got = series.at(as_of)
        if got is None:
            return "DVOL no disponible o desactualizado en as_of"
        value, opened = got
        details["dvol"] = value
        details["dvol_hour"] = opened.isoformat()
        ref = next((r for r in series.refs if r.note and f"{opened:%Y-%m}" in r.note), None)
        if ref is not None:
            details["_dvol_ref"] = DataRef(
                source=ref.source,
                kind=ref.kind,
                url=ref.url,
                sha256=ref.sha256,
                retrieved_at=ref.retrieved_at,
                observed_until=opened.isoformat(),
                note=ref.note,
            )
        return M.dvol_var(value)

    def _reference(self, terms: CryptoTerms, c: Candles, as_of: datetime) -> float | None:
        """Valor de referencia de un Up/Down si ya es conocido en as_of."""
        assert terms.ref_open is not None and terms.ref_candle is not None
        if terms.ref_field == "open":
            bar = c.bar(terms.ref_open, 1)  # la apertura de la vela de 1 h = la del primer minuto
            return bar[0] if bar else None
        minutes = 60 if terms.ref_candle == "1h" else 1
        bar = c.bar(terms.ref_open, minutes)
        return bar[3] if bar else None

    def _closed_form(
        self,
        terms: CryptoTerms,
        c: Candles,
        as_of: datetime,
        spot: float,
        var_per_min: float,
        details: dict[str, Any] | None,
    ) -> float:
        tau = (terms.resolution_time - as_of).total_seconds() / 60.0
        v = math.sqrt(max(var_per_min, 0.0) * max(tau, 0.0))
        if terms.kind == "terminal":
            return M.p_terminal(spot, terms.lower, terms.upper, v)
        if terms.kind == "updown":
            ref = self._reference(terms, c, as_of)
            if ref is None:
                span = (terms.resolution_time - _ref_value_time(terms)).total_seconds() / 60
                v_span = math.sqrt(max(var_per_min, 0.0) * max(span, 0.0))
                if details is not None:
                    details["referencia"] = "futura"
                return M.p_updown_future_ref(v_span)
            if details is not None:
                details["referencia"] = ref
            return M.p_terminal(spot, ref, None, v)
        # touch
        assert terms.window_start and terms.barrier is not None and terms.direction
        if as_of >= terms.window_start:
            return float(M.p_touch_running(spot, terms.barrier, terms.direction, v))
        pre = (terms.window_start - as_of).total_seconds() / 60.0
        win = (terms.resolution_time - terms.window_start).total_seconds() / 60.0
        v_pre = math.sqrt(max(var_per_min, 0.0) * pre)
        v_win = math.sqrt(max(var_per_min, 0.0) * win)
        return M.p_touch_delayed(spot, terms.barrier, terms.direction, v_pre, v_win)

    def _bootstrap(
        self,
        terms: CryptoTerms,
        c: Candles,
        as_of: datetime,
        spot: float,
        tau_min: float,
        q: list[float],
        details: dict[str, Any],
    ) -> tuple[float, float, float] | str:
        step = M.bootstrap_step(tau_min)
        lb = self.params.bootstrap_lookback_min
        last = int(c.open_ms[-1])
        r, _ = self._cached(
            ("ret", c.symbol, last, len(c), lb, step),
            lambda: M.step_returns(c.between_ms(last - lb * 60_000, last + 1), step),
        )
        if r.size < max(50, 0.8 * lb / step):
            return f"historia insuficiente para bootstrap ({r.size} retornos de {step} min)"
        r = self._cached(
            ("mret", c.symbol, last, len(c), lb, step), lambda: M.martingale_returns(r)
        )
        var_step = float(np.var(r))
        seed = int(
            hashlib.sha256(f"{self.name}|{terms.symbol}|{as_of.isoformat()}".encode()).hexdigest()[
                :8
            ],
            16,
        )
        details.update({"step_min": step, "seed": seed, "paths": self.params.bootstrap_paths})
        n_paths = self.params.bootstrap_paths

        def run(scale: float, paths: int) -> float:
            rng = np.random.default_rng(seed)
            return self._simulate(terms, c, as_of, spot, r, var_step * scale * scale, step, scale,
                                  paths, rng, details if scale == 1.0 else None)  # fmt: skip

        p = run(1.0, n_paths)
        alts = [run(f, n_paths // 2) for f in q]
        return p, min([p, *alts]), max([p, *alts])

    def _simulate(
        self,
        terms: CryptoTerms,
        c: Candles,
        as_of: datetime,
        spot: float,
        r: np.ndarray,
        var_step: float,
        step: int,
        scale: float,
        n_paths: int,
        rng: np.random.Generator,
        details: dict[str, Any] | None,
    ) -> float:
        def steps_for(minutes: float) -> tuple[int, float]:
            n = max(1, math.ceil(minutes / step))
            frac = minutes / step - (n - 1)
            return n, min(max(frac, 0.0), 1.0)

        if terms.kind == "terminal":
            n, frac = steps_for((terms.resolution_time - as_of).total_seconds() / 60)
            x = self._paths(c, r, n, n_paths, rng, frac, scale)[:, -1]
            st = spot * np.exp(x)
            hit = np.ones(n_paths, dtype=bool)
            if terms.lower is not None:
                hit &= st > terms.lower
            if terms.upper is not None:
                hit &= st < terms.upper
            return float(hit.mean())
        if terms.kind == "updown":
            ref = self._reference(terms, c, as_of)
            if ref is None:
                span = (terms.resolution_time - _ref_value_time(terms)).total_seconds() / 60
                n, frac = steps_for(span)
                x = self._paths(c, r, n, n_paths, rng, frac, scale)[:, -1]
                if details is not None:
                    details["referencia"] = "futura"
                return float((x >= 0).mean())
            n, frac = steps_for((terms.resolution_time - as_of).total_seconds() / 60)
            x = self._paths(c, r, n, n_paths, rng, frac, scale)[:, -1]
            if details is not None:
                details["referencia"] = ref
            return float((spot * np.exp(x) >= ref).mean())
        # touch: se acumula la probabilidad de no cruzar (puente browniano entre pasos)
        assert terms.window_start and terms.barrier is not None and terms.direction
        up = terms.direction == "high"
        if terms.barrier <= 0:
            return 1.0 if up else 0.0  # un precio positivo nunca llega a un nivel <= 0
        n, frac = steps_for((terms.resolution_time - as_of).total_seconds() / 60)
        x = self._paths(c, r, n, n_paths, rng, frac, scale)
        b = math.log(terms.barrier / spot)
        start_idx = 0
        if as_of < terms.window_start:
            start_idx = int((terms.window_start - as_of).total_seconds() / 60 // step)
        prev = np.zeros(n_paths) if start_idx == 0 else x[:, start_idx - 1]
        survive = np.ones(n_paths)
        if start_idx > 0:
            beyond0 = prev >= b if up else prev <= b
            survive[beyond0] = 0.0
        for j in range(start_idx, n):
            cur = x[:, j]
            survive *= 1.0 - M.bridge_cross_prob(prev, cur, b, var_step, up)
            prev = cur
        return float(1.0 - survive.mean())

    def _paths(
        self,
        c: Candles,
        r: np.ndarray,
        n: int,
        n_paths: int,
        rng: np.random.Generator,
        frac: float,
        scale: float,
    ) -> np.ndarray:
        seed_state = rng.bit_generator.state["state"]["state"]
        key = ("paths", c.symbol, int(c.open_ms[-1]), len(c), r.size, n, n_paths, round(frac, 9),
               scale, seed_state)  # fmt: skip
        return self._cached(
            key, lambda: M.simulate_log_paths(r, n, n_paths, rng, last_frac=frac, scale=scale)
        )

    # --- salida ----------------------------------------------------------------------------

    def _result(
        self,
        market: MarketView,
        terms: CryptoTerms,
        as_of: datetime,
        p: float,
        interval: tuple[float, float],
        c: Candles,
        details: dict[str, Any],
        extra_ref: DataRef | None,
    ) -> Prediction:
        lb = int(details.get("lookback_min") or details.get("halflife_min", 1440) * 6)
        start_ms = int(c.open_ms[-1]) - lb * 60_000
        if terms.kind == "touch" and terms.window_start is not None:
            start_ms = min(start_ms, to_ms(terms.window_start))
        refs = [
            DataRef(
                source=r.source,
                kind=r.kind,
                url=r.url,
                sha256=r.sha256,
                retrieved_at=r.retrieved_at,
                observed_from=r.observed_from,
                observed_until=min(r.observed_until or "", from_ms(c.open_ms[-1]).isoformat())
                or None,
                note=r.note,
            )
            for r in _refs_used(c, start_ms, int(c.open_ms[-1]) + 1)
        ]
        if extra_ref is not None:
            refs.append(extra_ref)
        return Prediction(
            market_id=market.market_id,
            outcome=terms.yes_outcome,
            probability=float(min(1.0, max(0.0, p))),
            interval=(
                float(min(1.0, max(0.0, interval[0]))),
                float(min(1.0, max(0.0, interval[1]))),
            ),
            model=self.name,
            model_version=self.version,
            family=FAMILY,
            as_of=as_of,
            calibration_status=self.calibration.get(self.name, terms.variant),
            data_used=refs,
            details=details,
        )

    def _abstain(
        self,
        market: MarketView,
        as_of: datetime,
        reason: str,
        terms: CryptoTerms | None = None,
        details: dict[str, Any] | None = None,
    ) -> Prediction:
        d = dict(details or {})
        d.pop("_dvol_ref", None)
        if terms is not None:
            d.setdefault("terms", terms.to_dict())
        return abstain(
            market,
            model=self.name,
            version=self.version,
            family=FAMILY,
            as_of=as_of,
            reason=reason,
            outcome=terms.yes_outcome if terms else None,
            details=d,
        )
