"""Servidor Polymarket FALSO para pruebas (datos SINTÉTICOS).

Imita la forma de las respuestas reales verificadas de Gamma y del CLOB
(campos codificados como cadenas JSON, paginación por cursor, orden de niveles
del libro) para probar el pipeline sin red. Nada de lo que produce representa
el mercado real.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

SYNTH = "synthetic"


def synthetic_market(
    market_id: str,
    *,
    event_id: str = "ev1",
    question: str | None = None,
    description: str = "SINTÉTICO: resuelve Yes si ocurre X antes de la fecha.",
    active: bool = True,
    closed: bool = False,
    accepting_orders: bool = True,
    enable_order_book: bool = True,
    end_date: str = "2099-01-01T00:00:00Z",
    tokens: list[str] | None = None,
    outcomes: list[str] | None = None,
    volume_24h: float = 1000.0,
) -> dict[str, Any]:
    tokens = tokens if tokens is not None else [f"{market_id}-yes", f"{market_id}-no"]
    outcomes = outcomes if outcomes is not None else ["Yes", "No"]
    return {
        "id": market_id,
        "question": question or f"[SINTÉTICO] ¿Evento {market_id}?",
        "conditionId": f"0xcond{market_id}",
        "questionID": f"0xq{market_id}",
        "slug": f"synthetic-{market_id}",
        "description": description,
        "resolutionSource": "",
        "outcomes": json.dumps(outcomes),
        "clobTokenIds": json.dumps(tokens),
        "outcomePrices": json.dumps(["0.5", "0.5"]),
        "startDate": "2026-01-01T00:00:00Z",
        "endDate": end_date,
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-10-01T00:00:00Z",
        "active": active,
        "closed": closed,
        "archived": False,
        "acceptingOrders": accepting_orders,
        "enableOrderBook": enable_order_book,
        "negRisk": False,
        "orderMinSize": 5,
        "orderPriceMinTickSize": 0.01,
        "feesEnabled": True,
        "feeType": "zero_fees",
        "feeSchedule": {"exponent": 1, "rate": 0, "takerOnly": True, "rebateRate": 0},
        "volumeNum": 5000.0,
        "volume24hr": volume_24h,
        "liquidityNum": 1000.0,
        "bestBid": 0.49,
        "bestAsk": 0.51,
        "lastTradePrice": 0.5,
        "events": [
            {
                "id": event_id,
                "slug": f"synthetic-event-{event_id}",
                "title": f"[SINTÉTICO] Evento {event_id}",
                "negRisk": False,
            }
        ],
    }


def synthetic_event(event_id: str, tags: list[str]) -> dict[str, Any]:
    return {
        "id": event_id,
        "slug": f"synthetic-event-{event_id}",
        "title": f"[SINTÉTICO] Evento {event_id}",
        "negRisk": False,
        "active": True,
        "closed": False,
        "updatedAt": "2026-10-01T00:00:00Z",
        "tags": [{"id": str(i), "label": t.title(), "slug": t} for i, t in enumerate(tags)],
    }


def liquid_book(
    token: str, *, bid: float = 0.49, ask: float = 0.51, size: float = 1000.0
) -> dict[str, Any]:
    """Libro de dos lados con profundidad holgada. Orden como la API real:
    bids ascendentes y asks descendentes (el mejor nivel al final)."""
    return {
        "market": "0xcond",
        "asset_id": token,
        "timestamp": "1792965150978",
        "hash": f"h-{token}-{bid}-{ask}-{size}",
        "bids": [
            {"price": f"{bid - 0.02:.2f}", "size": str(size)},
            {"price": f"{bid:.2f}", "size": str(size)},
        ],
        "asks": [
            {"price": f"{ask + 0.02:.2f}", "size": str(size)},
            {"price": f"{ask:.2f}", "size": str(size)},
        ],
        "min_order_size": "5",
        "tick_size": "0.01",
        "neg_risk": False,
        "last_trade_price": "0.50",
    }


def one_sided_book(token: str) -> dict[str, Any]:
    book = liquid_book(token)
    book["asks"] = []
    book["hash"] = f"h-{token}-onesided"
    return book


@dataclass
class FakePolymarket:
    markets: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    books: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Mercados visibles solo en la consulta por id (p. ej. ya cerrados).
    by_id_extra: dict[str, dict[str, Any]] = field(default_factory=dict)
    page_size: int = 100
    fail_markets_page: int | None = None  # 1-based; responde 500 siempre
    books_status: int | None = None  # fuerza un estado HTTP para /books
    bad_tokens: set[str] = field(default_factory=set)  # provocan 400 en su lote
    raw_invalid_markets: list[Any] = field(default_factory=list)
    requests: list[httpx.Request] = field(default_factory=list)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    # ------------------------------------------------------------------ rutas
    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/markets/keyset":
            return self._markets(request)
        if path == "/events/keyset":
            return self._events(request)
        if path == "/books" and request.method == "POST":
            return self._books(request)
        if path == "/time":
            return httpx.Response(200, json=1792965120)
        return httpx.Response(404, json={"error": "not found"})

    def _paginate(self, items: list[Any], request: httpx.Request) -> tuple[list[Any], str | None]:
        cursor = request.url.params.get("after_cursor")
        start = int(cursor) if cursor else 0
        limit = min(int(request.url.params.get("limit", self.page_size)), 100)
        chunk = items[start : start + limit]
        nxt = start + limit
        return chunk, (str(nxt) if nxt < len(items) else None)

    def _markets(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        if params.get("closed") == "any":
            ids = params.get_list("id")
            pool = {m["id"]: m for m in self.markets} | self.by_id_extra
            return httpx.Response(200, json={"markets": [pool[i] for i in ids if i in pool]})
        listing = self.raw_invalid_markets + [m for m in self.markets if not m["closed"]]
        cursor = params.get("after_cursor")
        page_no = (int(cursor) // self.page_size + 1) if cursor else 1
        if self.fail_markets_page is not None and page_no == self.fail_markets_page:
            return httpx.Response(500, text="synthetic failure")
        chunk, nxt = self._paginate(listing, request)
        body: dict[str, Any] = {"markets": chunk}
        if nxt:
            body["next_cursor"] = nxt
        return httpx.Response(200, json=body)

    def _events(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        events = self.events
        if tag := params.get("tag_slug"):
            events = [e for e in events if any(t["slug"] == tag for t in e.get("tags") or [])]
        if params.get("include_markets") == "true":
            # Como la API real: los mercados embebidos no traen el campo "events".
            events = [
                e | {"markets": [
                    {k: v for k, v in m.items() if k != "events"}
                    for m in self.markets
                    if (m.get("events") or [{}])[0].get("id") == e["id"]
                ]}
                for e in events
            ]  # fmt: skip
        chunk, nxt = self._paginate(events, request)
        body: dict[str, Any] = {"events": chunk}
        if nxt:
            body["next_cursor"] = nxt
        return httpx.Response(200, json=body)

    def _books(self, request: httpx.Request) -> httpx.Response:
        if self.books_status is not None:
            return httpx.Response(self.books_status, text="synthetic books failure")
        wanted = [item["token_id"] for item in json.loads(request.content)]
        if self.bad_tokens & set(wanted):
            return httpx.Response(400, json={"error": "invalid token id"})
        return httpx.Response(200, json=[self.books[t] for t in wanted if t in self.books])
