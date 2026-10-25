"""Conector de solo lectura al CLOB público de Polymarket (order books).

- ``POST /books`` con ``[{"token_id": ...}, ...]`` devuelve los libros de varios
  tokens (verificado con lotes de 200).
- ``GET /time`` sirve como comprobación de conectividad.

No se usa ningún endpoint autenticado ni de envío de órdenes.

El campo ``timestamp`` del libro (milisegundos) es el timestamp del evento en la
fuente; se guarda separado del timestamp de recepción. El orden de los niveles
en la respuesta no se asume: se normaliza en ``radar.market.orderbook``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from radar.ingestion.http import ApiClient, ApiError
from radar.logging_setup import get_logger
from radar.timeutil import from_epoch_ms

log = get_logger(__name__)

SOURCE = "polymarket_clob"


class BookLevel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    price: float
    size: float

    @field_validator("price")
    @classmethod
    def _price(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError(f"precio fuera de [0,1]: {v}")
        return v

    @field_validator("size")
    @classmethod
    def _size(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"tamaño negativo: {v}")
        return v


class ClobBook(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    asset_id: str
    market: str | None = None
    source_ts: datetime | None = Field(default=None, alias="timestamp")
    hash: str | None = None
    bids: list[BookLevel] = Field(default_factory=list)
    asks: list[BookLevel] = Field(default_factory=list)
    min_order_size: float | None = None
    tick_size: float | None = None
    neg_risk: bool | None = None
    last_trade_price: float | None = None

    @field_validator("asset_id", mode="before")
    @classmethod
    def _asset(cls, v: Any) -> str:
        if v is None or v == "":
            raise ValueError("asset_id vacío")
        return str(v)

    @field_validator("source_ts", mode="before")
    @classmethod
    def _ts(cls, v: Any) -> datetime | None:
        return from_epoch_ms(v)

    @field_validator("bids", "asks", mode="before")
    @classmethod
    def _levels(cls, v: Any) -> list[Any]:
        return v or []

    @field_validator("min_order_size", "tick_size", "last_trade_price", mode="before")
    @classmethod
    def _floats(cls, v: Any) -> float | None:
        if v is None or v == "":
            return None
        return float(v)


@dataclass
class BookFetchResult:
    books: dict[str, tuple[ClobBook, datetime]] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    invalid: list[tuple[str | None, str]] = field(default_factory=list)
    failed: list[tuple[list[str], ApiError]] = field(default_factory=list)
    requests: int = 0


class ClobClient:
    def __init__(self, api: ApiClient, *, batch_size: int = 200) -> None:
        self.api = api
        self.batch_size = batch_size

    def server_time(self) -> Any:
        return self.api.request_json("GET", "/time").data

    def fetch_books(self, token_ids: list[str]) -> BookFetchResult:
        result = BookFetchResult()
        for start in range(0, len(token_ids), self.batch_size):
            self._fetch_batch(token_ids[start : start + self.batch_size], result)
        return result

    def _fetch_batch(self, batch: list[str], result: BookFetchResult) -> None:
        if not batch:
            return
        result.requests += 1
        try:
            resp = self.api.request_json("POST", "/books", json=[{"token_id": t} for t in batch])
        except ApiError as exc:
            # Un 4xx (no 429) puede deberse a un único token problemático: se
            # divide el lote para aislarlo. Errores de red o 5xx ya agotaron sus
            # reintentos y no se insiste.
            is_client_error = exc.status is not None and 400 <= exc.status < 500
            if is_client_error and exc.status not in (403, 429) and len(batch) > 1:
                mid = len(batch) // 2
                log.warning("clob_batch_bisect", size=len(batch), status=exc.status)
                self._fetch_batch(batch[:mid], result)
                self._fetch_batch(batch[mid:], result)
                return
            result.failed.append((batch, exc))
            return

        data = resp.data
        if not isinstance(data, list):
            result.failed.append(
                (
                    batch,
                    ApiError(
                        "clob: /books no devolvió una lista",
                        url=resp.url,
                        status=resp.status,
                        error_type="schema",
                    ),
                )
            )
            return
        requested = set(batch)
        seen: set[str] = set()
        for raw in data:
            asset = str(raw.get("asset_id")) if isinstance(raw, dict) else None
            try:
                book = ClobBook.model_validate(raw)
            except (ValidationError, ValueError, TypeError) as exc:
                result.invalid.append((asset, str(exc)[:500]))
                if asset:
                    seen.add(asset)
                continue
            if book.asset_id not in requested:
                result.invalid.append((book.asset_id, "token no solicitado en la respuesta"))
                continue
            seen.add(book.asset_id)
            result.books[book.asset_id] = (book, resp.received_at)
        result.missing.extend(t for t in batch if t not in seen)
