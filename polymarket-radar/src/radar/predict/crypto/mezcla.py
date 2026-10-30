"""``cripto2-mezcla``: modelos v2 combinados con el libro de Polymarket (fase A).

Reglas en ``docs/PREREGISTRO_CRIPTO_V2.md``:

- promedio simple de los logits disponibles de ``cripto2-vol``, ``cripto2-opciones`` y el
  punto medio del libro del resultado YES; exige el punto medio y al menos un modelo;
- el punto medio es solo un dato de entrada, nunca un precio de compra;
- guarda en ``details.features`` las variables del libro para ajustar la fase B.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

from radar.predict.base import CALIB_NOT_EVALUATED, MarketView, Prediction, abstain
from radar.predict.crypto.options import OPTIONS_NAME
from radar.predict.crypto.terms import CryptoTerms
from radar.predict.crypto.v2 import MODELS_V2_VERSION, VOL_NAME, logit
from radar.predict.valuation import BookView

MEZCLA_NAME = "cripto2-mezcla"
FAMILY = "cripto"
DEPTH_BAND = 0.05  # profundidad contada a ≤ 0,05 del punto medio
PREV_MID_AGE = (timedelta(minutes=20), timedelta(minutes=45))


def book_features(book: BookView | None) -> dict[str, float] | None:
    """Punto medio, spread y desequilibrio del libro; None si falta un lado."""
    if book is None or not book.bids or not book.asks:
        return None
    bid, ask = book.bids[0].price, book.asks[0].price
    mid = (bid + ask) / 2
    depth_bid = sum(lv.size for lv in book.bids if lv.price >= mid - DEPTH_BAND)
    depth_ask = sum(lv.size for lv in book.asks if lv.price <= mid + DEPTH_BAND)
    total = depth_bid + depth_ask
    return {
        "mid": mid,
        "spread": ask - bid,
        "desequilibrio": (depth_bid - depth_ask) / total if total > 0 else 0.0,
        "prof_compra": depth_bid,
        "prof_venta": depth_ask,
    }


def mezcla_prediction(
    market: MarketView,
    terms: CryptoTerms,
    preds: dict[str, Prediction],
    book_yes: BookView | None,
    prev_mid: tuple[float, datetime] | None,
    as_of: datetime,
) -> Prediction:
    def skip(reason: str) -> Prediction:
        return abstain(market, model=MEZCLA_NAME, version=MODELS_V2_VERSION, family=FAMILY,
                       as_of=as_of, reason=reason, outcome=terms.yes_outcome,
                       details={"terms": terms.to_dict()})  # fmt: skip

    feats = book_features(book_yes)
    if feats is None:
        return skip("sin libro con compra y venta para el resultado YES")
    comps: dict[str, float] = {}
    for name in (VOL_NAME, OPTIONS_NAME):
        pr = preds.get(name)
        if pr is not None and pr.probability is not None:
            comps[name] = logit(pr.probability)
    if not comps:
        return skip("ningún modelo v2 dio probabilidad")
    comps["mercado_mid"] = logit(feats["mid"])
    z = sum(comps.values()) / len(comps)
    p = 1.0 / (1.0 + math.exp(-z))
    features: dict[str, Any] = dict(feats) | {f"logit_{k}": v for k, v in comps.items()}
    features["cambio_mid"] = None
    if prev_mid is not None:
        mid0, t0 = prev_mid
        if PREV_MID_AGE[0] <= as_of - t0 <= PREV_MID_AGE[1]:
            features["cambio_mid"] = feats["mid"] - mid0
    ref = preds.get(VOL_NAME) or preds.get(OPTIONS_NAME)
    details = {
        "terms": terms.to_dict(),
        "tau_min": (ref.details.get("tau_min") if ref else None)
        or round((terms.resolution_time - as_of).total_seconds() / 60, 3),
        "bucket": ref.details.get("bucket") if ref else None,
        "componentes": sorted(comps),
        "features": features,
    }
    return Prediction(
        market_id=market.market_id,
        outcome=terms.yes_outcome,
        probability=p,
        interval=(p, p),
        model=MEZCLA_NAME,
        model_version=MODELS_V2_VERSION,
        family=FAMILY,
        as_of=as_of,
        calibration_status=CALIB_NOT_EVALUATED,
        details=details,
    )
