"""Integración del pipeline contra PostgreSQL real con APIs falsas (datos SINTÉTICOS)."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from radar.db.models import (
    Event,
    IngestionError,
    IngestionRun,
    Market,
    MarketState,
    OrderbookSnapshot,
    Token,
)
from radar.ingestion.pipeline import (
    ADVISORY_LOCK_KEY,
    IngestionPipeline,
    RunAlreadyInProgressError,
)
from radar.reports import build_run_report
from tests.conftest import make_clients, make_settings
from tests.fakes import (
    FakePolymarket,
    liquid_book,
    one_sided_book,
    synthetic_event,
    synthetic_market,
)

pytestmark = pytest.mark.db


def run(engine, fake, **settings_kw):
    settings = make_settings(**settings_kw)
    gamma, clob = make_clients(fake, settings)
    pipe = IngestionPipeline(engine, settings, gamma, clob, trigger="test", data_origin="synthetic")
    run_id = pipe.run()
    with Session(engine) as s:
        return s.get(IngestionRun, run_id)


def count(engine, model) -> int:
    with Session(engine) as s:
        return s.execute(select(func.count()).select_from(model)).scalar_one()


def scenario() -> FakePolymarket:
    """6 mercados abiertos + 1 inválido:
    m1, m2 líquidos · m3 libro de un lado · m4 sin libro para un token ·
    m5 no acepta órdenes · m6 fecha de cierre vencida."""
    markets = [
        synthetic_market("m1", event_id="e1"),
        synthetic_market("m2", event_id="e1"),
        synthetic_market("m3", event_id="e2"),
        synthetic_market("m4", event_id="e2"),
        synthetic_market("m5", event_id="e3", accepting_orders=False),
        synthetic_market("m6", event_id="e3", end_date="2020-01-01T00:00:00Z"),
    ]
    books = {}
    for m in ("m1", "m2", "m4"):
        books[f"{m}-yes"] = liquid_book(f"{m}-yes")
        books[f"{m}-no"] = liquid_book(f"{m}-no")
    books["m3-yes"] = one_sided_book("m3-yes")
    books["m3-no"] = liquid_book("m3-no")
    del books["m4-no"]
    return FakePolymarket(
        markets=markets,
        events=[synthetic_event("e1", ["crypto"]), synthetic_event("e2", ["nba"])],
        books=books,
        raw_invalid_markets=[{"id": "bad1", "question": None}],
        page_size=4,
    )


def test_full_run_counts_and_storage(engine):
    fake = scenario()
    r = run(engine, fake, gamma_page_size=4)
    assert r.data_origin == "synthetic"
    assert r.discovery_complete is True
    assert r.gamma_pages == 2
    assert r.events_discovered == 2
    assert r.markets_discovered == 6
    assert r.markets_invalid == 1
    assert r.markets_new == 6
    assert r.markets_eligible == 4
    assert r.eligibility_breakdown == {"not_accepting_orders": 1, "end_date_passed": 1}
    assert r.tokens_requested == 8
    assert r.books_ok == 7
    assert r.books_missing == 1
    assert r.markets_analyzed == 3  # m4 no tiene todos sus libros
    assert r.markets_liquid == 2
    assert r.liquidity_breakdown["one_sided"] == 1
    assert r.liquidity_breakdown["book_missing"] == 1
    assert r.snapshots_inserted == 4  # alcance por defecto: solo mercados líquidos
    # Errores: 1 mercado inválido + 1 libro faltante → corrida parcial, con evidencia.
    assert r.errors_count == 2
    assert r.status == "partial"
    with Session(engine) as s:
        errs = s.execute(select(IngestionError.stage, IngestionError.error_type)).all()
        assert sorted(errs) == [("clob_books", "book_missing"), ("gamma_markets", "invalid_market")]
        assert s.get(Event, "e1").category == "crypto"
        assert s.get(Event, "e3").category == "unknown"  # stub sin etiquetas
        m1 = s.get(Market, "m1")
        assert m1.eligible and m1.data_origin == "synthetic"
        assert m1.raw.get("events") is None  # los eventos se guardan aparte
        assert s.get(Market, "m5").eligibility_reasons == ["not_accepting_orders"]
        st = s.get(MarketState, "m1")
        assert st.liquid and st.yes_best_bid == 0.49 and st.yes_best_ask == 0.51
        assert st.sum_best_asks == pytest.approx(1.02)
        assert st.yes_buy_fully_filled_ref is True
        assert s.get(MarketState, "m3").reasons == ["outcome0:one_sided"]
        assert s.get(MarketState, "m4").analyzed is False
        snap = s.execute(
            select(OrderbookSnapshot).where(OrderbookSnapshot.token_id == "m1-yes")
        ).scalar_one()
        assert snap.source_ts is not None and snap.received_at is not None
        assert snap.bids[0] == {"price": 0.49, "size": 1000.0}  # mejor bid primero
        assert snap.asks[0] == {"price": 0.51, "size": 1000.0}
    assert count(engine, Token) == 12


def test_rerun_is_idempotent(engine):
    fake = scenario()
    run(engine, fake, gamma_page_size=4)
    before = {m: count(engine, m) for m in (Market, Token, Event, OrderbookSnapshot, MarketState)}
    r2 = run(engine, fake, gamma_page_size=4)
    after = {m: count(engine, m) for m in (Market, Token, Event, OrderbookSnapshot, MarketState)}
    assert before == after
    assert r2.markets_new == 0
    assert r2.snapshots_inserted == 0
    assert r2.snapshots_unchanged == 4


def test_changed_book_creates_new_snapshot(engine):
    fake = scenario()
    run(engine, fake, gamma_page_size=4)
    fake.books["m1-yes"] = liquid_book("m1-yes", bid=0.47, ask=0.50)
    fake.books["m1-yes"]["timestamp"] = "1792965999999"
    r2 = run(engine, fake, gamma_page_size=4)
    assert r2.snapshots_inserted == 1
    with Session(engine) as s:
        assert s.get(MarketState, "m1").yes_best_bid == 0.47


def test_snapshot_scope_analyzed_stores_all_analyzed_books(engine):
    r = run(engine, scenario(), gamma_page_size=4, snapshot_scope="analyzed")
    assert r.snapshots_inserted == 7  # m1, m2, m3 completos + m4-yes


def test_closures_are_confirmed_by_id_never_assumed(engine):
    fake = FakePolymarket(
        markets=[synthetic_market(i) for i in ("a", "b", "c", "d")],
        books={f"{i}-{o}": liquid_book(f"{i}-{o}") for i in "abcd" for o in ("yes", "no")},
    )
    run(engine, fake)
    # c cierra (Gamma lo confirma por id); d desaparece sin confirmación.
    c_closed = {**synthetic_market("c"), "closed": True}
    fake.markets = [synthetic_market("a"), synthetic_market("b")]
    fake.by_id_extra = {"c": c_closed}
    r2 = run(engine, fake)
    assert r2.markets_closed_detected == 1
    assert r2.markets_missing_from_source == 1
    with Session(engine) as s:
        c = s.get(Market, "c")
        d = s.get(Market, "d")
        assert c.closed and c.closed_detected_at is not None and not c.eligible
        assert not d.closed and d.missing_since is not None
    # Las consultas de cierre no deben duplicar ni reabrir nada en la siguiente corrida.
    r3 = run(engine, fake)
    assert r3.markets_closed_detected == 0
    assert count(engine, Market) == 4


def test_incomplete_discovery_never_infers_closures(engine):
    fake = FakePolymarket(
        markets=[synthetic_market(str(i)) for i in range(6)],
        books={f"{i}-{o}": liquid_book(f"{i}-{o}") for i in range(6) for o in ("yes", "no")},
        page_size=3,
    )
    run(engine, fake, gamma_page_size=3)
    fake.fail_markets_page = 2
    r2 = run(engine, fake, gamma_page_size=3)
    assert r2.discovery_complete is False
    assert r2.status == "partial"
    assert r2.markets_discovered == 3
    assert r2.markets_missing_from_source == 0
    assert any("incompleta" in n for n in r2.notes)
    with Session(engine) as s:
        assert (
            s.execute(select(func.count()).where(Market.missing_since.is_not(None))).scalar() == 0
        )
        err = s.execute(select(IngestionError).where(IngestionError.run_id == r2.id)).scalar_one()
        assert err.stage == "gamma_markets" and err.http_status == 500 and err.attempts == 3


def test_max_pages_marks_discovery_truncated(engine):
    fake = FakePolymarket(markets=[synthetic_market(str(i)) for i in range(6)], page_size=3)
    r = run(engine, fake, gamma_page_size=3, gamma_max_pages=1)
    assert not r.discovery_complete
    assert any("truncada" in n for n in r.notes)


def test_rules_change_is_detected(engine):
    fake = FakePolymarket(markets=[synthetic_market("a")], books={})
    run(engine, fake)
    fake.markets = [synthetic_market("a", description="SINTÉTICO: regla modificada")]
    r2 = run(engine, fake)
    assert r2.markets_rules_changed == 1
    with Session(engine) as s:
        assert s.get(Market, "a").rules_changed_at is not None


def test_clob_outage_is_recorded_and_nothing_is_invented(engine):
    fake = FakePolymarket(markets=[synthetic_market("a")], books_status=503)
    r = run(engine, fake)
    assert r.books_failed == 2 and r.books_ok == 0
    assert r.markets_analyzed == 0 and r.markets_liquid == 0
    assert r.status == "partial"
    with Session(engine) as s:
        st = s.get(MarketState, "a")
        assert st.analyzed is False and st.yes_best_bid is None
        assert count(engine, OrderbookSnapshot) == 0
        err = s.execute(
            select(IngestionError).where(IngestionError.stage == "clob_books")
        ).scalar_one()
        assert err.http_status == 503


def test_gamma_outage_fails_run(engine):
    fake = FakePolymarket(markets=[synthetic_market("a")], fail_markets_page=1)
    r = run(engine, fake)
    assert r.status == "failed"
    assert r.markets_discovered == 0


def test_concurrent_runs_are_prevented(engine):
    fake = FakePolymarket(markets=[synthetic_market("a")])
    with engine.connect() as other:
        other.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY})
        with pytest.raises(RunAlreadyInProgressError):
            run(engine, fake)
        other.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY})
    assert count(engine, IngestionRun) == 0
    run(engine, fake)  # liberado el lock, corre normalmente


def test_interrupted_run_is_marked_failed(engine):
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO ingestion_runs (trigger, status, data_origin, started_at, "
                "discovery_complete, gamma_pages, events_discovered, markets_discovered, "
                "markets_duplicated, markets_invalid, markets_new, markets_rules_changed, "
                "markets_closed_detected, markets_missing_from_source, markets_eligible, "
                "tokens_requested, clob_requests, books_ok, books_missing, books_invalid, "
                "books_failed, markets_analyzed, markets_liquid, snapshots_inserted, "
                "snapshots_unchanged, errors_count, eligibility_breakdown, liquidity_breakdown, "
                "stage_timings_s, config, notes) VALUES ('test','running','synthetic', now(), "
                "false,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,'{}','{}','{}','{}','[]')"
            )
        )
    run(engine, FakePolymarket(markets=[synthetic_market("a")]))
    with Session(engine) as s:
        stale = s.get(IngestionRun, 1)
        assert stale.status == "failed" and "interrumpida" in stale.notes[0]


def test_report_reflects_database_and_labels_synthetic(engine):
    r = run(engine, scenario(), gamma_page_size=4)
    with Session(engine) as s:
        md = build_run_report(s, make_settings(), s.get(IngestionRun, r.id))
    assert "DATOS SINTÉTICOS" in md
    assert "| Mercados abiertos descubiertos (únicos) | 6 |" in md
    assert "| Mercados que pasan filtro de liquidez | 2 |" in md
    assert "clob_books:book_missing" in md


def test_raw_payload_is_kept_until_rules_change(engine):
    fake = FakePolymarket(markets=[synthetic_market("a", volume_24h=1.0)], books={})
    run(engine, fake)
    with Session(engine) as s:
        first = s.get(Market, "a")
        raw_ts, raw_vol = first.raw_received_at, first.raw["volume24hr"]
    # Cambio solo volátil: se actualiza la columna, no el JSON crudo ni las reglas.
    fake.markets = [synthetic_market("a", volume_24h=2.0)]
    run(engine, fake)
    with Session(engine) as s:
        m = s.get(Market, "a")
        assert m.gamma_volume_24h == 2.0
        assert m.raw["volume24hr"] == raw_vol and m.raw_received_at == raw_ts
        assert m.description.startswith("SINTÉTICO")
    # Cambio de reglas: se reemplazan JSON crudo y texto de reglas.
    fake.markets = [synthetic_market("a", volume_24h=3.0, description="SINTÉTICO: nueva")]
    run(engine, fake)
    with Session(engine) as s:
        m = s.get(Market, "a")
        assert m.raw["volume24hr"] == 3.0 and m.raw_received_at > raw_ts
        assert m.description == "SINTÉTICO: nueva"
