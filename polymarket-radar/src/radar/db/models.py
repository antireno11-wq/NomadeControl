"""Modelo de datos (PostgreSQL).

Principios:
- Cada fila registra su origen (``data_origin``: real | historical | synthetic) y
  su fuente (``source``) cuando aplica.
- Se separa el timestamp del evento en la fuente (``source_*``) del timestamp de
  recepción (``received_at``/``*_seen_at``).
- Los precios de Gamma se guardan con prefijo ``gamma_`` y son indicativos; los
  precios ejecutables provienen solo de ``orderbook_snapshots`` (CLOB).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JSONType = JSON().with_variant(JSONB(), "postgresql")
TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trigger: Mapped[str] = mapped_column(String(32))  # manual | scheduled | test
    status: Mapped[str] = mapped_column(String(16))  # running | success | partial | failed
    data_origin: Mapped[str] = mapped_column(String(16), default="real")
    started_at: Mapped[datetime] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    discovery_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    gamma_pages: Mapped[int] = mapped_column(Integer, default=0)
    events_discovered: Mapped[int] = mapped_column(Integer, default=0)
    markets_discovered: Mapped[int] = mapped_column(Integer, default=0)
    markets_duplicated: Mapped[int] = mapped_column(Integer, default=0)
    markets_invalid: Mapped[int] = mapped_column(Integer, default=0)
    markets_new: Mapped[int] = mapped_column(Integer, default=0)
    markets_rules_changed: Mapped[int] = mapped_column(Integer, default=0)
    markets_closed_detected: Mapped[int] = mapped_column(Integer, default=0)
    markets_missing_from_source: Mapped[int] = mapped_column(Integer, default=0)
    markets_eligible: Mapped[int] = mapped_column(Integer, default=0)
    tokens_requested: Mapped[int] = mapped_column(Integer, default=0)
    clob_requests: Mapped[int] = mapped_column(Integer, default=0)
    books_ok: Mapped[int] = mapped_column(Integer, default=0)
    books_missing: Mapped[int] = mapped_column(Integer, default=0)
    books_invalid: Mapped[int] = mapped_column(Integer, default=0)
    books_failed: Mapped[int] = mapped_column(Integer, default=0)
    markets_analyzed: Mapped[int] = mapped_column(Integer, default=0)
    markets_liquid: Mapped[int] = mapped_column(Integer, default=0)
    snapshots_inserted: Mapped[int] = mapped_column(Integer, default=0)
    snapshots_unchanged: Mapped[int] = mapped_column(Integer, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, default=0)
    eligibility_breakdown: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    liquidity_breakdown: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    stage_timings_s: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    notes: Mapped[list[Any]] = mapped_column(JSONType, default=list)

    errors: Mapped[list[IngestionError]] = relationship(back_populates="run")


class IngestionError(Base):
    __tablename__ = "ingestion_errors"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.id", ondelete="CASCADE"))
    occurred_at: Mapped[datetime] = mapped_column(TS)
    stage: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32))
    endpoint: Mapped[str | None] = mapped_column(Text)
    entity_id: Mapped[str | None] = mapped_column(Text)
    error_type: Mapped[str] = mapped_column(String(64))
    http_status: Mapped[int | None] = mapped_column(Integer)
    attempts: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str] = mapped_column(Text)

    run: Mapped[IngestionRun] = relationship(back_populates="errors")

    __table_args__ = (Index("ix_ingestion_errors_run", "run_id", "stage"),)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str] = mapped_column(String(32), default="polymarket_gamma")
    data_origin: Mapped[str] = mapped_column(String(16), default="real")
    slug: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    resolution_source: Mapped[str | None] = mapped_column(Text)
    neg_risk: Mapped[bool | None] = mapped_column(Boolean)
    start_date: Mapped[datetime | None] = mapped_column(TS)
    end_date: Mapped[datetime | None] = mapped_column(TS)
    active: Mapped[bool | None] = mapped_column(Boolean)
    closed: Mapped[bool | None] = mapped_column(Boolean)
    tags: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    category: Mapped[str] = mapped_column(String(32), default="unknown")
    tags_fetched: Mapped[bool] = mapped_column(Boolean, default=False)
    source_updated_at: Mapped[datetime | None] = mapped_column(TS)
    first_seen_at: Mapped[datetime] = mapped_column(TS)
    last_seen_at: Mapped[datetime] = mapped_column(TS)


class Market(Base):
    __tablename__ = "markets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # id de Gamma
    source: Mapped[str] = mapped_column(String(32), default="polymarket_gamma")
    data_origin: Mapped[str] = mapped_column(String(16), default="real")
    condition_id: Mapped[str | None] = mapped_column(String(80), index=True)
    question_id: Mapped[str | None] = mapped_column(String(80))
    event_id: Mapped[str | None] = mapped_column(ForeignKey("events.id"), index=True)
    slug: Mapped[str | None] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)  # reglas de resolución
    resolution_source: Mapped[str | None] = mapped_column(Text)
    outcomes: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    clob_token_ids: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    group_item_title: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[datetime | None] = mapped_column(TS)
    end_date: Mapped[datetime | None] = mapped_column(TS, index=True)
    active: Mapped[bool] = mapped_column(Boolean)
    closed: Mapped[bool] = mapped_column(Boolean, index=True)
    archived: Mapped[bool] = mapped_column(Boolean)
    restricted: Mapped[bool | None] = mapped_column(Boolean)
    accepting_orders: Mapped[bool] = mapped_column(Boolean)
    enable_order_book: Mapped[bool] = mapped_column(Boolean)
    neg_risk: Mapped[bool] = mapped_column(Boolean)
    neg_risk_market_id: Mapped[str | None] = mapped_column(String(80))
    order_min_size: Mapped[float | None] = mapped_column(Float)
    tick_size: Mapped[float | None] = mapped_column(Float)
    fees_enabled: Mapped[bool | None] = mapped_column(Boolean)
    fee_type: Mapped[str | None] = mapped_column(String(64))
    fee_schedule: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    maker_base_fee: Mapped[float | None] = mapped_column(Float)
    taker_base_fee: Mapped[float | None] = mapped_column(Float)
    uma_resolution_status: Mapped[str | None] = mapped_column(String(64))
    # Métricas de Gamma: indicativas, no ejecutables.
    gamma_volume: Mapped[float | None] = mapped_column(Float)
    gamma_volume_24h: Mapped[float | None] = mapped_column(Float)
    gamma_liquidity: Mapped[float | None] = mapped_column(Float)
    gamma_outcome_prices: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    gamma_best_bid: Mapped[float | None] = mapped_column(Float)
    gamma_best_ask: Mapped[float | None] = mapped_column(Float)
    gamma_last_trade_price: Mapped[float | None] = mapped_column(Float)
    rules_hash: Mapped[str] = mapped_column(String(64))
    eligible: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    eligibility_reasons: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    source_created_at: Mapped[datetime | None] = mapped_column(TS)
    source_updated_at: Mapped[datetime | None] = mapped_column(TS)
    source_closed_time: Mapped[datetime | None] = mapped_column(TS)
    first_seen_at: Mapped[datetime] = mapped_column(TS)
    first_seen_run_id: Mapped[int | None] = mapped_column(Integer)
    last_seen_at: Mapped[datetime] = mapped_column(TS)
    last_seen_run_id: Mapped[int | None] = mapped_column(Integer, index=True)
    rules_changed_at: Mapped[datetime | None] = mapped_column(TS)
    closed_detected_at: Mapped[datetime | None] = mapped_column(TS)
    missing_since: Mapped[datetime | None] = mapped_column(TS)
    # JSON crudo de Gamma tal como se recibió al insertar el mercado o la última
    # vez que cambiaron sus reglas (los campos volátiles tienen columnas propias).
    raw: Mapped[dict[str, Any]] = mapped_column(JSONType)
    raw_received_at: Mapped[datetime] = mapped_column(TS)

    tokens: Mapped[list[Token]] = relationship(
        back_populates="market", order_by="Token.outcome_index"
    )


class Token(Base):
    __tablename__ = "tokens"

    token_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    market_id: Mapped[str] = mapped_column(ForeignKey("markets.id"), index=True)
    outcome: Mapped[str] = mapped_column(Text)
    outcome_index: Mapped[int] = mapped_column(Integer)
    first_seen_at: Mapped[datetime] = mapped_column(TS)

    market: Mapped[Market] = relationship(back_populates="tokens")


class OrderbookSnapshot(Base):
    """Snapshot de un order book del CLOB. Se deduplica por (token, timestamp, hash):
    si el libro no cambió entre corridas, no se inserta otra fila."""

    __tablename__ = "orderbook_snapshots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.id"), index=True)
    token_id: Mapped[str] = mapped_column(ForeignKey("tokens.token_id"))
    market_id: Mapped[str] = mapped_column(ForeignKey("markets.id"))
    source: Mapped[str] = mapped_column(String(32), default="polymarket_clob")
    data_origin: Mapped[str] = mapped_column(String(16), default="real")
    source_ts: Mapped[datetime | None] = mapped_column(TS)
    received_at: Mapped[datetime] = mapped_column(TS)
    book_hash: Mapped[str] = mapped_column(String(80))
    best_bid: Mapped[float | None] = mapped_column(Float)
    best_ask: Mapped[float | None] = mapped_column(Float)
    best_bid_size: Mapped[float | None] = mapped_column(Float)
    best_ask_size: Mapped[float | None] = mapped_column(Float)
    mid: Mapped[float | None] = mapped_column(Float)
    spread: Mapped[float | None] = mapped_column(Float)
    bid_levels: Mapped[int] = mapped_column(Integer)
    ask_levels: Mapped[int] = mapped_column(Integer)
    bid_depth_usd: Mapped[float] = mapped_column(Float)
    ask_depth_usd: Mapped[float] = mapped_column(Float)
    bid_depth_band_usd: Mapped[float] = mapped_column(Float)
    ask_depth_band_usd: Mapped[float] = mapped_column(Float)
    tick_size: Mapped[float | None] = mapped_column(Float)
    min_order_size: Mapped[float | None] = mapped_column(Float)
    # Último precio negociado según el CLOB: informativo, NO ejecutable.
    clob_last_trade_price: Mapped[float | None] = mapped_column(Float)
    bids: Mapped[list[Any] | None] = mapped_column(JSONType)
    asks: Mapped[list[Any] | None] = mapped_column(JSONType)
    levels_truncated: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        UniqueConstraint(
            "token_id",
            "source_ts",
            "book_hash",
            name="uq_snapshot_token_ts_hash",
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_snapshots_token_received", "token_id", "received_at"),
        Index("ix_snapshots_market_received", "market_id", "received_at"),
    )


class MarketState(Base):
    """Último análisis de cada mercado (una fila por mercado, se reemplaza)."""

    __tablename__ = "market_state"

    market_id: Mapped[str] = mapped_column(ForeignKey("markets.id"), primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("ingestion_runs.id"))
    data_origin: Mapped[str] = mapped_column(String(16), default="real")
    analyzed_at: Mapped[datetime] = mapped_column(TS)  # recepción del libro más antiguo
    source_ts_min: Mapped[datetime | None] = mapped_column(TS)
    analyzed: Mapped[bool] = mapped_column(Boolean)
    liquid: Mapped[bool] = mapped_column(Boolean, index=True)
    reasons: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    # Métricas del primer resultado (outcome index 0, típicamente "Yes").
    yes_best_bid: Mapped[float | None] = mapped_column(Float)
    yes_best_ask: Mapped[float | None] = mapped_column(Float)
    yes_spread: Mapped[float | None] = mapped_column(Float)
    yes_mid: Mapped[float | None] = mapped_column(Float)
    yes_bid_depth_band_usd: Mapped[float | None] = mapped_column(Float)
    yes_ask_depth_band_usd: Mapped[float | None] = mapped_column(Float)
    min_depth_band_usd: Mapped[float | None] = mapped_column(Float)
    max_spread: Mapped[float | None] = mapped_column(Float)
    sum_best_asks: Mapped[float | None] = mapped_column(Float)  # diagnóstico, no es señal
    sum_best_bids: Mapped[float | None] = mapped_column(Float)
    reference_notional_usd: Mapped[float | None] = mapped_column(Float)
    yes_buy_avg_price_ref: Mapped[float | None] = mapped_column(Float)
    yes_buy_slippage_ref: Mapped[float | None] = mapped_column(Float)
    yes_buy_fully_filled_ref: Mapped[bool | None] = mapped_column(Boolean)
    outcomes_metrics: Mapped[list[Any]] = mapped_column(JSONType, default=list)
