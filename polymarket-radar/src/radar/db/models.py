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


# --------------------------------------------------------------------------- electoral
class ElectionMarket(Base):
    """Clasificación determinista de cada mercado electoral abierto."""

    __tablename__ = "election_markets"

    market_id: Mapped[str] = mapped_column(ForeignKey("markets.id"), primary_key=True)
    event_id: Mapped[str | None] = mapped_column(String(64))
    market_type: Mapped[str] = mapped_column(String(32), index=True)
    office: Mapped[str] = mapped_column(String(32))
    country: Mapped[str] = mapped_column(String(16), index=True)
    year: Mapped[int | None] = mapped_column(Integer)
    round: Mapped[int | None] = mapped_column(Integer)
    candidate: Mapped[str | None] = mapped_column(Text)
    contest_key: Mapped[str | None] = mapped_column(String(64), index=True)
    coverage: Mapped[str] = mapped_column(String(16))
    abstain_reason: Mapped[str | None] = mapped_column(Text)
    rules_version: Mapped[str] = mapped_column(String(32))
    classified_at: Mapped[datetime] = mapped_column(TS)
    run_id: Mapped[int | None] = mapped_column(Integer)


class ElectionRun(Base):
    __tablename__ = "election_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(24))  # discover | scan | backtest | evaluate
    mode: Mapped[str] = mapped_column(String(32))  # live | backtest_retrospectivo
    contest_key: Mapped[str | None] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(16))
    summary: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    report_path: Mapped[str | None] = mapped_column(Text)


class ElectionEstimate(Base):
    __tablename__ = "election_estimates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("election_runs.id", ondelete="CASCADE"))
    mode: Mapped[str] = mapped_column(String(32))
    contest_key: Mapped[str] = mapped_column(String(64))
    as_of: Mapped[datetime] = mapped_column(TS)
    name: Mapped[str] = mapped_column(String(80))
    family: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    prob_a: Mapped[float | None] = mapped_column(Float)
    prob_a_low: Mapped[float | None] = mapped_column(Float)
    prob_a_high: Mapped[float | None] = mapped_column(Float)
    vote_share_a: Mapped[float | None] = mapped_column(Float)
    sigma: Mapped[float | None] = mapped_column(Float)
    horizon_days: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(32))
    calibration: Mapped[str] = mapped_column(Text)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    abstain_reason: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("ix_election_estimates_run_asof", "run_id", "as_of"),)


class ElectionAlert(Base):
    """Copia consultable de una alerta; la fuente de verdad es el ledger JSONL encadenado."""

    __tablename__ = "election_alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("election_runs.id", ondelete="CASCADE"))
    mode: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(24))  # investigacion | senal_operable
    contest_key: Mapped[str] = mapped_column(String(64), index=True)
    market_id: Mapped[str] = mapped_column(String(64))
    token_id: Mapped[str] = mapped_column(String(100))
    label: Mapped[str] = mapped_column(Text)
    as_of: Mapped[datetime] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS)
    price: Mapped[float | None] = mapped_column(Float)
    price_basis: Mapped[str] = mapped_column(String(40))
    reference_prob: Mapped[float | None] = mapped_column(Float)
    discrepancy_pp: Mapped[float | None] = mapped_column(Float)
    conservative_edge_pp: Mapped[float | None] = mapped_column(Float)
    signal: Mapped[bool] = mapped_column(Boolean)
    gating: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    ledger_path: Mapped[str] = mapped_column(Text)
    ledger_seq: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    prev_sha256: Mapped[str] = mapped_column(String(64))


# ------------------------------------------------------------- modelos predictivos


class PredictionRun(Base):
    """Una corrida de predicción (en vivo) o de evaluación (backtest)."""

    __tablename__ = "prediction_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(24))  # live | backtest
    started_at: Mapped[datetime] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    status: Mapped[str] = mapped_column(String(16))
    params_version: Mapped[str | None] = mapped_column(String(64))
    params_sha256: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    report_path: Mapped[str | None] = mapped_column(Text)


class PredictionRecord(Base):
    """Salida de ``predict(market, evidence, as_of_time)``, incluidas las abstenciones."""

    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("prediction_runs.id", ondelete="CASCADE"))
    market_id: Mapped[str] = mapped_column(String(64), index=True)
    outcome: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(48))
    model_version: Mapped[str] = mapped_column(String(32))
    family: Mapped[str] = mapped_column(String(24))
    as_of: Mapped[datetime] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS)
    probability: Mapped[float | None] = mapped_column(Float)
    p_low: Mapped[float | None] = mapped_column(Float)
    p_high: Mapped[float | None] = mapped_column(Float)
    calibration_status: Mapped[str] = mapped_column(String(24))
    abstain_reason: Mapped[str | None] = mapped_column(Text)
    data_used: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    details: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    inputs_sha256: Mapped[str] = mapped_column(String(64))

    __table_args__ = (Index("ix_predictions_run_market", "run_id", "market_id"),)


