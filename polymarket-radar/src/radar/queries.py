"""Consultas de lectura compartidas por la API, el reporte y el CLI."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Select, and_, desc, func, or_, select
from sqlalchemy.orm import Session

from radar.config import Settings
from radar.db.models import (
    Event,
    IngestionError,
    IngestionRun,
    Market,
    MarketState,
    OrderbookSnapshot,
    Token,
)

RUN_COUNT_FIELDS = [
    "gamma_pages",
    "events_discovered",
    "markets_discovered",
    "markets_duplicated",
    "markets_invalid",
    "markets_new",
    "markets_rules_changed",
    "markets_closed_detected",
    "markets_missing_from_source",
    "markets_eligible",
    "tokens_requested",
    "clob_requests",
    "books_ok",
    "books_missing",
    "books_invalid",
    "books_failed",
    "markets_analyzed",
    "markets_liquid",
    "snapshots_inserted",
    "snapshots_unchanged",
    "errors_count",
]


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def run_to_dict(run: IngestionRun) -> dict[str, Any]:
    duration = (
        (run.finished_at - run.started_at).total_seconds()
        if run.finished_at and run.started_at
        else None
    )
    data: dict[str, Any] = {
        "id": run.id,
        "trigger": run.trigger,
        "status": run.status,
        "data_origin": run.data_origin,
        "started_at": _iso(run.started_at),
        "finished_at": _iso(run.finished_at),
        "duration_s": round(duration, 1) if duration is not None else None,
        "discovery_complete": run.discovery_complete,
        "eligibility_breakdown": run.eligibility_breakdown,
        "liquidity_breakdown": {
            k: v for k, v in (run.liquidity_breakdown or {}).items() if k != "_errors"
        },
        "error_summary": (run.liquidity_breakdown or {}).get("_errors", {}),
        "stage_timings_s": run.stage_timings_s,
        "notes": run.notes,
    }
    for f in RUN_COUNT_FIELDS:
        data[f] = getattr(run, f)
    tokens = run.tokens_requested or 0
    data["book_coverage"] = round(run.books_ok / tokens, 4) if tokens else None
    eligible = run.markets_eligible or 0
    data["analysis_coverage"] = round(run.markets_analyzed / eligible, 4) if eligible else None
    return data


def latest_run(session: Session, *, finished_only: bool = False) -> IngestionRun | None:
    stmt = select(IngestionRun)
    if finished_only:
        stmt = stmt.where(IngestionRun.status != "running")
    return session.execute(stmt.order_by(desc(IngestionRun.id)).limit(1)).scalar_one_or_none()


def latest_completed_run(session: Session) -> IngestionRun | None:
    return session.execute(
        select(IngestionRun)
        .where(IngestionRun.status.in_(["success", "partial"]))
        .order_by(desc(IngestionRun.id))
        .limit(1)
    ).scalar_one_or_none()


def list_runs(session: Session, limit: int = 20) -> list[IngestionRun]:
    return list(
        session.execute(select(IngestionRun).order_by(desc(IngestionRun.id)).limit(limit))
        .scalars()
        .all()
    )


def run_errors(
    session: Session, run_id: int, *, limit: int = 100, offset: int = 0
) -> list[dict[str, Any]]:
    rows = session.execute(
        select(IngestionError)
        .where(IngestionError.run_id == run_id)
        .order_by(IngestionError.id)
        .limit(limit)
        .offset(offset)
    ).scalars()
    return [
        {
            "id": e.id,
            "occurred_at": _iso(e.occurred_at),
            "stage": e.stage,
            "source": e.source,
            "endpoint": e.endpoint,
            "entity_id": e.entity_id,
            "error_type": e.error_type,
            "http_status": e.http_status,
            "attempts": e.attempts,
            "message": e.message,
        }
        for e in rows
    ]


def market_url(settings: Settings, event_slug: str | None) -> str | None:
    if not event_slug:
        return None
    return settings.market_url_template.format(event_slug=event_slug)


SORTS = {
    "spread": (MarketState.max_spread.asc().nulls_last(),),
    "depth": (MarketState.min_depth_band_usd.desc().nulls_last(),),
    "volume_24h": (Market.gamma_volume_24h.desc().nulls_last(),),
    "end_date": (Market.end_date.asc().nulls_last(),),
    "analyzed_at": (MarketState.analyzed_at.desc(),),
}


def _markets_query(
    *,
    liquid_only: bool,
    category: str | None,
    search: str | None,
) -> Select[Any]:
    stmt = (
        select(Market, MarketState, Event)
        .join(MarketState, MarketState.market_id == Market.id)
        .outerjoin(Event, Event.id == Market.event_id)
        .where(Market.closed.is_(False), Market.eligible.is_(True))
    )
    if liquid_only:
        stmt = stmt.where(MarketState.liquid.is_(True))
    if category:
        stmt = stmt.where(func.coalesce(Event.category, "unknown") == category)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Market.question.ilike(like), Event.title.ilike(like)))
    return stmt


def list_markets(
    session: Session,
    settings: Settings,
    *,
    liquid_only: bool = True,
    category: str | None = None,
    search: str | None = None,
    sort: str = "spread",
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    base = _markets_query(liquid_only=liquid_only, category=category, search=search)
    total = session.execute(select(func.count()).select_from(base.subquery())).scalar_one()
    order = SORTS.get(sort, SORTS["spread"])
    rows = session.execute(base.order_by(*order, Market.id).limit(limit).offset(offset)).all()
    items = []
    for market, state, event in rows:
        items.append(
            {
                "id": market.id,
                "question": market.question,
                "event_title": event.title if event else None,
                "category": event.category if event else "unknown",
                "outcomes": market.outcomes,
                "end_date": _iso(market.end_date),
                "liquid": state.liquid,
                "analyzed": state.analyzed,
                "reasons": state.reasons,
                "yes_best_bid": state.yes_best_bid,
                "yes_best_ask": state.yes_best_ask,
                "yes_spread": state.yes_spread,
                "max_spread": state.max_spread,
                "min_depth_band_usd": state.min_depth_band_usd,
                "sum_best_asks": state.sum_best_asks,
                "yes_buy_avg_price_ref": state.yes_buy_avg_price_ref,
                "yes_buy_fully_filled_ref": state.yes_buy_fully_filled_ref,
                "reference_notional_usd": state.reference_notional_usd,
                "gamma_volume_24h": market.gamma_volume_24h,
                "analyzed_at": _iso(state.analyzed_at),
                "book_source_ts_min": _iso(state.source_ts_min),
                "run_id": state.run_id,
                "data_origin": state.data_origin,
                "url": market_url(settings, event.slug if event else None),
            }
        )
    return {"total": total, "limit": limit, "offset": offset, "items": items}


def market_detail(session: Session, settings: Settings, market_id: str) -> dict[str, Any] | None:
    market = session.get(Market, market_id)
    if market is None:
        return None
    event = session.get(Event, market.event_id) if market.event_id else None
    state = session.get(MarketState, market_id)
    tokens = session.execute(
        select(Token).where(Token.market_id == market_id).order_by(Token.outcome_index)
    ).scalars()
    latest: list[dict[str, Any]] = []
    for tok in tokens:
        snap = session.execute(
            select(OrderbookSnapshot)
            .where(OrderbookSnapshot.token_id == tok.token_id)
            .order_by(desc(OrderbookSnapshot.received_at))
            .limit(1)
        ).scalar_one_or_none()
        latest.append(
            {
                "token_id": tok.token_id,
                "outcome": tok.outcome,
                "outcome_index": tok.outcome_index,
                "latest_snapshot": snapshot_to_dict(snap, with_levels=True) if snap else None,
            }
        )
    return {
        "id": market.id,
        "data_origin": market.data_origin,
        "source": market.source,
        "question": market.question,
        "rules": market.description,
        "resolution_source": market.resolution_source,
        "outcomes": market.outcomes,
        "condition_id": market.condition_id,
        "slug": market.slug,
        "event": {
            "id": event.id,
            "title": event.title,
            "slug": event.slug,
            "category": event.category,
            "tags": [t.get("label") for t in (event.tags or [])],
            "neg_risk": event.neg_risk,
        }
        if event
        else None,
        "url": market_url(settings, event.slug if event else None),
        "status": {
            "active": market.active,
            "closed": market.closed,
            "archived": market.archived,
            "accepting_orders": market.accepting_orders,
            "enable_order_book": market.enable_order_book,
            "eligible": market.eligible,
            "eligibility_reasons": market.eligibility_reasons,
            "uma_resolution_status": market.uma_resolution_status,
            "missing_since": _iso(market.missing_since),
            "closed_detected_at": _iso(market.closed_detected_at),
        },
        "dates": {
            "start_date": _iso(market.start_date),
            "end_date": _iso(market.end_date),
            "source_created_at": _iso(market.source_created_at),
            "source_updated_at": _iso(market.source_updated_at),
            "first_seen_at": _iso(market.first_seen_at),
            "last_seen_at": _iso(market.last_seen_at),
            "rules_changed_at": _iso(market.rules_changed_at),
        },
        "trading_params": {
            "neg_risk": market.neg_risk,
            "tick_size": market.tick_size,
            "order_min_size": market.order_min_size,
            "fees_enabled": market.fees_enabled,
            "fee_type": market.fee_type,
            "fee_schedule": market.fee_schedule,
        },
        "gamma_indicative": {
            "_nota": "Valores informados por Gamma. Indicativos, NO ejecutables.",
            "outcome_prices": market.gamma_outcome_prices,
            "best_bid": market.gamma_best_bid,
            "best_ask": market.gamma_best_ask,
            "last_trade_price": market.gamma_last_trade_price,
            "volume": market.gamma_volume,
            "volume_24h": market.gamma_volume_24h,
            "liquidity": market.gamma_liquidity,
        },
        "state": {
            "run_id": state.run_id,
            "analyzed_at": _iso(state.analyzed_at),
            "book_source_ts_min": _iso(state.source_ts_min),
            "analyzed": state.analyzed,
            "liquid": state.liquid,
            "reasons": state.reasons,
            "sum_best_asks": state.sum_best_asks,
            "sum_best_bids": state.sum_best_bids,
            "reference_notional_usd": state.reference_notional_usd,
            "yes_buy_avg_price_ref": state.yes_buy_avg_price_ref,
            "yes_buy_slippage_ref": state.yes_buy_slippage_ref,
            "yes_buy_fully_filled_ref": state.yes_buy_fully_filled_ref,
            "outcomes_metrics": state.outcomes_metrics,
        }
        if state
        else None,
        "tokens": latest,
    }


def snapshot_to_dict(snap: OrderbookSnapshot, *, with_levels: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": snap.id,
        "run_id": snap.run_id,
        "token_id": snap.token_id,
        "data_origin": snap.data_origin,
        "source": snap.source,
        "source_ts": _iso(snap.source_ts),
        "received_at": _iso(snap.received_at),
        "book_hash": snap.book_hash,
        "best_bid": snap.best_bid,
        "best_ask": snap.best_ask,
        "best_bid_size": snap.best_bid_size,
        "best_ask_size": snap.best_ask_size,
        "mid": snap.mid,
        "spread": snap.spread,
        "bid_levels": snap.bid_levels,
        "ask_levels": snap.ask_levels,
        "bid_depth_usd": snap.bid_depth_usd,
        "ask_depth_usd": snap.ask_depth_usd,
        "bid_depth_band_usd": snap.bid_depth_band_usd,
        "ask_depth_band_usd": snap.ask_depth_band_usd,
        "tick_size": snap.tick_size,
        "min_order_size": snap.min_order_size,
        "clob_last_trade_price": snap.clob_last_trade_price,
        "levels_truncated": snap.levels_truncated,
    }
    if with_levels:
        data["bids"] = snap.bids
        data["asks"] = snap.asks
    return data


def market_snapshots(
    session: Session, market_id: str, *, token_id: str | None = None, limit: int = 500
) -> list[dict[str, Any]]:
    stmt = select(OrderbookSnapshot).where(OrderbookSnapshot.market_id == market_id)
    if token_id:
        stmt = stmt.where(OrderbookSnapshot.token_id == token_id)
    rows = session.execute(stmt.order_by(desc(OrderbookSnapshot.received_at)).limit(limit))
    return [snapshot_to_dict(s) for s in rows.scalars()]


def category_counts(session: Session) -> list[dict[str, Any]]:
    cat = func.coalesce(Event.category, "unknown")
    rows = session.execute(
        select(
            cat.label("category"),
            func.count().label("analyzed"),
            func.count().filter(MarketState.liquid.is_(True)).label("liquid"),
        )
        .select_from(MarketState)
        .join(Market, Market.id == MarketState.market_id)
        .outerjoin(Event, Event.id == Market.event_id)
        .where(and_(Market.closed.is_(False), Market.eligible.is_(True)))
        .group_by(cat)
        .order_by(desc("analyzed"))
    ).all()
    return [{"category": r.category, "analyzed": r.analyzed, "liquid": r.liquid} for r in rows]


def table_counts(session: Session) -> dict[str, int]:
    return {
        "markets": session.execute(select(func.count()).select_from(Market)).scalar_one(),
        "markets_open": session.execute(
            select(func.count()).select_from(Market).where(Market.closed.is_(False))
        ).scalar_one(),
        "events": session.execute(select(func.count()).select_from(Event)).scalar_one(),
        "tokens": session.execute(select(func.count()).select_from(Token)).scalar_one(),
        "orderbook_snapshots": session.execute(
            select(func.count()).select_from(OrderbookSnapshot)
        ).scalar_one(),
        "ingestion_runs": session.execute(
            select(func.count()).select_from(IngestionRun)
        ).scalar_one(),
    }
