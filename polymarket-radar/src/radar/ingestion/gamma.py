"""Conector de solo lectura a Polymarket Gamma API.

Endpoints usados (verificados contra https://gamma-api.polymarket.com/openapi.json):

- ``GET /markets/keyset``: mercados abiertos con paginación por cursor
  (``after_cursor`` / ``next_cursor``). Máximo 100 por página. El listado con
  ``offset`` de ``/markets`` está deprecado (cabecera ``warning: use /markets/keyset``).
- ``GET /markets/keyset?closed=any&id=..``: estado actual de mercados concretos,
  incluidos los cerrados (para confirmar cierres).
- ``GET /events/keyset?include_markets=false``: eventos abiertos con sus etiquetas.

Gamma entrega varios campos como cadenas JSON (``outcomes``, ``clobTokenIds``,
``outcomePrices``); aquí se decodifican y validan. Los precios de Gamma
(``outcomePrices``, ``bestBid``, ``bestAsk``, ``lastTradePrice``) son
indicativos: el precio ejecutable se obtiene siempre del order book del CLOB.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from radar.ingestion.http import ApiClient, ApiError
from radar.timeutil import parse_iso

SOURCE = "polymarket_gamma"


def _decode_json_list(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        decoded = json.loads(value)
        if not isinstance(decoded, list):
            raise ValueError("se esperaba una lista JSON")
        return decoded
    raise ValueError(f"tipo inesperado para lista: {type(value).__name__}")


def _opt_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class GammaEventRef(BaseModel):
    """Referencia a evento embebida en cada mercado."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    slug: str | None = None
    title: str | None = None
    description: str | None = None
    neg_risk: bool | None = Field(default=None, alias="negRisk")
    start_date: datetime | None = Field(default=None, alias="startDate")
    end_date: datetime | None = Field(default=None, alias="endDate")
    active: bool | None = None
    closed: bool | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _id_str(cls, v: Any) -> str:
        return str(v)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def _dates(cls, v: Any) -> datetime | None:
        return parse_iso(v)