class ValuationRecord(Base):
    """Valoración de un token contra el libro ejecutable (módulo E)."""

    __tablename__ = "valuations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("prediction_runs.id", ondelete="CASCADE"))
    prediction_id: Mapped[int] = mapped_column(ForeignKey("predictions.id", ondelete="CASCADE"))
    market_id: Mapped[str] = mapped_column(String(64), index=True)
    token_id: Mapped[str] = mapped_column(String(100))
    outcome: Mapped[str] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32))
    variant: Mapped[str | None] = mapped_column(String(32))
    end_date: Mapped[datetime | None] = mapped_column(TS)
    as_of: Mapped[datetime] = mapped_column(TS)
    model: Mapped[str] = mapped_column(String(48))
    calibration_status: Mapped[str] = mapped_column(String(24))
    supera_mercado: Mapped[bool | None] = mapped_column(Boolean)
    p_model: Mapped[float | None] = mapped_column(Float)
    p_low: Mapped[float | None] = mapped_column(Float)
    p_high: Mapped[float | None] = mapped_column(Float)
    best_bid: Mapped[float | None] = mapped_column(Float)
    best_ask: Mapped[float | None] = mapped_column(Float)
    spread: Mapped[float | None] = mapped_column(Float)
    p_market_mid: Mapped[float | None] = mapped_column(Float)
    book_received_at: Mapped[datetime | None] = mapped_column(TS)
    book_age_s: Mapped[float | None] = mapped_column(Float)
    ask_vwap: Mapped[float | None] = mapped_column(Float)
    fill_shares: Mapped[float | None] = mapped_column(Float)
    fill_complete: Mapped[bool | None] = mapped_column(Boolean)
    depth_ask_usd: Mapped[float | None] = mapped_column(Float)
    fee_per_share: Mapped[float | None] = mapped_column(Float)
    edge_pp: Mapped[float | None] = mapped_column(Float)
    ev_gross_per_share: Mapped[float | None] = mapped_column(Float)
    costs_per_share: Mapped[float | None] = mapped_column(Float)
    ev_net_per_share: Mapped[float | None] = mapped_column(Float)
    ev_net_usd: Mapped[float | None] = mapped_column(Float)
    ev_conservative_per_share: Mapped[float | None] = mapped_column(Float)
    uncertainty: Mapped[float | None] = mapped_column(Float)
    liquidity_risk: Mapped[str | None] = mapped_column(String(8))
    recommendation: Mapped[str] = mapped_column(String(32))
    reasons: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    version: Mapped[str] = mapped_column(String(24))
    # paper-v2: precio de venta de la posición de papel abierta en este token (si la hay)
    sell_vwap: Mapped[float | None] = mapped_column(Float)
    sell_fee_per_share: Mapped[float | None] = mapped_column(Float)
    sell_complete: Mapped[bool | None] = mapped_column(Boolean)

    __table_args__ = (
        Index("ix_valuations_run_rec", "run_id", "recommendation"),
        Index("ix_valuations_token_asof", "token_id", "as_of"),
    )


class ModelEvaluation(Base):
    """Métricas fuera de muestra de un (modelo, variante) en un backtest."""

    __tablename__ = "model_evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("prediction_runs.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(TS)
    backtest_version: Mapped[str] = mapped_column(String(32))
    family: Mapped[str] = mapped_column(String(24))
    model: Mapped[str] = mapped_column(String(48))
    variant: Mapped[str] = mapped_column(String(32))
    split: Mapped[str] = mapped_column(String(8))
    n: Mapped[int] = mapped_column(Integer)
    n_clusters: Mapped[int] = mapped_column(Integer)
    brier: Mapped[float] = mapped_column(Float)
    brier_lo: Mapped[float | None] = mapped_column(Float)
    brier_hi: Mapped[float | None] = mapped_column(Float)
    log_loss: Mapped[float] = mapped_column(Float)
    log_loss_lo: Mapped[float | None] = mapped_column(Float)
    log_loss_hi: Mapped[float | None] = mapped_column(Float)
    ece: Mapped[float] = mapped_column(Float)
    calib_in_large: Mapped[float] = mapped_column(Float)
    market_brier: Mapped[float | None] = mapped_column(Float)
    market_log_loss: Mapped[float | None] = mapped_column(Float)
    vs_market_ll_diff: Mapped[float | None] = mapped_column(Float)
    vs_market_ll_lo: Mapped[float | None] = mapped_column(Float)
    vs_market_ll_hi: Mapped[float | None] = mapped_column(Float)
    supera_mercado: Mapped[bool | None] = mapped_column(Boolean)
    is_reference: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(24))
    failures: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    bins: Mapped[list[Any]] = mapped_column(JSONType, default=list)


