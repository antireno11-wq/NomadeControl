"""Pipeline de ingesta: Gamma (mercados, eventos) + CLOB (order books).

Etapas, en orden:

1. ``events``    – eventos abiertos con etiquetas (categoría). Opcional; si falla,
                   las categorías quedan como ``unknown`` y la corrida sigue.
2. ``discovery`` – todos los mercados abiertos, página a página. Cada página se
                   valida y se persiste en su propia transacción (streaming), así
                   que la memoria no crece con el universo.
3. ``closures``  – solo si la descubierta fue completa: los mercados que estaban
                   abiertos y ya no aparecen se consultan por id para confirmar su
                   estado. Sin confirmación se marcan ``missing_since``; nunca se
                   asume un cierre.
4. ``books``     – order books de los tokens de mercados elegibles, en lotes.
                   Se calculan métricas, filtro de liquidez y snapshots.

Conteos que se registran: descubiertos, inválidos, duplicados, elegibles,
tokens solicitados, libros OK/faltantes/inválidos/fallidos, mercados
analizados (todos sus libros disponibles) y líquidos.

Idempotencia: mercados, eventos y tokens se insertan con upsert por clave
natural; los snapshots con ``ON CONFLICT DO NOTHING`` sobre (token, timestamp de
la fuente, hash del libro), de modo que reiniciar no duplica registros.
"""

from __future__ import annotations

import time
from collections import Counter, deque
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, Engine, and_, case, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

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
from radar.ingestion import clob as clob_mod
from radar.ingestion import gamma as gamma_mod
from radar.ingestion.clob import BookFetchResult, ClobBook, ClobClient
from radar.ingestion.gamma import GammaClient, GammaEvent, GammaEventRef, GammaMarket
from radar.ingestion.http import ApiClient, ApiError
from radar.logging_setup import get_logger
from radar.market.categories import categorize
from radar.market.filters import (
    LiquidityConfig,
    eligibility_reasons,
    liquidity_reasons,
    reason_family,
)
from radar.market.orderbook import (
    BookMetrics,
    compute_metrics,
    normalize_book,
    simulate_buy,
    truncate_levels,
)
from radar.timeutil import utcnow

log = get_logger(__name__)

ADVISORY_LOCK_KEY = 7_420_133_701  # identifica el lock de "ingesta en curso"
MAX_ERRORS_STORED_PER_TYPE = 200
MARKETS_PER_BOOK_CHUNK = 100


class RunAlreadyInProgressError(RuntimeError):
    pass


@dataclass
class EligibleMarket:
    market_id: str
    token_ids: list[str]
    outcomes: list[str]


@dataclass
class RunCounters:
    gamma_pages: int = 0
    events_discovered: int = 0
    markets_discovered: int = 0
    markets_duplicated: int = 0
    markets_invalid: int = 0
    markets_new: int = 0
    markets_rules_changed: int = 0
    markets_closed_detected: int = 0
    markets_missing_from_source: int = 0
    markets_eligible: int = 0
    tokens_requested: int = 0
    clob_requests: int = 0
    books_ok: int = 0
    books_missing: int = 0
    books_invalid: int = 0
    books_failed: int = 0
    markets_analyzed: int = 0
    markets_liquid: int = 0
    snapshots_inserted: int = 0
    snapshots_unchanged: int = 0
    errors_count: int = 0
    eligibility_breakdown: Counter[str] = field(default_factory=Counter)
    liquidity_breakdown: Counter[str] = field(default_factory=Counter)


def build_clients(settings: Settings) -> tuple[GammaClient, ClobClient, Callable[[], None]]:
    common = {
        "timeout_s": settings.http_timeout_s,
        "max_retries": settings.http_max_retries,
        "backoff_base_s": settings.http_backoff_base_s,
        "backoff_max_s": settings.http_backoff_max_s,
        "user_agent": settings.user_agent,
    }
    gamma_api = ApiClient(
        settings.gamma_base_url, name="gamma", rate_per_s=settings.gamma_rate_per_s, **common
    )
    clob_api = ApiClient(
        settings.clob_base_url, name="clob", rate_per_s=settings.clob_rate_per_s, **common
    )

    def close() -> None:
        gamma_api.close()
        clob_api.close()

    return (
        GammaClient(gamma_api, page_size=settings.gamma_page_size),
        ClobClient(clob_api, batch_size=settings.clob_books_batch_size),
        close,
    )


