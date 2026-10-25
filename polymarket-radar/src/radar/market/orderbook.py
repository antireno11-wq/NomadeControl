"""Métricas de order book y simulación de llenado contra la profundidad visible.

Convenciones:
- Los precios son por acción (share) y están en [0, 1] USDC; una acción ganadora
  paga 1 USDC.
- ``spread = best_ask - best_bid`` del mismo token.
- La profundidad en USD es el nocional ``precio × tamaño`` de los niveles.
- El precio ejecutable de compra es el ask, nunca el último precio negociado ni el
  midpoint. Para montos mayores que el primer nivel se recorre el libro (VWAP).
- No se asume ningún orden en los niveles recibidos: se normalizan aquí.
- La simulación solo usa la profundidad visible en el snapshot: no modela órdenes
  ocultas, latencia ni la reacción de otros participantes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

EPS = 1e-12


@dataclass(frozen=True)
class Level:
    price: float
    size: float

    @property
    def notional(self) -> float:
        return self.price * self.size


def _to_levels(raw: Iterable[Any]) -> list[Level]:
    levels: list[Level] = []
    for item in raw:
        if isinstance(item, Level):
            lvl = item
        elif isinstance(item, dict):
            lvl = Level(float(item["price"]), float(item["size"]))
        else:
            lvl = Level(float(item.price), float(item.size))
        if lvl.size > EPS:
            levels.append(lvl)
    return levels


def normalize_book(bids: Iterable[Any], asks: Iterable[Any]) -> tuple[list[Level], list[Level]]:
    """Bids de mayor a menor precio, asks de menor a mayor; elimina tamaños nulos."""
    return (
        sorted(_to_levels(bids), key=lambda lv: lv.price, reverse=True),
        sorted(_to_levels(asks), key=lambda lv: lv.price),
    )


@dataclass(frozen=True)
class BookMetrics:
    best_bid: float | None
    best_ask: float | None
    best_bid_size: float | None
    best_ask_size: float | None
    mid: float | None
    spread: float | None
    bid_levels: int
    ask_levels: int
    bid_depth_usd: float
    ask_depth_usd: float
    bid_depth_band_usd: float
    ask_depth_band_usd: float
    two_sided: bool
    crossed: bool


def compute_metrics(bids: list[Level], asks: list[Level], *, band: float) -> BookMetrics:
    """Calcula métricas sobre un libro ya normalizado.

    ``band``: ancho (en precio) desde el mejor nivel para medir profundidad cercana.
    """
    best_bid = bids[0] if bids else None
    best_ask = asks[0] if asks else None
    two_sided = best_bid is not None and best_ask is not None
    mid = spread = None
    crossed = False
    if two_sided:
        assert best_bid is not None and best_ask is not None
        spread = round(best_ask.price - best_bid.price, 6)
        mid = round((best_ask.price + best_bid.price) / 2, 6)
        crossed = best_bid.price >= best_ask.price
    bid_band = (
        sum(lv.notional for lv in bids if lv.price >= best_bid.price - band - EPS)
        if best_bid
        else 0.0
    )
    ask_band = (
        sum(lv.notional for lv in asks if lv.price <= best_ask.price + band + EPS)
        if best_ask
        else 0.0
    )
    return BookMetrics(
        best_bid=best_bid.price if best_bid else None,
        best_ask=best_ask.price if best_ask else None,
        best_bid_size=best_bid.size if best_bid else None,
        best_ask_size=best_ask.size if best_ask else None,
        mid=mid,
        spread=spread,
        bid_levels=len(bids),
        ask_levels=len(asks),
        bid_depth_usd=round(sum(lv.notional for lv in bids), 6),
        ask_depth_usd=round(sum(lv.notional for lv in asks), 6),
        bid_depth_band_usd=round(bid_band, 6),
        ask_depth_band_usd=round(ask_band, 6),
        two_sided=two_sided,
        crossed=crossed,
    )


@dataclass(frozen=True)
class Fill:
    side: str  # "buy" | "sell"
    requested_shares: float | None
    requested_notional: float | None
    filled_shares: float
    notional_usd: float  # costo pagado (compra) o importe recibido (venta)
    avg_price: float | None
    best_price: float | None
    worst_price: float | None
    slippage: float | None  # |avg_price - best_price|
    fully_filled: bool
    levels_consumed: int


def simulate_buy(
    asks: list[Level], *, notional_usd: float | None = None, shares: float | None = None
) -> Fill:
    """Compra recorriendo asks ordenados de menor a mayor.

    Exactamente uno de ``notional_usd`` (gasto máximo) o ``shares`` (cantidad).
    Si la profundidad no alcanza, el llenado es parcial (``fully_filled=False``).
    """
    if (notional_usd is None) == (shares is None):
        raise ValueError("indique notional_usd o shares (exactamente uno)")
    budget = notional_usd
    want = shares
    filled = cost = 0.0
    worst = None
    used = 0
    for lv in asks:
        if budget is not None:
            remaining = budget - cost
            if remaining <= EPS:
                break
            take = min(lv.size, remaining / lv.price) if lv.price > 0 else lv.size
        else:
            assert want is not None
            remaining = want - filled
            if remaining <= EPS:
                break
            take = min(lv.size, remaining)
        if take <= EPS:
            break
        filled += take
        cost += take * lv.price
        worst = lv.price
        used += 1
    target_met = (budget is not None and budget - cost <= 1e-9) or (
        want is not None and want - filled <= 1e-9
    )
    best = asks[0].price if asks else None
    avg = cost / filled if filled > EPS else None
    return Fill(
        side="buy",
        requested_shares=shares,
        requested_notional=notional_usd,
        filled_shares=round(filled, 6),
        notional_usd=round(cost, 6),
        avg_price=round(avg, 6) if avg is not None else None,
        best_price=best,
        worst_price=worst,
        slippage=round(avg - best, 6) if avg is not None and best is not None else None,
        fully_filled=bool(target_met),
        levels_consumed=used,
    )


def simulate_sell(bids: list[Level], *, shares: float) -> Fill:
    """Venta de ``shares`` recorriendo bids ordenados de mayor a menor."""
    filled = proceeds = 0.0
    worst = None
    used = 0
    for lv in bids:
        remaining = shares - filled
        if remaining <= EPS:
            break
        take = min(lv.size, remaining)
        filled += take
        proceeds += take * lv.price
        worst = lv.price
        used += 1
    best = bids[0].price if bids else None
    avg = proceeds / filled if filled > EPS else None
    return Fill(
        side="sell",
        requested_shares=shares,
        requested_notional=None,
        filled_shares=round(filled, 6),
        notional_usd=round(proceeds, 6),
        avg_price=round(avg, 6) if avg is not None else None,
        best_price=best,
        worst_price=worst,
        slippage=round(best - avg, 6) if avg is not None and best is not None else None,
        fully_filled=shares - filled <= 1e-9,
        levels_consumed=used,
    )


def truncate_levels(levels: list[Level], max_levels: int) -> list[dict[str, float]]:
    """Niveles más cercanos al toque, serializables a JSON."""
    return [{"price": lv.price, "size": lv.size} for lv in levels[:max_levels]]