# ------------------------------------------------- evaluación en vivo y cartera de papel


class ForwardInstance(Base):
    """Predicción en vivo elegida como instancia de ``forward-v1`` (un momento preregistrado
    antes de la resolución). Se copia lo necesario para no depender de ``predictions``,
    que se puede podar. ``y`` queda vacío hasta la resolución oficial."""

    __tablename__ = "forward_instances"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    market_id: Mapped[str] = mapped_column(String(64), index=True)
    model: Mapped[str] = mapped_column(String(48))
    family: Mapped[str] = mapped_column(String(24))
    variant: Mapped[str] = mapped_column(String(32))
    moment_min: Mapped[int] = mapped_column(Integer)  # d: minutos antes de la resolución
    gap_min: Mapped[float] = mapped_column(Float)  # (R − d) − as_of, entre 0 y 40
    prediction_id: Mapped[int] = mapped_column(BigInteger)
    run_id: Mapped[int] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(Text)
    as_of: Mapped[datetime] = mapped_column(TS)
    resolution_time: Mapped[datetime] = mapped_column(TS)
    cluster: Mapped[str] = mapped_column(String(64))
    p_model: Mapped[float] = mapped_column(Float)
    p_market: Mapped[float | None] = mapped_column(Float)  # punto medio del libro (CLOB)
    y: Mapped[float | None] = mapped_column(Float)
    resolved_at: Mapped[datetime | None] = mapped_column(TS)
    # Variables del libro de cripto2-mezcla (fase B de docs/PREREGISTRO_CRIPTO_V2.md).
    features: Mapped[dict[str, Any] | None] = mapped_column(JSONType)

    __table_args__ = (
        UniqueConstraint("market_id", "model", "moment_min", name="uq_forward_market_model_moment"),
        Index("ix_forward_pending", "y", "resolution_time"),
    )


class PaperTrade(Base):
    """Posición simulada (``paper-v1``): la primera señal operable de cada mercado y
    resultado. No hay órdenes reales."""

    __tablename__ = "paper_trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(16))
    valuation_id: Mapped[int] = mapped_column(BigInteger)
    run_id: Mapped[int] = mapped_column(Integer)
    market_id: Mapped[str] = mapped_column(String(64), index=True)
    token_id: Mapped[str] = mapped_column(String(100))
    outcome: Mapped[str] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32))
    variant: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(48))
    opened_at: Mapped[datetime] = mapped_column(TS)
    end_date: Mapped[datetime | None] = mapped_column(TS)
    p_model: Mapped[float | None] = mapped_column(Float)
    entry_price: Mapped[float] = mapped_column(Float)  # VWAP del ask (CLOB)
    fee_per_share: Mapped[float] = mapped_column(Float)
    shares: Mapped[float] = mapped_column(Float)
    cost_usd: Mapped[float] = mapped_column(Float)
    ev_net_usd: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), index=True)  # abierta|ganada|perdida|empate
    final_price: Mapped[float | None] = mapped_column(Float)
    payout_usd: Mapped[float | None] = mapped_column(Float)
    pnl_usd: Mapped[float | None] = mapped_column(Float)
    resolved_at: Mapped[datetime | None] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS)
    # paper-v2: la misma posición, pero puede venderse antes (docs/PREREGISTRO_VIVO.md)
    v2_status: Mapped[str | None] = mapped_column(String(16))  # abierta|vendida|ganada|...
    v2_exit_at: Mapped[datetime | None] = mapped_column(TS)
    v2_exit_price: Mapped[float | None] = mapped_column(Float)
    v2_exit_fee: Mapped[float | None] = mapped_column(Float)
    v2_payout_usd: Mapped[float | None] = mapped_column(Float)
    v2_pnl_usd: Mapped[float | None] = mapped_column(Float)
    v2_checked_until: Mapped[datetime | None] = mapped_column(TS)

    __table_args__ = (UniqueConstraint("market_id", "token_id", name="uq_paper_market_token"),)
