"""Backend FastAPI de solo lectura.

No existe ningún endpoint que envíe órdenes: el sistema no opera con dinero real.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy.orm import Session

from radar import __version__, queries
from radar.config import Settings, get_settings
from radar.connectivity import check_all
from radar.db.models import IngestionRun
from radar.db.session import check_db, get_engine, session_factory
from radar.timeutil import utcnow

app = FastAPI(
    title="Polymarket AI Radar",
    version=__version__,
    description=(
        "API de solo lectura sobre datos públicos de Polymarket. Modo exclusivo de "
        "simulación en papel: no se envían órdenes reales."
    ),
)


def get_session() -> Iterator[Session]:
    factory = session_factory(get_engine(get_settings().database_url))
    session = factory()
    try:
        yield session
    finally:
        session.close()


SessionDep = Annotated[Session, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def _age_s(ts: str | None, now: datetime) -> float | None:
    if not ts:
        return None
    return round((now - datetime.fromisoformat(ts)).total_seconds(), 1)


@app.get("/api/health")
def health(settings: SettingsDep) -> dict[str, Any]:
    db_error = check_db(get_engine(settings.database_url))
    return {
        "status": "ok" if db_error is None else "degraded",
        "database": "ok" if db_error is None else db_error,
        "version": __version__,
        "trading_mode": "paper_only",
        "real_trading_enabled": False,
        "time": utcnow().isoformat(),
    }


@app.get("/api/connectivity")
def connectivity(settings: SettingsDep) -> dict[str, Any]:
    """Comprobación en vivo (hace una solicitud a cada API)."""
    return check_all(settings)


@app.get("/api/status")
def status(session: SessionDep, settings: SettingsDep) -> dict[str, Any]:
    now = utcnow()
    newest = queries.latest_run(session)
    # Las cifras se toman de la última corrida terminada (incluidas las fallidas,
    # para que sus errores se vean); una corrida en curso se informa aparte.
    last = queries.latest_run(session, finished_only=True)
    last_ok = queries.latest_completed_run(session)
    in_progress = newest if newest is not None and newest.status == "running" else None
    counts = queries.table_counts(session)
    if last is None:
        mode = "sin_datos"
    else:
        mode = "demo_sintetica" if last.data_origin == "synthetic" else "datos_reales"
    last_d = queries.run_to_dict(last) if last else None
    last_ok_d = queries.run_to_dict(last_ok) if last_ok else None
    sources: dict[str, Any] = {}
    if last_d:
        errs = last_d["error_summary"]
        gamma_errs = sum(v for k, v in errs.items() if k.startswith(("gamma", "internal")))
        clob_errs = sum(v for k, v in errs.items() if k.startswith("clob"))
        sources = {
            "polymarket_gamma": {
                "last_run_id": last.id if last else None,
                "errors_last_run": gamma_errs,
                "discovery_complete": last_d["discovery_complete"],
                "state": "ok"
                if gamma_errs == 0 and last_d["discovery_complete"]
                else ("degradado" if last_d["markets_discovered"] else "caído"),
            },
            "polymarket_clob": {
                "last_run_id": last.id if last else None,
                "errors_last_run": clob_errs,
                "book_coverage": last_d["book_coverage"],
                "state": "ok"
                if clob_errs == 0 and last_d["books_ok"]
                else ("degradado" if last_d["books_ok"] else "sin datos o caído"),
            },
        }
    return {
        "now": now.isoformat(),
        "data_mode": mode,
        "trading_mode": "paper_only",
        "last_run": last_d,
        "last_run_age_s": _age_s(last_d["finished_at"] if last_d else None, now),
        "last_completed_run": last_ok_d,
        "run_in_progress": queries.run_to_dict(in_progress) if in_progress else None,
        "sources": sources,
        "table_counts": counts,
        "modules": {
            "ingesta": "implementado",
            "inteligencia_contratos": "pendiente (hito 2)",
            "arbitraje": "pendiente (hito 3)",
            "modelos_predictivos": "pendiente (hito 4)",
            "valoracion": "pendiente (hito 5)",
            "cartera_virtual": "pendiente (hito 6)",
            "backtesting": "pendiente (hito 7)",
            "alertas": "pendiente (hito 8)",
        },
    }


@app.get("/api/runs")
def runs(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 20
) -> list[dict[str, Any]]:
    return [queries.run_to_dict(r) for r in queries.list_runs(session, limit)]


@app.get("/api/runs/{run_id}")
def run_detail(run_id: int, session: SessionDep) -> dict[str, Any]:
    run = session.get(IngestionRun, run_id)
    if run is None:
        raise HTTPException(404, "corrida no encontrada")
    return queries.run_to_dict(run)


@app.get("/api/runs/{run_id}/errors")
def run_errors(
    run_id: int,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    if session.get(IngestionRun, run_id) is None:
        raise HTTPException(404, "corrida no encontrada")
    return queries.run_errors(session, run_id, limit=limit, offset=offset)


@app.get("/api/markets")
def markets(
    session: SessionDep,
    settings: SettingsDep,
    liquid_only: bool = True,
    category: str | None = None,
    search: Annotated[str | None, Query(max_length=200)] = None,
    sort: Annotated[str, Query(pattern="^(spread|depth|volume_24h|end_date|analyzed_at)$")] = (
        "spread"
    ),
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    return queries.list_markets(
        session,
        settings,
        liquid_only=liquid_only,
        category=category,
        search=search,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@app.get("/api/markets/{market_id}")
def market(market_id: str, session: SessionDep, settings: SettingsDep) -> dict[str, Any]:
    data = queries.market_detail(session, settings, market_id)
    if data is None:
        raise HTTPException(404, "mercado no encontrado")
    return data


@app.get("/api/markets/{market_id}/snapshots")
def market_snapshots(
    market_id: str,
    session: SessionDep,
    token_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
) -> list[dict[str, Any]]:
    return queries.market_snapshots(session, market_id, token_id=token_id, limit=limit)


@app.get("/api/categories")
def categories(session: SessionDep) -> list[dict[str, Any]]:
    return queries.category_counts(session)
