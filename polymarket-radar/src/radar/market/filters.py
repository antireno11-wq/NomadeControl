"""Filtros deterministas de elegibilidad (metadatos) y de liquidez (order book).

Cada filtro devuelve la lista de motivos de rechazo; una lista vacía significa
que el mercado pasa. Los motivos se guardan para que el dashboard explique por
qué se descartó cada mercado.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from radar.ingestion.gamma import GammaMarket
from radar.market.orderbook import BookMetrics


def eligibility_reasons(market: GammaMarket, now: datetime) -> list[str]:
    reasons: list[str] = []
    if market.closed:
        reasons.append("closed")
    if not market.active:
        reasons.append("not_active")
    if market.archived:
        reasons.append("archived")
    if not market.enable_order_book:
        reasons.append("order_book_disabled")
    if not market.accepting_orders:
        reasons.append("not_accepting_orders")
    if not market.clob_token_ids:
        reasons.append("no_clob_tokens")
    elif len(market.clob_token_ids) != len(market.outcomes):
        reasons.append("outcome_token_mismatch")
    elif len(set(market.clob_token_ids)) != len(market.clob_token_ids):
        reasons.append("duplicate_token_ids")
    if market.end_date is not None and market.end_date <= now:
        reasons.append("end_date_passed")
    return reasons


@dataclass(frozen=True)
class LiquidityConfig:
    max_spread: float
    depth_band: float
    min_depth_usd: float


def liquidity_reasons(
    metrics_by_outcome: Sequence[BookMetrics | None], cfg: LiquidityConfig
) -> list[str]:
    """Todos los tokens del mercado deben tener libro de dos lados, sin cruce,
    spread acotado y profundidad mínima cerca del toque en ambos lados."""
    reasons: list[str] = []
    if not metrics_by_outcome:
        return ["no_books"]
    for idx, m in enumerate(metrics_by_outcome):
        tag = f"outcome{idx}"
        if m is None:
            reasons.append(f"{tag}:book_missing")
            continue
        if not m.two_sided:
            reasons.append(f"{tag}:one_sided")
            continue
        if m.crossed:
            reasons.append(f"{tag}:crossed")
            continue
        if m.spread is not None and m.spread > cfg.max_spread + 1e-9:
            reasons.append(f"{tag}:spread_too_wide")
        if m.bid_depth_band_usd < cfg.min_depth_usd:
            reasons.append(f"{tag}:insufficient_bid_depth")
        if m.ask_depth_band_usd < cfg.min_depth_usd:
            reasons.append(f"{tag}:insufficient_ask_depth")
    return reasons


def reason_family(reason: str) -> str:
    """'outcome1:one_sided' -> 'one_sided' (para agregar conteos)."""
    return reason.split(":", 1)[1] if ":" in reason else reason
