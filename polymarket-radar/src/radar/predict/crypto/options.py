"""``cripto2-opciones``: probabilidad implícita en las opciones de Deribit (``crypto-models-v2``).

Reglas en ``docs/PREREGISTRO_CRIPTO_V2.md``. Sin parámetros ajustados:

- foto de ``public/get_book_summary_by_currency`` (opciones) de BTC, ETH y USDC;
- sonrisa por vencimiento: ``mark_iv`` contra ln(K/F) de opciones fuera del dinero;
- varianza total interpolada en el tiempo hasta la resolución R;
- P(S_R > K) = −∂C/∂K por diferencia finita de Black-76 (incluye la sonrisa).

Solo en vivo: no hay cadenas históricas de opciones, así que en el backtest se abstiene.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
from scipy.stats import norm

from radar.ingestion.http import ApiClient
from radar.predict.base import DataRef, MarketView, Prediction
from radar.predict.crypto.binance import from_ms
from radar.predict.crypto.deribit import DERIBIT_BASE
from radar.predict.crypto.predictor import (
    MAX_STALENESS,
    CalibrationRegistry,
    CryptoEvidence,
    CryptoParams,
    CryptoPredictor,
)
from radar.predict.crypto.schedule import horizon_bucket
from radar.predict.crypto.terms import CryptoTerms
from radar.predict.crypto.v2 import MODELS_V2_VERSION

OPTIONS_NAME = "cripto2-opciones"
SOURCE = "deribit_option_book_summary"
CURRENCIES = ("BTC", "ETH", "USDC")
UNDERLYING = {"BTC": "BTC", "ETH": "ETH", "SOL": "SOL_USDC", "XRP": "XRP_USDC"}
MIN_STRIKES = 5
MAX_AGE = timedelta(minutes=10)
REFRESH = timedelta(minutes=5)
H_REL = 0.005  # paso de la diferencia finita: 0,5 % del nivel
EXPIRY_HOUR_UTC = 8
YEAR_MIN = 365 * 24 * 60
INTERVAL_SIGMA = (0.9, 1.1)


@dataclass(frozen=True)
class Smile:
    expiry: datetime
    forward: float
    index: float
    x: np.ndarray  # ln(K/F), ordenado
    iv: np.ndarray  # volatilidad implícita (fracción anual)

    def sigma(self, k: float) -> float:
        return float(np.interp(math.log(k / self.forward), self.x, self.iv))


@dataclass(frozen=True)
class OptionSurface:
    asset: str
    received_at: datetime
    smiles: tuple[Smile, ...]  # por vencimiento
    ref: DataRef

    def _years(self, t: datetime, as_of: datetime) -> float:
        return max((t - as_of).total_seconds() / 60.0, 0.0) / YEAR_MIN

    def forward_at(self, t: datetime, as_of: datetime) -> float | None:
        """Forward de Deribit hasta ``t``: lineal en el tiempo entre vencimientos."""
        first = self.smiles[0]
        tt = self._years(t, as_of)
        t1 = self._years(first.expiry, as_of)
        if t <= first.expiry:
            return first.index + (first.forward - first.index) * (tt / t1 if t1 > 0 else 1.0)
        for a, b in zip(self.smiles, self.smiles[1:], strict=False):
            if a.expiry < t <= b.expiry:
                ta, tb = self._years(a.expiry, as_of), self._years(b.expiry, as_of)
                return a.forward + (b.forward - a.forward) * (tt - ta) / (tb - ta)
        return None

    def total_var(self, k: float, t: datetime, as_of: datetime) -> float | None:
        """Varianza total σ²·T en el nivel ``k`` hasta ``t`` (None si ``t`` pasa el último)."""
        first = self.smiles[0]
        tt = self._years(t, as_of)
        if t <= first.expiry:
            return first.sigma(k) ** 2 * tt
        for a, b in zip(self.smiles, self.smiles[1:], strict=False):
            if a.expiry < t <= b.expiry:
                ta, tb = self._years(a.expiry, as_of), self._years(b.expiry, as_of)
                wa, wb = a.sigma(k) ** 2 * ta, b.sigma(k) ** 2 * tb
                return wa + (wb - wa) * (tt - ta) / (tb - ta)
        return None


def _strike(s: str) -> float:
    return float(s.replace("d", "."))


def _expiry(s: str) -> datetime:
    d = datetime.strptime(s, "%d%b%y")
    return datetime(d.year, d.month, d.day, EXPIRY_HOUR_UTC, tzinfo=UTC)


def parse_surfaces(
    rows: list[dict[str, Any]], received_at: datetime, ref: DataRef
) -> dict[str, OptionSurface]:
    wanted = {u: a for a, u in UNDERLYING.items()}
    groups: dict[tuple[str, datetime], list[dict[str, Any]]] = {}
    for r in rows:
        parts = str(r.get("instrument_name") or "").split("-")
        if len(parts) != 4 or parts[0] not in wanted:
            continue
        try:
            exp = _expiry(parts[1])
            k = _strike(parts[2])
        except ValueError:
            continue
        if exp <= received_at:
            continue
        groups.setdefault((parts[0], exp), []).append(r | {"_k": k, "_cp": parts[3]})
    smiles: dict[str, list[Smile]] = {}
    for (und, exp), rs in groups.items():
        fwd = [float(r["underlying_price"]) for r in rs if r.get("underlying_price")]
        idx = [float(r["estimated_delivery_price"]) for r in rs
               if r.get("estimated_delivery_price")]  # fmt: skip
        if not fwd or not idx:
            continue
        f = float(np.median(fwd))
        pts: dict[float, float] = {}
        for r in rs:
            iv = r.get("mark_iv")
            k = r["_k"]
            otm = (r["_cp"] == "C" and k >= f) or (r["_cp"] == "P" and k < f)
            if otm and iv is not None and float(iv) > 0 and k > 0:
                pts[math.log(k / f)] = float(iv) / 100.0
        if len(pts) < MIN_STRIKES:
            continue
        xs = np.array(sorted(pts))
        smiles.setdefault(wanted[und], []).append(
            Smile(exp, f, float(np.median(idx)), xs, np.array([pts[x] for x in xs]))
        )
    return {
        a: OptionSurface(a, received_at, tuple(sorted(s, key=lambda z: z.expiry)), ref)
        for a, s in smiles.items()
    }


class DeribitOptions:
    """Fotos de opciones de Deribit (sin caché: solo sirven en vivo)."""

    def __init__(self, api: ApiClient) -> None:
        self.api = api

    def snapshot(self) -> dict[str, OptionSurface]:
        rows: list[dict[str, Any]] = []
        urls: list[str] = []
        received = None
        for cur in CURRENCIES:
            resp = self.api.request_json(
                "GET",
                "/api/v2/public/get_book_summary_by_currency",
                params={"currency": cur, "kind": "option"},
            )
            rows.extend(resp.data.get("result") or [])
            urls.append(resp.url)
            received = resp.received_at if received is None else min(received, resp.received_at)
        assert received is not None
        blob = json.dumps(rows, sort_keys=True)
        ref = DataRef(
            source=SOURCE,
            kind="foto_opciones",
            url=urls[0],
            sha256=hashlib.sha256(blob.encode()).hexdigest(),
            retrieved_at=received.isoformat(),
            observed_until=received.isoformat(),
            note=f"{len(rows)} opciones; monedas {', '.join(CURRENCIES)}",
        )
        return parse_surfaces(rows, received, ref)


def make_options(*, user_agent: str) -> DeribitOptions:
    return DeribitOptions(ApiClient(DERIBIT_BASE, name="deribit", rate_per_s=3,
                                    user_agent=user_agent))  # fmt: skip


# --- probabilidad --------------------------------------------------------------------------


def black76_call(f: float, k: float, w: float) -> float:
    """Call (sin descuento) con forward ``f``, nivel ``k`` y varianza total ``w``."""
    if w <= 1e-14:
        return max(f - k, 0.0)
    s = math.sqrt(w)
    d1 = (math.log(f / k) + 0.5 * w) / s
    return f * float(norm.cdf(d1)) - k * float(norm.cdf(d1 - s))


def digital_above(
    surf: OptionSurface, k: float, t: datetime, as_of: datetime, f: float, scale: float = 1.0
) -> float | None:
    """P(S_t > k) = −∂C/∂k con la sonrisa (diferencia finita centrada)."""
    h = H_REL * k
    lo, hi = k - h, k + h
    w_lo, w_hi = surf.total_var(lo, t, as_of), surf.total_var(hi, t, as_of)
    if w_lo is None or w_hi is None:
        return None
    c_lo = black76_call(f, lo, w_lo * scale * scale)
    c_hi = black76_call(f, hi, w_hi * scale * scale)
    return min(1.0, max(0.0, (c_lo - c_hi) / (2 * h)))


class OptionsPredictor(CryptoPredictor):
    """Lo que dicen los precios de opciones de Deribit sobre cada contrato."""

    def __init__(
        self, params: CryptoParams | None = None, calibration: CalibrationRegistry | None = None
    ) -> None:
        super().__init__("ewma", params, calibration)
        self.name = OPTIONS_NAME
        self.version = MODELS_V2_VERSION

    def predict_terms(
        self, market: MarketView, terms: CryptoTerms, evidence: CryptoEvidence, as_of: datetime
    ) -> Prediction:
        if terms.yes_outcome not in market.outcomes:
            return self._abstain(market, as_of, "resultado YES/Up no está en el mercado", terms)
        if as_of >= terms.resolution_time:
            return self._abstain(market, as_of, "el dato que resuelve ya existe en as_of", terms)
        surf = (getattr(evidence, "options", None) or {}).get(terms.asset)
        if surf is None:
            reason = (
                f"sin opciones de Deribit para {terms.asset}"
                if getattr(evidence, "options", None)
                else "sin foto de opciones (solo en vivo; no hay cadenas históricas)"
            )
            return self._abstain(market, as_of, reason, terms)
        if as_of - surf.received_at > MAX_AGE or surf.received_at > as_of:
            return self._abstain(market, as_of, "foto de opciones desactualizada", terms)
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
        details: dict[str, Any] = {
            "terms": terms.to_dict(),
            "spot": spot,
            "spot_time": last_close_t.isoformat(),
            "tau_min": round(tau_min, 3),
            "bucket": horizon_bucket(terms.resolution_time - as_of),
            "opciones_foto": surf.received_at.isoformat(),
        }
        settled = self._settled(terms, c, as_of)
        if settled is not None:
            p, why = settled
            details["decidido_por_datos"] = why
            return self._result(market, terms, as_of, p, (p, p), c, details, surf.ref)
        f_dbt = surf.forward_at(terms.resolution_time, as_of)
        if f_dbt is None:
            return self._abstain(market, as_of, "la resolución es posterior al último "
                                 "vencimiento de opciones", terms, details)  # fmt: skip
        f = f_dbt * spot / surf.smiles[0].index  # al precio de Binance
        details["forward"] = round(f, 8)
        out = self._probability(terms, c, as_of, spot, f, surf, details)
        if isinstance(out, str):
            return self._abstain(market, as_of, out, terms, details)
        p, lo, hi = out
        return self._result(market, terms, as_of, p, (lo, hi), c, details, surf.ref)

    def _probability(
        self,
        terms: CryptoTerms,
        c: Any,
        as_of: datetime,
        spot: float,
        f: float,
        surf: OptionSurface,
        details: dict[str, Any],
    ) -> tuple[float, float, float] | str:
        r_t = terms.resolution_time

        def above(k: float | None, scale: float) -> float | None:
            if k is None:
                return 1.0
            return digital_above(surf, k, r_t, as_of, f, scale)

        if terms.kind == "terminal" or (terms.kind == "updown" and self._reference(
                terms, c, as_of) is not None):  # fmt: skip
            if terms.kind == "terminal":
                lower, upper = terms.lower, terms.upper
            else:
                lower, upper = self._reference(terms, c, as_of), None
                details["referencia"] = lower
            vals = []
            for scale in (1.0, *INTERVAL_SIGMA):
                a = above(lower, scale)
                b = above(upper, scale) if upper is not None else 0.0
                if a is None or b is None:
                    return "sin varianza implícita hasta la resolución"
                vals.append(min(1.0, max(0.0, a - b)))
            return vals[0], min(vals), max(vals)
        # Toques y Up/Down con referencia futura: fórmulas de v1 con la σ implícita.
        k = terms.barrier if terms.kind == "touch" else f
        if k is None or k <= 0:
            return "nivel inválido para la σ implícita"
        w = surf.total_var(k, r_t, as_of)
        if w is None:
            return "sin varianza implícita hasta la resolución"
        tau = max((r_t - as_of).total_seconds() / 60.0, 1e-9)
        var_per_min = w / tau  # σ²·T (años) = varianza por minuto × minutos
        details["sigma_implicita"] = round(math.sqrt(var_per_min * YEAR_MIN), 6)
        vals = [
            CryptoPredictor._closed_form(
                self, terms, c, as_of, spot, var_per_min * s * s, details if s == 1.0 else None
            )
            for s in (1.0, *INTERVAL_SIGMA)
        ]
        return vals[0], min(vals), max(vals)