class GammaTag(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    label: str | None = None
    slug: str | None = None

    @field_validator("id", mode="before")
    @classmethod
    def _id_str(cls, v: Any) -> str | None:
        return None if v is None else str(v)


class GammaEvent(GammaEventRef):
    tags: list[GammaTag] = Field(default_factory=list)
    source_updated_at: datetime | None = Field(default=None, alias="updatedAt")
    resolution_source: str | None = Field(default=None, alias="resolutionSource")

    @field_validator("source_updated_at", mode="before")
    @classmethod
    def _updated(cls, v: Any) -> datetime | None:
        return parse_iso(v)

    @field_validator("tags", mode="before")
    @classmethod
    def _tags(cls, v: Any) -> list[Any]:
        return v or []


class GammaMarket(BaseModel):
    """Mercado de Gamma validado. Campos requeridos: id y question."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    question: str
    condition_id: str | None = Field(default=None, alias="conditionId")
    question_id: str | None = Field(default=None, alias="questionID")
    slug: str | None = None
    description: str | None = None
    resolution_source: str | None = Field(default=None, alias="resolutionSource")
    outcomes: list[str] = Field(default_factory=list)
    clob_token_ids: list[str] = Field(default_factory=list, alias="clobTokenIds")
    outcome_prices: list[float] = Field(default_factory=list, alias="outcomePrices")
    start_date: datetime | None = Field(default=None, alias="startDate")
    end_date: datetime | None = Field(default=None, alias="endDate")
    source_created_at: datetime | None = Field(default=None, alias="createdAt")
    source_updated_at: datetime | None = Field(default=None, alias="updatedAt")
    closed_time: datetime | None = Field(default=None, alias="closedTime")
    active: bool = False
    closed: bool = False
    archived: bool = False
    restricted: bool | None = None
    accepting_orders: bool = Field(default=False, alias="acceptingOrders")
    enable_order_book: bool = Field(default=False, alias="enableOrderBook")
    neg_risk: bool = Field(default=False, alias="negRisk")
    neg_risk_market_id: str | None = Field(default=None, alias="negRiskMarketID")
    group_item_title: str | None = Field(default=None, alias="groupItemTitle")
    order_min_size: float | None = Field(default=None, alias="orderMinSize")
    tick_size: float | None = Field(default=None, alias="orderPriceMinTickSize")
    fees_enabled: bool | None = Field(default=None, alias="feesEnabled")
    fee_type: str | None = Field(default=None, alias="feeType")
    fee_schedule: dict[str, Any] | None = Field(default=None, alias="feeSchedule")
    maker_base_fee: float | None = Field(default=None, alias="makerBaseFee")
    taker_base_fee: float | None = Field(default=None, alias="takerBaseFee")
    uma_resolution_status: str | None = Field(default=None, alias="umaResolutionStatus")
    volume: float | None = Field(default=None, alias="volumeNum")
    liquidity: float | None = Field(default=None, alias="liquidityNum")
    volume_24h: float | None = Field(default=None, alias="volume24hr")
    best_bid: float | None = Field(default=None, alias="bestBid")
    best_ask: float | None = Field(default=None, alias="bestAsk")
    last_trade_price: float | None = Field(default=None, alias="lastTradePrice")
    events: list[GammaEventRef] = Field(default_factory=list)

    @field_validator("id", mode="before")
    @classmethod
    def _id_str(cls, v: Any) -> str:
        if v is None or v == "":
            raise ValueError("id vacío")
        return str(v)

    @field_validator("question", mode="before")
    @classmethod
    def _question(cls, v: Any) -> str:
        if v is None or not str(v).strip():
            raise ValueError("question vacía")
        return str(v)

    @field_validator("outcomes", "clob_token_ids", mode="before")
    @classmethod
    def _str_list(cls, v: Any) -> list[str]:
        return [str(x) for x in _decode_json_list(v)]

    @field_validator("outcome_prices", mode="before")
    @classmethod
    def _float_list(cls, v: Any) -> list[float]:
        return [float(x) for x in _decode_json_list(v)]

    @field_validator(
        "start_date",
        "end_date",
        "source_created_at",
        "source_updated_at",
        "closed_time",
        mode="before",
    )
    @classmethod
    def _dates(cls, v: Any) -> datetime | None:
        return parse_iso(v)

    @field_validator(
        "order_min_size",
        "tick_size",
        "maker_base_fee",
        "taker_base_fee",
        "volume",
        "liquidity",
        "volume_24h",
        "best_bid",
        "best_ask",
        "last_trade_price",
        mode="before",
    )
    @classmethod
    def _floats(cls, v: Any) -> float | None:
        return _opt_float(v)

    @field_validator("events", mode="before")
    @classmethod
    def _events(cls, v: Any) -> list[Any]:
        return v or []

    @property
    def event(self) -> GammaEventRef | None:
        return self.events[0] if self.events else None

    def rules_hash(self) -> str:
        """Huella de los campos que definen el contrato (detecta cambios de reglas)."""
        payload = {
            "question": self.question,
            "description": self.description,
            "resolution_source": self.resolution_source,
            "outcomes": self.outcomes,
            "clob_token_ids": self.clob_token_ids,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "condition_id": self.condition_id,
        }
        blob = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
        return hashlib.sha256(blob).hexdigest()


def strip_raw(raw: dict[str, Any]) -> dict[str, Any]:
    """Copia del JSON crudo sin los eventos embebidos (se guardan en su tabla)."""
    return {k: v for k, v in raw.items() if k != "events"}


@dataclass
class MarketPage:
    page_number: int
    markets: list[dict[str, Any]]
    received_at: datetime
    url: str
    next_cursor: str | None


@dataclass
class EventPage:
    page_number: int
    events: list[dict[str, Any]]
    received_at: datetime
    url: str
    next_cursor: str | None


@dataclass
class ParseOutcome:
    valid: list[tuple[GammaMarket, dict[str, Any]]] = field(default_factory=list)
    invalid: list[tuple[str | None, str]] = field(default_factory=list)


def parse_markets(raws: list[dict[str, Any]]) -> ParseOutcome:
    out = ParseOutcome()
    for raw in raws:
        if not isinstance(raw, dict):
            out.invalid.append((None, f"elemento no es objeto: {type(raw).__name__}"))
            continue
        try:
            out.valid.append((GammaMarket.model_validate(raw), raw))
        except (ValidationError, ValueError) as exc:
            out.invalid.append((str(raw.get("id")) if raw.get("id") else None, str(exc)[:500]))
    return out


class GammaClient:
    def __init__(self, api: ApiClient, *, page_size: int = 100) -> None:
        self.api = api
        self.page_size = page_size

    def iter_market_pages(self, *, max_pages: int | None = None) -> Iterator[MarketPage]:
        """Recorre todos los mercados abiertos (``closed=false``).

        Lanza ``ApiError`` si una página falla tras los reintentos: sin cursor no
        es posible continuar, y quien llama debe marcar la descubierta incompleta.
        """
        cursor: str | None = None
        page = 0
        while max_pages is None or page < max_pages:
            params: dict[str, Any] = {"limit": self.page_size, "closed": "false"}
            if cursor:
                params["after_cursor"] = cursor
            resp = self.api.request_json("GET", "/markets/keyset", params=params)
            data = resp.data
            if not isinstance(data, dict) or not isinstance(data.get("markets", []), list | None):
                raise ApiError(
                    "gamma: estructura inesperada en /markets/keyset",
                    url=resp.url,
                    status=resp.status,
                    error_type="schema",
                )
            markets = data.get("markets") or []
            cursor = data.get("next_cursor") or None
            page += 1
            yield MarketPage(page, markets, resp.received_at, resp.url, cursor)
            if not cursor or not markets:
                return

    def iter_event_pages(
        self,
        *,
        max_pages: int | None = None,
        tag_slug: str | None = None,
        include_markets: bool = False,
    ) -> Iterator[EventPage]:
        """Eventos abiertos. Con ``tag_slug``, solo los de esa etiqueta; con
        ``include_markets``, cada evento trae sus mercados (sin el campo ``events``)."""
        cursor: str | None = None
        page = 0
        while max_pages is None or page < max_pages:
            params: dict[str, Any] = {
                "limit": self.page_size,
                "closed": "false",
                "include_markets": "true" if include_markets else "false",
            }
            if tag_slug:
                params["tag_slug"] = tag_slug
            if cursor:
                params["after_cursor"] = cursor
            resp = self.api.request_json("GET", "/events/keyset", params=params)
            data = resp.data
            if not isinstance(data, dict):
                raise ApiError(
                    "gamma: estructura inesperada en /events/keyset",
                    url=resp.url,
                    status=resp.status,
                    error_type="schema",
                )
            events = data.get("events") or []
            cursor = data.get("next_cursor") or None
            page += 1
            yield EventPage(page, events, resp.received_at, resp.url, cursor)
            if not cursor or not events:
                return

    def fetch_markets_by_ids(self, ids: list[str]) -> tuple[list[dict[str, Any]], datetime]:
        """Estado actual (abiertos o cerrados) de los mercados indicados."""
        params: list[tuple[str, str]] = [("closed", "any"), ("limit", str(len(ids)))]
        params += [("id", i) for i in ids]
        resp = self.api.request_json("GET", "/markets/keyset", params=params)
        data = resp.data
        if not isinstance(data, dict):
            raise ApiError(
                "gamma: estructura inesperada en consulta por id",
                url=resp.url,
                status=resp.status,
                error_type="schema",
            )
        return data.get("markets") or [], resp.received_at

    def ping(self) -> datetime:
        resp = self.api.request_json("GET", "/markets/keyset", params={"limit": 1})
        return resp.received_at
