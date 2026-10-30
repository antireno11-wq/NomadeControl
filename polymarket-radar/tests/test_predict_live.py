"""Corrida en vivo por tandas: libros pedidos justo antes de valorar y mercados cerrados fuera.

Mercados con reglas reales (``crypto_rules_real.json``), velas y libros SINTÉTICOS y un
reloj simulado que salta en el tiempo para imitar una base remota lenta.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from radar.db.models import Event, Market, PredictionRecord, ValuationRecord
from radar.ingestion.clob import ClobClient
from radar.ingestion.http import ApiClient
from radar.predict import service
from radar.predict.crypto.binance import MINUTE_MS, BinanceKlines, Candles, to_ms
from radar.predict.crypto.predictor import CryptoEvidence
from tests.conftest import make_settings
from tests.fakes import FakePolymarket, liquid_book
from tests.test_predict_crypto import synthetic_candles

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "crypto_rules_real.json").read_text(encoding="utf-8")
)


class FakeClock:
    """Reloj simulado: avanza 10 ms por lectura y se puede adelantar a mano."""

    def __init__(self, t: datetime) -> None:
        self.t = t

    def __call__(self) -> datetime:
        self.t += timedelta(milliseconds=10)
        return self.t


def api(transport: httpx.MockTransport, base: str) -> ApiClient:
    return ApiClient(base, name="fake", rate_per_s=1000.0, max_retries=0, backoff_base_s=0.0,
                     backoff_max_s=0.0, transport=transport, sleep=lambda _s: None)  # fmt: skip


# --------------------------------------------------------------------- velas por REST


def test_extend_adds_only_new_closed_candles(tmp_path: Path) -> None:
    now = datetime(2026, 10, 25, 22, 30, 30, tzinfo=UTC)
    base = to_ms(now.replace(second=0)) - 12 * MINUTE_MS
    calls: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        p = dict(request.url.params)
        calls.append(p)
        # Como Binance: devuelve también la vela en curso (abre antes de endTime).
        opens = range(int(p["startTime"]), int(p["endTime"]) + 1, MINUTE_MS)
        return httpx.Response(200, json=[[o, "1", "2", "0.5", "1.5", "9"] for o in opens])

    t = httpx.MockTransport(handler)
    kl = BinanceKlines(tmp_path, api(t, "https://bulk.test"), api(t, "https://rest.test"))
    kl.now = now
    n = 5
    ts = base + MINUTE_MS * np.arange(n, dtype=np.int64)
    c = Candles("BTCUSDT", ts, np.ones(n), np.ones(n), np.ones(n), np.ones(n), [])

    out = kl.extend(c, now + timedelta(hours=1))  # nunca más allá de ``now``
    assert int(calls[0]["startTime"]) == base + n * MINUTE_MS  # solo la cola
    assert len(out) == 12  # 22:18 … 22:29; la de 22:30 sigue abierta
    assert int(out.open_ms[-1]) == to_ms(now.replace(second=0)) - MINUTE_MS
    assert out.refs[-1].kind == "rest"

    assert kl.extend(out, now) is out  # ninguna vela nueva pudo cerrar
    assert len(calls) == 1

    kl.now = now + timedelta(minutes=2)
    again = kl.extend(out, kl.now)
    assert len(calls) == 2 and len(again) == 14


# --------------------------------------------------------------------- corrida en vivo

KEYS = [
    "hourly_above",  # cierra 25-oct 23:00
    "hourly_updown",  # 25-oct 23:00
    "touch_day",  # 26-oct 04:00
    "touch_range",  # 26-oct 04:00
    "daily_above",  # 26-oct 16:00
    "daily_range",  # 26-oct 16:00
    "touch_month",  # 1-nov 04:00
]
T0 = datetime(2026, 10, 25, 22, 30, tzinfo=UTC)


def insert_markets(engine: Engine) -> None:
    with Session(engine) as s:
        for key in KEYS:
            m = FIX["markets"][key]
            s.add(Event(id=f"e{m['id']}", title=m["question"], category="crypto",
                        first_seen_at=T0, last_seen_at=T0))  # fmt: skip
        s.flush()
        for key in KEYS:
            m = FIX["markets"][key]
            s.add(
                Market(
                    id=m["id"],
                    event_id=f"e{m['id']}",
                    question=m["question"],
                    description=m["description"],
                    outcomes=m["outcomes"],
                    clob_token_ids=[f"{key}-0", f"{key}-1"],
                    start_date=datetime.fromisoformat(m["start_date"]),
                    end_date=datetime.fromisoformat(m["end_date"]),
                    active=True,
                    closed=False,
                    archived=False,
                    accepting_orders=True,
                    enable_order_book=True,
                    neg_risk=False,
                    rules_hash="sintetico",
                    first_seen_at=T0,
                    last_seen_at=T0,
                    raw={},
                    raw_received_at=T0,
                )
            )
        s.commit()


@pytest.mark.db
def test_live_run_values_each_batch_against_fresh_books(
    engine: Engine, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    insert_markets(engine)
    clock = FakeClock(T0)
    monkeypatch.setattr(service, "utcnow", clock)
    monkeypatch.setattr("radar.ingestion.http.utcnow", clock)

    refreshed: list[datetime] = []

    class FakeLoader:
        def __init__(self, _settings: Any, **_k: Any) -> None:
            pass

        def load(self, *_a: Any, **_k: Any) -> CryptoEvidence:
            return CryptoEvidence(candles={"BTCUSDT": synthetic_candles()})

        def refresh(self, evidence: CryptoEvidence, now: datetime) -> CryptoEvidence:
            refreshed.append(now)
            return evidence

    monkeypatch.setattr(service, "EvidenceLoader", FakeLoader)

    class SlowBooks(FakePolymarket):
        def handle(self, request: httpx.Request) -> httpx.Response:
            if request.url.path == "/books" and b"daily_above-0" in request.content:
                clock.t = datetime(2026, 10, 26, 16, 0, 30, tzinfo=UTC)  # respuesta tardía
            return super().handle(request)

    fake = SlowBooks(books={f"{k}-{i}": liquid_book(f"{k}-{i}") for k in KEYS for i in (0, 1)})
    clob = ClobClient(api(fake.transport(), "https://clob.test"), batch_size=200)
    monkeypatch.setattr(
        "radar.ingestion.pipeline.build_clients", lambda _s: (None, clob, lambda: None)
    )

    persist = service._persist_live_batch
    writes: list[int] = []

    def slow_db(engine: Any, run_id: int, done: list[Any]) -> None:
        persist(engine, run_id, done)
        writes.append(len(done))
        if len(writes) == 1:  # la base remota tarda: la siguiente tanda empieza a las 04:05
            clock.t = datetime(2026, 10, 26, 4, 5, tzinfo=UTC)

    monkeypatch.setattr(service, "_persist_live_batch", slow_db)

    out = service.predict_live(make_settings(data_dir=str(tmp_path)), engine, batch_markets=2)

    c = out["crypto"]
    assert c["interpretables"] == 7
    # touch_day/touch_range cerraron antes de su tanda; daily_* mientras llegaba el libro.
    assert c["cerrados_antes_de_valorar"] == {
        "antes_de_pedir_libro": 2,
        "antes_de_recibir_libro": 2,
    }
    asked = [
        {item["token_id"] for item in json.loads(r.content)}
        for r in fake.requests
        if r.url.path == "/books"
    ]
    assert asked == [
        {"hourly_above-0", "hourly_above-1", "hourly_updown-0", "hourly_updown-1"},
        {"daily_above-0", "daily_above-1", "daily_range-0", "daily_range-1"},
        {"touch_month-0", "touch_month-1"},
    ]
    assert c["libros"] == {"pedidos": 10, "recibidos": 10, "faltantes": 0, "fallidos": 0}
    assert c["tandas"]["con_libros"] == 3 and len(refreshed) == 4
    assert c["antiguedad_libro_s"]["maxima"] < 1

    with Session(engine) as s:
        vals = s.execute(select(ValuationRecord)).scalars().all()
        preds = s.execute(select(PredictionRecord)).scalars().all()
    ids = {k: FIX["markets"][k]["id"] for k in KEYS}
    assert {v.market_id for v in vals} == {ids["hourly_above"], ids["hourly_updown"],
                                           ids["touch_month"]}  # fmt: skip
    v1 = [p for p in preds if p.model_version == "crypto-models-v1"]
    assert len(v1) == 3 * 4 and all(v.book_age_s < 1 for v in vals)
    # v2 corre en paralelo (sin valorar): opciones y mezcla siempre; vol si hay parámetros v2
    v2 = {p.model for p in preds if p.model_version == "crypto-models-v2"}
    assert {"cripto2-opciones", "cripto2-mezcla"} <= v2
    assert all(by.model_version == "crypto-models-v1" for by in preds
               if by.id in {v.prediction_id for v in vals})  # fmt: skip
    # Cada tanda predice en su propio as_of, no en el de inicio de la corrida.
    as_of = {p.market_id: p.as_of for p in preds}
    assert as_of[ids["hourly_above"]] < T0 + timedelta(minutes=1)
    assert as_of[ids["touch_month"]] > datetime(2026, 10, 26, 16, 0, 30, tzinfo=UTC)
    by_id = {p.id: p for p in preds}
    for v in vals:  # cada valoración apunta a la predicción de su mercado
        assert by_id[v.prediction_id].market_id == v.market_id
        assert by_id[v.prediction_id].as_of == v.as_of