def _chunks(items: Sequence[Any], size: int) -> Iterable[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


class IngestionPipeline:
    def __init__(
        self,
        engine: Engine,
        settings: Settings,
        gamma: GammaClient,
        clob: ClobClient,
        *,
        trigger: str = "manual",
        data_origin: str = "real",
        clock: Callable[[], datetime] = utcnow,
    ) -> None:
        if data_origin not in ("real", "synthetic"):
            raise ValueError("data_origin debe ser 'real' o 'synthetic'")
        self.engine = engine
        self.settings = settings
        self.gamma = gamma
        self.clob = clob
        self.trigger = trigger
        self.data_origin = data_origin
        self.clock = clock
        self.c = RunCounters()
        self.run_id: int = 0
        self.discovery_complete = False
        self.notes: list[str] = []
        self.timings: dict[str, float] = {}
        self._error_buffer: list[dict[str, Any]] = []
        self._errors_by_type: Counter[tuple[str, str]] = Counter()
        self._eligible: list[EligibleMarket] = []
        self._seen_ids: set[str] = set()
        self.liq_cfg = LiquidityConfig(
            max_spread=settings.liq_max_spread,
            depth_band=settings.liq_depth_band,
            min_depth_usd=settings.liq_min_depth_usd,
        )

    # ------------------------------------------------------------------ errores
    def _error(
        self,
        stage: str,
        source: str,
        error_type: str,
        message: str,
        *,
        endpoint: str | None = None,
        entity_id: str | None = None,
        http_status: int | None = None,
        attempts: int | None = None,
    ) -> None:
        self.c.errors_count += 1
        key = (stage, error_type)
        self._errors_by_type[key] += 1
        if self._errors_by_type[key] > MAX_ERRORS_STORED_PER_TYPE:
            return
        self._error_buffer.append(
            {
                "run_id": self.run_id,
                "occurred_at": self.clock(),
                "stage": stage,
                "source": source,
                "endpoint": endpoint,
                "entity_id": entity_id,
                "error_type": error_type[:64],
                "http_status": http_status,
                "attempts": attempts,
                "message": message[:2000],
            }
        )

    def _api_error(self, stage: str, source: str, exc: ApiError, entity: str | None = None) -> None:
        self._error(
            stage,
            source,
            exc.error_type if exc.status is None else f"http_{exc.status}",
            f"{exc}" + (f" | body: {exc.body[:300]}" if exc.body else ""),
            endpoint=exc.url,
            entity_id=entity,
            http_status=exc.status,
            attempts=exc.attempts,
        )

    def _flush_errors(self, conn: Connection) -> None:
        if self._error_buffer:
            conn.execute(insert(IngestionError), self._error_buffer)
            self._error_buffer = []

    # ------------------------------------------------------------------ corrida
    def run(self) -> int:
        lock_conn = self.engine.connect()
        try:
            got = lock_conn.execute(
                text("SELECT pg_try_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY}
            ).scalar()
            lock_conn.commit()
            if not got:
                raise RunAlreadyInProgressError(
                    "ya hay una ingesta en curso (lock consultivo de PostgreSQL tomado)"
                )
            try:
                return self._run_locked()
            finally:
                lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY})
                lock_conn.commit()
        finally:
            lock_conn.close()

    def _run_locked(self) -> int:
        started = self.clock()
        with self.engine.begin() as conn:
            # Con el lock tomado, cualquier corrida "running" quedó interrumpida.
            stale = conn.execute(
                select(IngestionRun.id, IngestionRun.notes).where(IngestionRun.status == "running")
            ).all()
            for run_id, notes in stale:
                conn.execute(
                    update(IngestionRun)
                    .where(IngestionRun.id == run_id)
                    .values(
                        status="failed",
                        finished_at=started,
                        notes=[*(notes or []), "interrumpida: el proceso terminó sin cerrarla"],
                    )
                )
            self.run_id = conn.execute(
                insert(IngestionRun)
                .values(
                    trigger=self.trigger,
                    status="running",
                    data_origin=self.data_origin,
                    started_at=started,
                    config=self.settings.redacted(),
                    eligibility_breakdown={},
                    liquidity_breakdown={},
                    stage_timings_s={},
                    notes=[],
                )
                .returning(IngestionRun.id)
            ).scalar_one()
        log.info("ingestion_started", run_id=self.run_id, trigger=self.trigger)

        status = "failed"
        try:
            if self.settings.gamma_fetch_events:
                self._timed("events", self._stage_events)
            self._timed("discovery", self._stage_discovery)
            if self.discovery_complete:
                self._timed("closures", self._stage_closures)
            else:
                self.notes.append(
                    "descubierta incompleta: no se infieren cierres ni desapariciones"
                )
            self._timed("books", self._stage_books)
            status = self._final_status()
        except Exception as exc:
            self._error("internal", "radar", type(exc).__name__, repr(exc))
            log.exception("ingestion_crashed", run_id=self.run_id)
            raise
        finally:
            self._finish(status)
        return self.run_id

    def _timed(self, name: str, fn: Callable[[], None]) -> None:
        t0 = time.monotonic()
        try:
            fn()
        finally:
            self.timings[name] = round(time.monotonic() - t0, 2)
            log.info("stage_done", run_id=self.run_id, stage=name, secs=self.timings[name])

    def _final_status(self) -> str:
        c = self.c
        if c.gamma_pages == 0:
            return "failed"
        if not self.discovery_complete or c.errors_count > 0:
            return "partial"
        return "success"

    def _counter_values(self) -> dict[str, Any]:
        c = self.c
        error_summary = {f"{s}:{t}": n for (s, t), n in sorted(self._errors_by_type.items())}
        return {
            "discovery_complete": self.discovery_complete,
            "gamma_pages": c.gamma_pages,
            "events_discovered": c.events_discovered,
            "markets_discovered": c.markets_discovered,
            "markets_duplicated": c.markets_duplicated,
            "markets_invalid": c.markets_invalid,
            "markets_new": c.markets_new,
            "markets_rules_changed": c.markets_rules_changed,
            "markets_closed_detected": c.markets_closed_detected,
            "markets_missing_from_source": c.markets_missing_from_source,
            "markets_eligible": c.markets_eligible,
            "tokens_requested": c.tokens_requested,
            "clob_requests": c.clob_requests,
            "books_ok": c.books_ok,
            "books_missing": c.books_missing,
            "books_invalid": c.books_invalid,
            "books_failed": c.books_failed,
            "markets_analyzed": c.markets_analyzed,
            "markets_liquid": c.markets_liquid,
            "snapshots_inserted": c.snapshots_inserted,
            "snapshots_unchanged": c.snapshots_unchanged,
            "errors_count": c.errors_count,
            "eligibility_breakdown": dict(c.eligibility_breakdown),
            "liquidity_breakdown": {**dict(c.liquidity_breakdown), "_errors": error_summary},
            "stage_timings_s": dict(self.timings),
            "notes": list(self.notes),
        }

    def _checkpoint(self, conn: Connection) -> None:
        """Conteos parciales mientras la corrida sigue en estado 'running'."""
        conn.execute(
            update(IngestionRun)
            .where(IngestionRun.id == self.run_id)
            .values(**self._counter_values())
        )

    def _finish(self, status: str) -> None:
        c = self.c
        stored = sum(min(v, MAX_ERRORS_STORED_PER_TYPE) for v in self._errors_by_type.values())
        if c.errors_count > stored:
            self.notes.append(
                f"se guardó una muestra de hasta {MAX_ERRORS_STORED_PER_TYPE} errores por tipo; "
                f"total de errores: {c.errors_count}"
            )
        with self.engine.begin() as conn:
            self._flush_errors(conn)
            conn.execute(
                update(IngestionRun)
                .where(IngestionRun.id == self.run_id)
                .values(status=status, finished_at=self.clock(), **self._counter_values())
            )
        log.info(
            "ingestion_finished",
            run_id=self.run_id,
            status=status,
            discovered=c.markets_discovered,
            eligible=c.markets_eligible,
            analyzed=c.markets_analyzed,
            liquid=c.markets_liquid,
            errors=c.errors_count,
        )

    # ------------------------------------------------------------------ eventos
    def _stage_events(self) -> None:
        seen: set[str] = set()
        try:
            for page in self.gamma.iter_event_pages(max_pages=self.settings.gamma_max_pages):
                rows: dict[str, dict[str, Any]] = {}
                for raw in page.events:
                    try:
                        ev = GammaEvent.model_validate(raw)
                    except Exception as exc:
                        self._error(
                            "gamma_events",
                            gamma_mod.SOURCE,
                            "invalid_event",
                            str(exc)[:500],
                            entity_id=str(raw.get("id")) if isinstance(raw, dict) else None,
                            endpoint=page.url,
                        )
                        continue
                    if ev.id in seen:
                        continue
                    seen.add(ev.id)
                    rows[ev.id] = self._event_row(
                        ev, page.received_at, with_tags=True, tags=ev.tags
                    )
                if rows:
                    with self.engine.begin() as conn:
                        self._upsert_events(conn, list(rows.values()), with_tags=True)
        except ApiError as exc:
            self._api_error("gamma_events", gamma_mod.SOURCE, exc)
            self.notes.append("eventos incompletos: algunas categorías pueden quedar 'unknown'")
        self.c.events_discovered = len(seen)

    def _event_row(
        self,
        ev: GammaEventRef,
        received_at: datetime,
        *,
        with_tags: bool,
        tags: list[Any] | None = None,
    ) -> dict[str, Any]:
        row: dict[str, Any] = {
            "id": ev.id,
            "source": gamma_mod.SOURCE,
            "data_origin": self.data_origin,
            "slug": ev.slug,
            "title": ev.title,
            "description": ev.description,
            "neg_risk": ev.neg_risk,
            "start_date": ev.start_date,
            "end_date": ev.end_date,
            "active": ev.active,
            "closed": ev.closed,
            "first_seen_at": received_at,
            "last_seen_at": received_at,
            "tags": [],
            "category": "unknown",
            "tags_fetched": False,
            "resolution_source": None,
            "source_updated_at": None,
        }
        if with_tags and isinstance(ev, GammaEvent):
            tag_list = [t.model_dump() for t in (tags or [])]
            row.update(
                tags=tag_list,
                category=categorize(t.get("slug") for t in tag_list),
                tags_fetched=True,
                resolution_source=ev.resolution_source,
                source_updated_at=ev.source_updated_at,
            )
        return row

    def _upsert_events(
        self, conn: Connection, rows: list[dict[str, Any]], *, with_tags: bool
    ) -> None:
        stmt = pg_insert(Event).values(rows)
        ex = stmt.excluded
        set_: dict[str, Any] = {
            "slug": ex.slug,
            "title": ex.title,
            "description": func.coalesce(ex.description, Event.description),
            "neg_risk": func.coalesce(ex.neg_risk, Event.neg_risk),
            "start_date": func.coalesce(ex.start_date, Event.start_date),
            "end_date": func.coalesce(ex.end_date, Event.end_date),
            "active": func.coalesce(ex.active, Event.active),
            "closed": func.coalesce(ex.closed, Event.closed),
            "last_seen_at": ex.last_seen_at,
        }
        if with_tags:
            set_.update(
                tags=ex.tags,
                category=ex.category,
                tags_fetched=ex.tags_fetched,
                resolution_source=ex.resolution_source,
                source_updated_at=ex.source_updated_at,
            )
        conn.execute(stmt.on_conflict_do_update(index_elements=[Event.id], set_=set_))

    # ------------------------------------------------------------------ mercados
    def _stage_discovery(self) -> None:
        last_cursor: str | None = None
        try:
            for page in self.gamma.iter_market_pages(max_pages=self.settings.gamma_max_pages):
                self.c.gamma_pages += 1
                last_cursor = page.next_cursor
                parsed = gamma_mod.parse_markets(page.markets)
                for entity, msg in parsed.invalid:
                    self.c.markets_invalid += 1
                    self._error(
                        "gamma_markets",
                        gamma_mod.SOURCE,
                        "invalid_market",
                        msg,
                        entity_id=entity,
                        endpoint=page.url,
                    )
                fresh: list[tuple[GammaMarket, dict[str, Any]]] = []
                for market, raw in parsed.valid:
                    if market.id in self._seen_ids:
                        self.c.markets_duplicated += 1
                        continue
                    self._seen_ids.add(market.id)
                    fresh.append((market, raw))
                self.c.markets_discovered += len(fresh)
                if fresh:
                    with self.engine.begin() as conn:
                        self._persist_markets(conn, fresh, page.received_at, collect_eligible=True)
                        self._flush_errors(conn)
                if self.c.gamma_pages % 50 == 0:
                    with self.engine.begin() as conn:
                        self._checkpoint(conn)
                    log.info(
                        "discovery_progress",
                        run_id=self.run_id,
                        pages=self.c.gamma_pages,
                        markets=self.c.markets_discovered,
                    )
        except ApiError as exc:
            self._api_error("gamma_markets", gamma_mod.SOURCE, exc)
            self.discovery_complete = False
            return
        truncated = (
            self.settings.gamma_max_pages is not None
            and self.c.gamma_pages >= self.settings.gamma_max_pages
            and last_cursor is not None
        )
        if truncated:
            self.notes.append(
                f"descubierta truncada por RADAR_GAMMA_MAX_PAGES={self.settings.gamma_max_pages}"
            )
        self.discovery_complete = not truncated

    def _persist_markets(
        self,
        conn: Connection,
        items: list[tuple[GammaMarket, dict[str, Any]]],
        received_at: datetime,
        *,
        collect_eligible: bool,
    ) -> None:
        now = received_at
        # Eventos embebidos (stub). Se deduplican: un INSERT .. ON CONFLICT no
        # puede tocar la misma fila dos veces.
        stubs: dict[str, dict[str, Any]] = {}
        for market, _ in items:
            ev = market.event
            if ev is not None and ev.id not in stubs:
                stubs[ev.id] = self._event_row(ev, now, with_tags=False)
        if stubs:
            self._upsert_events(conn, list(stubs.values()), with_tags=False)

        ids = [m.id for m, _ in items]
        existing = {
            row.id: (row.rules_hash, row.closed)
            for row in conn.execute(
                select(Market.id, Market.rules_hash, Market.closed).where(Market.id.in_(ids))
            )
        }
        rows: list[dict[str, Any]] = []
        token_rows: list[dict[str, Any]] = []
        for market, raw in items:
            reasons = eligibility_reasons(market, self.clock())
            rules_hash = market.rules_hash()
            prev = existing.get(market.id)
            if prev is None:
                self.c.markets_new += 1
            else:
                if prev[0] != rules_hash:
                    self.c.markets_rules_changed += 1
                if not prev[1] and market.closed:
                    self.c.markets_closed_detected += 1
            if collect_eligible:
                for r in reasons:
                    self.c.eligibility_breakdown[r] += 1
                if not reasons:
                    self.c.markets_eligible += 1
                    self._eligible.append(
                        EligibleMarket(market.id, market.clob_token_ids, market.outcomes)
                    )
            row = self._market_row(market, raw, now, rules_hash, reasons)
            if prev is not None and prev[0] == rules_hash:
                # Reglas sin cambios: no se reenvían el JSON crudo ni el texto de
                # reglas; el upsert conserva los almacenados (y su TOAST).
                row["raw"] = {}
                row["description"] = None
            rows.append(row)
            if len(market.clob_token_ids) == len(market.outcomes):
                for idx, (tok, outcome) in enumerate(
                    zip(market.clob_token_ids, market.outcomes, strict=True)
                ):
                    token_rows.append(
                        {
                            "token_id": tok,
                            "market_id": market.id,
                            "outcome": outcome,
                            "outcome_index": idx,
                            "first_seen_at": now,
                        }
                    )
        stmt = pg_insert(Market).values(rows)
        ex = stmt.excluded
        keep = {"id", "first_seen_at", "first_seen_run_id"}
        set_: dict[str, Any] = {
            col.name: getattr(ex, col.name)
            for col in Market.__table__.columns
            if col.name not in keep
        }
        rules_changed = Market.rules_hash.is_distinct_from(ex.rules_hash)
        set_["rules_changed_at"] = case(
            (rules_changed, ex.last_seen_at), else_=Market.rules_changed_at
        )
        for heavy in ("raw", "raw_received_at", "description"):
            set_[heavy] = case((rules_changed, getattr(ex, heavy)), else_=getattr(Market, heavy))
        set_["closed_detected_at"] = case(
            (and_(Market.closed.is_(False), ex.closed.is_(True)), ex.last_seen_at),
            (ex.closed.is_(False), None),
            else_=Market.closed_detected_at,
        )
        conn.execute(stmt.on_conflict_do_update(index_elements=[Market.id], set_=set_))
        if token_rows:
            conn.execute(pg_insert(Token).values(token_rows).on_conflict_do_nothing())

    def _market_row(
        self,
        m: GammaMarket,
        raw: dict[str, Any],
        now: datetime,
        rules_hash: str,
        reasons: list[str],
    ) -> dict[str, Any]:
        return {
            "id": m.id,
            "source": gamma_mod.SOURCE,
            "data_origin": self.data_origin,
            "condition_id": m.condition_id,
            "question_id": m.question_id,
            "event_id": m.event.id if m.event else None,
            "slug": m.slug,
            "question": m.question,
            "description": m.description,
            "resolution_source": m.resolution_source,
            "outcomes": m.outcomes,
            "clob_token_ids": m.clob_token_ids,
            "group_item_title": m.group_item_title,
            "start_date": m.start_date,
            "end_date": m.end_date,
            "active": m.active,
            "closed": m.closed,
            "archived": m.archived,
            "restricted": m.restricted,
            "accepting_orders": m.accepting_orders,
            "enable_order_book": m.enable_order_book,
            "neg_risk": m.neg_risk,
            "neg_risk_market_id": m.neg_risk_market_id,
            "order_min_size": m.order_min_size,
            "tick_size": m.tick_size,
            "fees_enabled": m.fees_enabled,
            "fee_type": m.fee_type,
            "fee_schedule": m.fee_schedule,
            "maker_base_fee": m.maker_base_fee,
            "taker_base_fee": m.taker_base_fee,
            "uma_resolution_status": m.uma_resolution_status,
            "gamma_volume": m.volume,
            "gamma_volume_24h": m.volume_24h,
            "gamma_liquidity": m.liquidity,
            "gamma_outcome_prices": m.outcome_prices,
            "gamma_best_bid": m.best_bid,
            "gamma_best_ask": m.best_ask,
            "gamma_last_trade_price": m.last_trade_price,
            "rules_hash": rules_hash,
            "eligible": not reasons,
            "eligibility_reasons": reasons,
            "source_created_at": m.source_created_at,
            "source_updated_at": m.source_updated_at,
            "source_closed_time": m.closed_time,
            "first_seen_at": now,
            "first_seen_run_id": self.run_id,
            "last_seen_at": now,
            "last_seen_run_id": self.run_id,
            "rules_changed_at": None,
            "closed_detected_at": now if m.closed else None,
            "missing_since": None,
            "raw": gamma_mod.strip_raw(raw),
            "raw_received_at": now,
        }

    # ------------------------------------------------------------------ cierres
    def _stage_closures(self) -> None:
        with self.engine.connect() as conn:
            candidates = [
                r[0]
                for r in conn.execute(
                    select(Market.id).where(
                        Market.closed.is_(False),
                        Market.data_origin == self.data_origin,
                        (Market.last_seen_run_id.is_(None))
                        | (Market.last_seen_run_id != self.run_id),
                    )
                )
            ]
        if not candidates:
            return
        log.info("closure_check", run_id=self.run_id, candidates=len(candidates))
        for batch in _chunks(candidates, self.settings.closed_check_batch_size):
            try:
                raws, received_at = self.gamma.fetch_markets_by_ids(list(batch))
            except ApiError as exc:
                self._api_error("gamma_closed_check", gamma_mod.SOURCE, exc)
                self.notes.append("verificación de cierres incompleta por error de API")
                continue
            parsed = gamma_mod.parse_markets(raws)
            for entity, msg in parsed.invalid:
                self._error(
                    "gamma_closed_check",
                    gamma_mod.SOURCE,
                    "invalid_market",
                    msg,
                    entity_id=entity,
                )
            requested = set(batch)
            returned = {m.id for m, _ in parsed.valid}
            valid = [(m, r) for m, r in parsed.valid if m.id in requested]
            missing = [i for i in batch if i not in returned]
            with self.engine.begin() as conn:
                if valid:
                    self._persist_markets(conn, valid, received_at, collect_eligible=False)
                    still_open = sum(1 for m, _ in valid if not m.closed)
                    if still_open:
                        self.notes.append(
                            f"{still_open} mercados abiertos no aparecieron en el listado "
                            "pero sí en la consulta por id"
                        )
                if missing:
                    self.c.markets_missing_from_source += len(missing)
                    conn.execute(
                        update(Market)
                        .where(Market.id.in_(missing))
                        .values(missing_since=func.coalesce(Market.missing_since, received_at))
                    )
                self._flush_errors(conn)

    # ------------------------------------------------------------------ libros
    def _stage_books(self) -> None:
        """Descarga en paralelo acotado (``clob_concurrency`` hilos, un rate limiter
        compartido) y procesa los resultados en orden en el hilo principal, que es
        el único que escribe en la base y en los contadores."""
        chunks = list(_chunks(self._eligible, MARKETS_PER_BOOK_CHUNK))
        workers = max(1, self.settings.clob_concurrency)
        window = workers * 2  # lotes en vuelo: acota la memoria
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="clob") as pool:
            pending: deque[tuple[Sequence[EligibleMarket], Future[BookFetchResult]]] = deque()
            it = iter(chunks)

            def submit_next() -> None:
                chunk = next(it, None)
                if chunk is not None:
                    tokens = [t for em in chunk for t in em.token_ids]
                    pending.append((chunk, pool.submit(self.clob.fetch_books, tokens)))

            for _ in range(window):
                submit_next()
            done = 0
            while pending:
                chunk, future = pending.popleft()
                result = future.result()
                submit_next()
                self._handle_books(chunk, result)
                done += 1
                if done % 100 == 0:
                    with self.engine.begin() as conn:
                        self._checkpoint(conn)
                    log.info(
                        "books_progress",
                        run_id=self.run_id,
                        chunks=f"{done}/{len(chunks)}",
                        books_ok=self.c.books_ok,
                    )

    def _handle_books(self, chunk: Sequence[EligibleMarket], result: BookFetchResult) -> None:
        token_ids = [t for em in chunk for t in em.token_ids]
        self.c.tokens_requested += len(token_ids)
        self.c.clob_requests += result.requests
        for tok in result.missing:
            self.c.books_missing += 1
            self._error(
                "clob_books",
                clob_mod.SOURCE,
                "book_missing",
                "el CLOB no devolvió libro para este token",
                entity_id=tok,
            )
        for tok, msg in result.invalid:
            self.c.books_invalid += 1
            self._error("clob_books", clob_mod.SOURCE, "book_invalid", msg, entity_id=tok)
        for batch, exc in result.failed:
            self.c.books_failed += len(batch)
            self._api_error("clob_books", clob_mod.SOURCE, exc, entity=f"{len(batch)} tokens")
        self.c.books_ok += len(result.books)
        with self.engine.begin() as conn:
            self._persist_books(conn, chunk, result.books)
            self._flush_errors(conn)

    def _persist_books(
        self,
        conn: Connection,
        chunk: Sequence[EligibleMarket],
        books: dict[str, tuple[ClobBook, datetime]],
    ) -> None:
        snapshot_rows: list[dict[str, Any]] = []
        state_rows: list[dict[str, Any]] = []
        store_mode = self.settings.snapshot_store_levels
        max_levels = self.settings.snapshot_max_levels
        for em in chunk:
            metrics: list[BookMetrics | None] = []
            normalized: list[tuple[Any, Any] | None] = []
            received: list[datetime] = []
            source_ts: list[datetime] = []
            for tok in em.token_ids:
                entry = books.get(tok)
                if entry is None:
                    metrics.append(None)
                    normalized.append(None)
                    continue
                book, received_at = entry
                bids, asks = normalize_book(book.bids, book.asks)
                metrics.append(compute_metrics(bids, asks, band=self.liq_cfg.depth_band))
                normalized.append((bids, asks))
                received.append(received_at)
                if book.source_ts:
                    source_ts.append(book.source_ts)
            analyzed = all(m is not None for m in metrics)
            reasons = liquidity_reasons(metrics, self.liq_cfg)
            liquid = analyzed and not reasons
            if analyzed:
                self.c.markets_analyzed += 1
            if liquid:
                self.c.markets_liquid += 1
            for r in reasons:
                self.c.liquidity_breakdown[reason_family(r)] += 1

            in_scope = self.settings.snapshot_scope == "analyzed" or liquid
            for idx, tok in enumerate(em.token_ids):
                if not in_scope:
                    break
                entry = books.get(tok)
                m = metrics[idx]
                norm = normalized[idx]
                if entry is None or m is None or norm is None:
                    continue
                book, received_at = entry
                bids, asks = norm
                store = store_mode == "all" or (store_mode == "liquid" and liquid)
                snapshot_rows.append(
                    {
                        "run_id": self.run_id,
                        "token_id": tok,
                        "market_id": em.market_id,
                        "source": clob_mod.SOURCE,
                        "data_origin": self.data_origin,
                        "source_ts": book.source_ts,
                        "received_at": received_at,
                        "book_hash": book.hash or "sin-hash",
                        "best_bid": m.best_bid,
                        "best_ask": m.best_ask,
                        "best_bid_size": m.best_bid_size,
                        "best_ask_size": m.best_ask_size,
                        "mid": m.mid,
                        "spread": m.spread,
                        "bid_levels": m.bid_levels,
                        "ask_levels": m.ask_levels,
                        "bid_depth_usd": m.bid_depth_usd,
                        "ask_depth_usd": m.ask_depth_usd,
                        "bid_depth_band_usd": m.bid_depth_band_usd,
                        "ask_depth_band_usd": m.ask_depth_band_usd,
                        "tick_size": book.tick_size,
                        "min_order_size": book.min_order_size,
                        "clob_last_trade_price": book.last_trade_price,
                        "bids": truncate_levels(bids, max_levels) if store else None,
                        "asks": truncate_levels(asks, max_levels) if store else None,
                        "levels_truncated": bool(
                            store and (len(bids) > max_levels or len(asks) > max_levels)
                        ),
                    }
                )

            yes = metrics[0] if metrics else None
            yes_fill = None
            if yes is not None and normalized[0] is not None:
                yes_fill = simulate_buy(
                    normalized[0][1], notional_usd=self.settings.reference_notional_usd
                )
            present = [m for m in metrics if m is not None]
            state_rows.append(
                {
                    "market_id": em.market_id,
                    "run_id": self.run_id,
                    "data_origin": self.data_origin,
                    "analyzed_at": min(received) if received else self.clock(),
                    "source_ts_min": min(source_ts) if source_ts else None,
                    "analyzed": analyzed,
                    "liquid": liquid,
                    "reasons": reasons,
                    "yes_best_bid": yes.best_bid if yes else None,
                    "yes_best_ask": yes.best_ask if yes else None,
                    "yes_spread": yes.spread if yes else None,
                    "yes_mid": yes.mid if yes else None,
                    "yes_bid_depth_band_usd": yes.bid_depth_band_usd if yes else None,
                    "yes_ask_depth_band_usd": yes.ask_depth_band_usd if yes else None,
                    "min_depth_band_usd": (
                        min(min(m.bid_depth_band_usd, m.ask_depth_band_usd) for m in present)
                        if analyzed and present
                        else None
                    ),
                    "max_spread": (
                        max(m.spread for m in present if m.spread is not None)
                        if analyzed and all(m.spread is not None for m in present)
                        else None
                    ),
                    "sum_best_asks": (
                        round(sum(m.best_ask for m in present if m.best_ask is not None), 6)
                        if analyzed and all(m.best_ask is not None for m in present)
                        else None
                    ),
                    "sum_best_bids": (
                        round(sum(m.best_bid for m in present if m.best_bid is not None), 6)
                        if analyzed and all(m.best_bid is not None for m in present)
                        else None
                    ),
                    "reference_notional_usd": self.settings.reference_notional_usd,
                    "yes_buy_avg_price_ref": yes_fill.avg_price if yes_fill else None,
                    "yes_buy_slippage_ref": yes_fill.slippage if yes_fill else None,
                    "yes_buy_fully_filled_ref": yes_fill.fully_filled if yes_fill else None,
                    "outcomes_metrics": [
                        {"outcome": o, "token_id": t, **(asdict(m) if m else {"book": None})}
                        for o, t, m in zip(em.outcomes, em.token_ids, metrics, strict=True)
                    ],
                }
            )

        if snapshot_rows:
            inserted = conn.execute(
                pg_insert(OrderbookSnapshot)
                .values(snapshot_rows)
                .on_conflict_do_nothing(constraint="uq_snapshot_token_ts_hash")
                .returning(OrderbookSnapshot.id)
            ).all()
            self.c.snapshots_inserted += len(inserted)
            self.c.snapshots_unchanged += len(snapshot_rows) - len(inserted)
        if state_rows:
            stmt = pg_insert(MarketState).values(state_rows)
            conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[MarketState.market_id],
                    set_={
                        col.name: getattr(stmt.excluded, col.name)
                        for col in MarketState.__table__.columns
                        if col.name != "market_id"
                    },
                )
            )


def run_ingestion(
    engine: Engine,
    settings: Settings,
    *,
    trigger: str = "manual",
    gamma: GammaClient | None = None,
    clob: ClobClient | None = None,
    data_origin: str = "real",
) -> int:
    close: Callable[[], None] | None = None
    if gamma is None or clob is None:
        g, c, close = build_clients(settings)
        gamma = gamma or g
        clob = clob or c
    try:
        return IngestionPipeline(
            engine, settings, gamma, clob, trigger=trigger, data_origin=data_origin
        ).run()
    finally:
        if close:
            close()
