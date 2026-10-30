"""Historial de mercado de Polymarket para backtests: precios de referencia y operaciones.

Dos fuentes, con significados distintos que nunca se mezclan:

- ``prices-history`` (CLOB): serie temporal de un precio por token. **No es un
  precio ejecutable**: es un precio de referencia publicado por Polymarket. Se
  etiqueta ``precio_referencia_no_ejecutable``.
- ``trades`` (data-api, ``takerOnly=true``): operaciones reales ejecutadas, con
  lado, precio, tamaño, timestamp y hash de transacción. Una compra (``BUY``) de
  un token a precio p prueba que en ese instante alguien pudo comprar ese tamaño
  a p. Se etiqueta ``precio_ejecutado_observado``. No prueba que hubiera más
  profundidad que la ejecutada.

Polymarket no publica libros de órdenes históricos: el ask exacto de un instante
pasado no está disponible.

Las respuestas crudas se guardan en disco con SHA-256 para reproducir el backtest.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from radar.ingestion.http import ApiClient

PRICE_BASIS_REFERENCE = "precio_referencia_no_ejecutable"
PRICE_BASIS_TRADES = "precio_ejecutado_observado"
PRICE_BASIS_ASK = "ask_ejecutable"
MAX_HISTORY_WINDOW = timedelta(days=14)


@dataclass(frozen=True)
class PricePoint:
    t: datetime
    price: float


@dataclass(frozen=True)
class Trade:
    t: datetime
    side: str  # BUY | SELL (del tomador)
    asset: str
    outcome: str | None
    price: float
    size: float
    tx: str | None

    @property
    def notional(self) -> float:
        return self.price * self.size


class RawCache:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, kind: str, key: str) -> Path:
        digest = hashlib.sha256(key.encode()).hexdigest()[:24]
        return self.root / kind / f"{digest}.json"

    def get(self, kind: str, key: str) -> dict[str, Any] | None:
        p = self._path(kind, key)
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def put(
        self, kind: str, key: str, url: str, data: Any, received_at: datetime
    ) -> dict[str, Any]:
        blob = json.dumps(data, sort_keys=True, ensure_ascii=False)
        rec = {
            "key": key,
            "url": url,
            "received_at": received_at.isoformat(),
            "sha256": hashlib.sha256(blob.encode()).hexdigest(),
            "data": data,
        }
        p = self._path(kind, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        return rec


class MarketHistory:
    def __init__(self, clob: ApiClient, data_api: ApiClient, cache: RawCache) -> None:
        self.clob = clob
        self.data_api = data_api
        self.cache = cache
        self.sources: list[dict[str, Any]] = []  # procedencia de lo consultado

    def _record(self, kind: str, rec: dict[str, Any]) -> None:
        self.sources.append(
            {
                "kind": kind,
                "url": rec["url"],
                "received_at": rec["received_at"],
                "sha256": rec["sha256"],
            }
        )

    def price_history(
        self, token_id: str, start: datetime, end: datetime, *, fidelity_min: int = 60
    ) -> list[PricePoint]:
        points: dict[int, float] = {}
        t0 = start
        while t0 < end:
            t1 = min(t0 + MAX_HISTORY_WINDOW, end)
            params = {
                "market": token_id,
                "startTs": int(t0.timestamp()),
                "endTs": int(t1.timestamp()),
                "fidelity": fidelity_min,
            }
            key = json.dumps(params, sort_keys=True)
            rec = self.cache.get("prices_history", key)
            if rec is None:
                resp = self.clob.request_json("GET", "/prices-history", params=params)
                rec = self.cache.put("prices_history", key, resp.url, resp.data, resp.received_at)
            self._record("prices_history", rec)
            for x in rec["data"].get("history") or []:
                points[int(x["t"])] = float(x["p"])
            t0 = t1
        return [PricePoint(datetime.fromtimestamp(t, UTC), p) for t, p in sorted(points.items())]

    def trades(self, condition_id: str, start: datetime, end: datetime) -> list[Trade]:
        out: list[Trade] = []
        offset = 0
        while True:
            params = {
                "market": condition_id,
                "takerOnly": "true",
                "start": int(start.timestamp()),
                "end": int(end.timestamp()),
                "limit": 500,
                "offset": offset,
            }
            key = json.dumps(params, sort_keys=True)
            rec = self.cache.get("trades", key)
            if rec is None:
                resp = self.data_api.request_json("GET", "/trades", params=params)
                rec = self.cache.put("trades", key, resp.url, resp.data, resp.received_at)
            self._record("trades", rec)
            batch = rec["data"] if isinstance(rec["data"], list) else []
            for t in batch:
                ts = datetime.fromtimestamp(int(t["timestamp"]), UTC)
                if not start <= ts <= end:
                    continue
                out.append(
                    Trade(
                        t=ts,
                        side=str(t.get("side")),
                        asset=str(t.get("asset")),
                        outcome=t.get("outcome"),
                        price=float(t["price"]),
                        size=float(t["size"]),
                        tx=t.get("transactionHash"),
                    )
                )
            if len(batch) < 500 or offset >= 9500:
                break
            offset += 500
        return sorted(out, key=lambda x: x.t)


def price_at(points: list[PricePoint], t: datetime) -> PricePoint | None:
    """Último punto con timestamp <= t (sin mirar al futuro)."""
    best = None
    for p in points:
        if p.t <= t:
            best = p
        else:
            break
    return best


@dataclass(frozen=True)
class TradeEvidence:
    asset: str
    window_start: datetime
    window_end: datetime
    n_buys: int
    buy_shares: float
    buy_notional: float
    min_buy_price: float | None
    max_buy_price: float | None
    vwap_buy_price: float | None
    last_buy: Trade | None


def buy_evidence(trades: list[Trade], asset: str, start: datetime, end: datetime) -> TradeEvidence:
    buys = [t for t in trades if t.asset == asset and t.side == "BUY" and start <= t.t <= end]
    shares = sum(t.size for t in buys)
    notional = sum(t.notional for t in buys)
    return TradeEvidence(
        asset=asset,
        window_start=start,
        window_end=end,
        n_buys=len(buys),
        buy_shares=round(shares, 6),
        buy_notional=round(notional, 6),
        min_buy_price=min((t.price for t in buys), default=None),
        max_buy_price=max((t.price for t in buys), default=None),
        vwap_buy_price=round(notional / shares, 6) if shares > 0 else None,
        last_buy=buys[-1] if buys else None,
    )
