"""Módulo E: valoración de una predicción contra el precio ejecutable (``valuation-v1``).

Por token (YES y NO de un mercado binario):

- probabilidad del modelo e intervalo; probabilidad implícita del mercado (punto
  medio del libro); precio ejecutable = VWAP del ask para el monto de la orden;
- diferencia en puntos porcentuales, valor esperado bruto y neto, costos
  (comisión del mercado + holgura de deslizamiento), valor esperado conservador
  (cota desfavorable del intervalo), incertidumbre y riesgo de liquidez.

Recomendación (solo papel: el sistema no envía órdenes):

- ``señal_operable``: todas las puertas pasan (ver ``gate_reasons``).
- ``alerta_investigacion``: discrepancia bruta >= umbral, pero alguna puerta falla.
- ``sin_ventaja``: no hay discrepancia relevante.
- ``informacion_insuficiente``: falta libro, ask o comisión verificable.
- ``abstencion``: el modelo se abstuvo.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

from radar.elections.engine import fee_per_share
from radar.market.orderbook import Level, simulate_buy
from radar.predict.base import CALIB_VALIDATED, MarketView, Prediction

VALUATION_VERSION = "valuation-v1"
REC_SIGNAL = "señal_operable"
REC_ALERT = "alerta_investigacion"
REC_NONE = "sin_ventaja"
REC_INSUFFICIENT = "informacion_insuficiente"
REC_ABSTAIN = "abstencion"
# forward-v1 (docs/PREREGISTRO_VIVO.md): solo puede quitar señales, nunca agregarlas.
SUSPENDED_REASON = "suspendido por la evaluación en vivo: peor que el mercado (forward-v1)"


@dataclass(frozen=True)
class ValuationConfig:
    order_size_usd: float = 25.0
    alert_threshold_pp: float = 5.0
    min_net_edge_pp: float = 1.0
    slippage_buffer: float = 0.005
    max_spread: float = 0.05
    max_book_age_s: float = 180.0
    depth_band: float = 0.02


@dataclass(frozen=True)
class BookView:
    token_id: str
    bids: list[Level]
    asks: list[Level]
    received_at: datetime
    source_ts: datetime | None = None


@dataclass
class Valuation:
    market_id: str
    token_id: str
    outcome: str
    as_of: datetime
    model: str
    model_version: str
    calibration_status: str
    supera_mercado: bool | None
    p_model: float | None
    p_low: float | None
    p_high: float | None
    best_bid: float | None = None
    best_ask: float | None = None
    spread: float | None = None
    p_market_mid: float | None = None
    book_received_at: datetime | None = None
    book_age_s: float | None = None
    ask_vwap: float | None = None
    fill_shares: float | None = None
    fill_complete: bool | None = None
    depth_ask_usd: float | None = None
    fee_per_share: float | None = None
    edge_pp: float | None = None
    ev_gross_per_share: float | None = None
    costs_per_share: float | None = None
    ev_net_per_share: float | None = None
    ev_net_usd: float | None = None
    ev_conservative_per_share: float | None = None
    uncertainty: float | None = None
    liquidity_risk: str | None = None
    recommendation: str = REC_INSUFFICIENT
    reasons: list[str] = field(default_factory=list)
    version: str = VALUATION_VERSION
    # paper-v2: precio de venta de una posición de papel abierta en este token (si la hay).
    sell_vwap: float | None = None
    sell_fee_per_share: float | None = None
    sell_complete: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for k in ("as_of", "book_received_at"):
            if d[k] is not None:
                d[k] = d[k].isoformat()
        return d


def _liquidity_risk(fill_complete: bool, spread: float | None, depth: float, size: float) -> str:
    if not fill_complete or spread is None or spread > 0.05:
        return "alto"
    if spread > 0.02 or depth < 4 * size:
        return "medio"
    return "bajo"


def value_token(
    market: MarketView,
    outcome: str,
    pred: Prediction,
    book: BookView | None,
    now: datetime,
    *,
    supera_mercado: bool | None,
    suspendido: bool = False,
    cfg: ValuationConfig | None = None,
) -> Valuation:
    cfg = cfg or ValuationConfig()
    idx = market.outcomes.index(outcome)
    token = market.token_ids[idx] if idx < len(market.token_ids) else ""
    p = pred.prob_for(outcome, market.outcomes)
    iv = pred.interval_for(outcome, market.outcomes)
    v = Valuation(
        market_id=market.market_id,
        token_id=token,
        outcome=outcome,
        as_of=pred.as_of,
        model=pred.model,
        model_version=pred.model_version,
        calibration_status=pred.calibration_status,
        supera_mercado=supera_mercado,
        p_model=p,
        p_low=iv[0] if iv else None,
        p_high=iv[1] if iv else None,
    )
    if p is None:
        v.recommendation = REC_ABSTAIN
        v.reasons = [pred.abstain_reason or "el modelo se abstuvo"]
        return v
    v.uncertainty = (iv[1] - iv[0]) if iv else None
    if book is None or not book.asks:
        v.recommendation = REC_INSUFFICIENT
        v.reasons = ["Información insuficiente: sin libro o sin asks en el CLOB"]
        return v
    v.best_bid = book.bids[0].price if book.bids else None
    v.best_ask = book.asks[0].price
    v.spread = (v.best_ask - v.best_bid) if v.best_bid is not None else None
    v.p_market_mid = (v.best_ask + v.best_bid) / 2 if v.best_bid is not None else None
    v.book_received_at = book.received_at
    v.book_age_s = (now - book.received_at).total_seconds()
    fill = simulate_buy(book.asks, notional_usd=cfg.order_size_usd)
    v.fill_shares = fill.filled_shares
    v.fill_complete = fill.fully_filled
    v.ask_vwap = fill.avg_price
    v.depth_ask_usd = sum(
        lv.price * lv.size for lv in book.asks if lv.price <= v.best_ask + cfg.depth_band
    )
    v.liquidity_risk = _liquidity_risk(
        fill.fully_filled, v.spread, v.depth_ask_usd, cfg.order_size_usd
    )
    if v.ask_vwap is None:
        v.recommendation = REC_INSUFFICIENT
        v.reasons = ["Información insuficiente: el libro no permite comprar"]
        return v
    fee = fee_per_share(v.ask_vwap, market.fee_rate, market.fee_exponent)
    v.fee_per_share = fee
    v.edge_pp = (p - v.ask_vwap) * 100
    v.ev_gross_per_share = p - v.ask_vwap
    if fee is None:
        v.recommendation = REC_INSUFFICIENT
        v.reasons = ["Información insuficiente: modelo de comisión del mercado no verificado"]
        return v
    v.costs_per_share = fee + cfg.slippage_buffer
    v.ev_net_per_share = v.ev_gross_per_share - v.costs_per_share
    v.ev_net_usd = v.ev_net_per_share * (fill.filled_shares or 0.0)
    if v.p_low is not None:
        v.ev_conservative_per_share = v.p_low - v.ask_vwap - v.costs_per_share
    reasons = gate_reasons(v, cfg)
    if suspendido:
        reasons.append(SUSPENDED_REASON)
    alert = v.edge_pp >= cfg.alert_threshold_pp
    if not reasons:
        v.recommendation = REC_SIGNAL
    elif alert:
        v.recommendation = REC_ALERT
    else:
        v.recommendation = REC_NONE
    v.reasons = reasons
    return v


def gate_reasons(v: Valuation, cfg: ValuationConfig) -> list[str]:
    """Motivos por los que NO sería una señal operable (lista vacía = señal)."""
    out = []
    if v.calibration_status != CALIB_VALIDATED:
        out.append(f"modelo no validado para este tipo de contrato ({v.calibration_status})")
    if v.supera_mercado is not True:
        out.append("el modelo no superó al mercado fuera de muestra")
    if v.edge_pp is None or v.edge_pp < cfg.alert_threshold_pp:
        out.append(f"discrepancia bruta {v.edge_pp or 0:.1f} p.p. < {cfg.alert_threshold_pp}")
    if v.ev_net_per_share is None or v.ev_net_per_share * 100 < cfg.min_net_edge_pp:
        out.append("ventaja neta tras costos insuficiente")
    if v.ev_conservative_per_share is None or v.ev_conservative_per_share <= 0:
        out.append("ventaja conservadora (cota del intervalo) no positiva")
    if not v.fill_complete:
        out.append(f"liquidez insuficiente para US${cfg.order_size_usd:.0f}")
    if v.spread is None or v.spread > cfg.max_spread:
        out.append(f"spread {v.spread} > {cfg.max_spread}")
    if v.book_age_s is None or v.book_age_s > cfg.max_book_age_s:
        out.append(f"libro con antigüedad {v.book_age_s}s > {cfg.max_book_age_s}s")
    return out


def attach_sell_quote(v: Valuation, book: BookView | None, shares: float | None,
                      market: MarketView) -> None:  # fmt: skip
    """Para ``paper-v2``: VWAP de venta de ``shares`` acciones en los bids del mismo libro con
    que se valoró, y su comisión. No cambia la recomendación."""
    if not shares or book is None or not book.bids:
        return
    from radar.market.orderbook import simulate_sell

    fill = simulate_sell(book.bids, shares=shares)
    v.sell_complete = fill.fully_filled
    v.sell_vwap = fill.avg_price
    if fill.avg_price is not None:
        v.sell_fee_per_share = fee_per_share(fill.avg_price, market.fee_rate, market.fee_exponent)
