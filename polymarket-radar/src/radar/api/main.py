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
            "modelos_predictivos": (
                "interfaz común predict(); cripto (4 modelos) y electoral implementados; "
                "macro, corporativo, deportes, clima y otros se abstienen con motivo"
            ),
            "valoracion": "implementada (valuation-v1) contra libros pedidos en el momento",
            "cartera_virtual": "pendiente (hito 6)",
            "backtesting": "cripto: cronológico con entrenamiento/validación/prueba",
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


# --------------------------------------------------------------------------- electoral
def _latest_election_run(session: Session, kind: str) -> Any:
    from sqlalchemy import desc, select

    from radar.db.models import ElectionRun

    return session.execute(
        select(ElectionRun)
        .where(ElectionRun.kind == kind, ElectionRun.status == "success")
        .order_by(desc(ElectionRun.id))
        .limit(1)
    ).scalar_one_or_none()


def _report_json(run: Any) -> dict[str, Any] | None:
    import json
    from pathlib import Path

    if run is None or not run.report_path:
        return None
    path = Path(run.report_path).with_suffix(".json")
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[3] / path
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/elections/summary")
def elections_summary(session: SessionDep) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for kind in ("discover", "backtest", "evaluate", "scan"):
        run = _latest_election_run(session, kind)
        out[kind] = (
            {
                "run_id": run.id,
                "mode": run.mode,
                "contest_key": run.contest_key,
                "finished_at": run.finished_at.isoformat() if run.finished_at else None,
                "summary": run.summary,
                "report_path": run.report_path,
            }
            if run
            else None
        )
    return out


@app.get("/api/elections/markets")
def elections_markets(
    session: SessionDep,
    coverage: str | None = None,
    country: str | None = None,
    market_type: str | None = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 200,
) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from radar.db.models import ElectionMarket, Market

    stmt = select(ElectionMarket, Market.question).join(
        Market, Market.id == ElectionMarket.market_id
    )
    if coverage:
        stmt = stmt.where(ElectionMarket.coverage == coverage)
    if country:
        stmt = stmt.where(ElectionMarket.country == country)
    if market_type:
        stmt = stmt.where(ElectionMarket.market_type == market_type)
    rows = session.execute(stmt.order_by(ElectionMarket.market_id).limit(limit)).all()
    return [
        {
            "market_id": em.market_id,
            "question": q,
            "market_type": em.market_type,
            "office": em.office,
            "country": em.country,
            "round": em.round,
            "candidate": em.candidate,
            "contest_key": em.contest_key,
            "coverage": em.coverage,
            "abstain_reason": em.abstain_reason,
        }
        for em, q in rows
    ]


@app.get("/api/elections/backtest")
def elections_backtest(session: SessionDep) -> dict[str, Any]:
    data = _report_json(_latest_election_run(session, "backtest"))
    if data is None:
        raise HTTPException(404, "no hay backtest electoral: ejecute 'radar elections backtest'")
    return data


@app.get("/api/elections/evaluation")
def elections_evaluation(session: SessionDep) -> dict[str, Any]:
    data = _report_json(_latest_election_run(session, "evaluate"))
    if data is None:
        raise HTTPException(404, "no hay evaluación: ejecute 'radar elections evaluate'")
    return data


@app.get("/api/elections/alerts")
def elections_alerts(
    session: SessionDep,
    mode: str | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from radar.db.models import ElectionAlert

    stmt = select(ElectionAlert)
    if mode:
        stmt = stmt.where(ElectionAlert.mode == mode)
    rows = session.execute(
        stmt.order_by(ElectionAlert.as_of, ElectionAlert.id).limit(limit)
    ).scalars()
    return [
        {
            "id": a.id,
            "mode": a.mode,
            "kind": a.kind,
            "contest_key": a.contest_key,
            "label": a.label,
            "as_of": a.as_of.isoformat(),
            "created_at": a.created_at.isoformat(),
            "price": a.price,
            "price_basis": a.price_basis,
            "reference_prob": a.reference_prob,
            "discrepancy_pp": a.discrepancy_pp,
            "conservative_edge_pp": a.conservative_edge_pp,
            "signal": a.signal,
            "gating": a.gating,
            "ledger_seq": a.ledger_seq,
            "sha256": a.sha256,
            "prev_sha256": a.prev_sha256,
        }
        for a in rows
    ]


# ----------------------------------------------------------- modelos predictivos


def _latest_prediction_run(session: Session, kind: str) -> Any:
    from sqlalchemy import select

    from radar.db.models import PredictionRun

    return session.execute(
        select(PredictionRun)
        .where(PredictionRun.kind == kind, PredictionRun.status == "success")
        .order_by(PredictionRun.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def _run_dict(run: Any) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "run_id": run.id,
        "kind": run.kind,
        "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "params_version": run.params_version,
        "summary": run.summary,
        "report_path": run.report_path,
    }


@app.get("/api/predict/summary")
def predict_summary(session: SessionDep) -> dict[str, Any]:
    from sqlalchemy import select

    from radar.db.models import PredictionRun

    recent = session.execute(
        select(PredictionRun.id, PredictionRun.status, PredictionRun.started_at,
               PredictionRun.finished_at)
        .where(PredictionRun.kind == "live")
        .order_by(PredictionRun.id.desc())
        .limit(12)
    ).all()  # fmt: skip
    return {
        "live": _run_dict(_latest_prediction_run(session, "live")),
        "backtest": _run_dict(_latest_prediction_run(session, "backtest")),
        # Últimas revisiones en vivo (cualquier estado), de la más nueva a la más vieja.
        "recientes": [
            {
                "run_id": r.id,
                "status": r.status,
                "started_at": r.started_at.isoformat(),
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            }
            for r in recent
        ],
    }


@app.get("/api/opportunities")
def opportunities(
    session: SessionDep,
    recommendation: str | None = None,
    min_edge_pp: float | None = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
) -> dict[str, Any]:
    """Valoraciones de la última corrida en vivo, ordenadas por diferencia en p.p."""
    from sqlalchemy import select

    from radar.db.models import ValuationRecord

    run = _latest_prediction_run(session, "live")
    if run is None:
        return {"run": None, "items": [], "nota": "Información insuficiente: sin corrida en vivo"}
    stmt = select(ValuationRecord).where(ValuationRecord.run_id == run.id)
    if recommendation:
        stmt = stmt.where(ValuationRecord.recommendation == recommendation)
    if min_edge_pp is not None:
        stmt = stmt.where(ValuationRecord.edge_pp >= min_edge_pp)
    rows = session.execute(
        stmt.order_by(ValuationRecord.edge_pp.desc().nulls_last()).limit(limit)
    ).scalars()
    items = []
    for v in rows:
        d = {c.name: getattr(v, c.name) for c in v.__table__.columns}
        for k in ("as_of", "end_date", "book_received_at"):
            if d.get(k) is not None:
                d[k] = d[k].isoformat()
        items.append(d)
    from radar.db.models import Event, Market

    ids = {d["market_id"] for d in items}
    slugs = dict(
        session.execute(
            select(Market.id, Event.slug)
            .join(Event, Event.id == Market.event_id)
            .where(Market.id.in_(ids))
        ).all()
    ) if ids else {}  # fmt: skip
    for d in items:
        slug = slugs.get(d["market_id"])
        d["url"] = f"https://polymarket.com/event/{slug}" if slug else None
    return {"run": _run_dict(run), "items": items}


@app.get("/api/predict/quality")
def predict_quality(session: SessionDep) -> dict[str, Any]:
    """Métricas fuera de muestra del último backtest (por modelo y variante)."""
    from sqlalchemy import select

    from radar.db.models import ModelEvaluation

    run = _latest_prediction_run(session, "backtest")
    if run is None:
        return {"run": None, "items": [], "nota": "Información insuficiente: sin backtest"}
    rows = session.execute(
        select(ModelEvaluation)
        .where(ModelEvaluation.run_id == run.id)
        .order_by(ModelEvaluation.variant, ModelEvaluation.model)
    ).scalars()
    items = [
        {c.name: getattr(r, c.name) for c in r.__table__.columns if c.name != "created_at"}
        for r in rows
    ]
    return {"run": _run_dict(run), "items": items}


@app.get("/api/explain")
def explain(session: SessionDep) -> dict[str, Any]:
    """Por qué el radar apostó o no en la última corrida en vivo, en frases simples.

    Un mercado cuenta una vez: con su señal si la hubo, si no con el resultado de mayor
    diferencia a favor."""
    from collections import Counter

    from sqlalchemy import select

    from radar.db.models import ValuationRecord
    from radar.predict.explain import headline

    run = _latest_prediction_run(session, "live")
    if run is None:
        return {"run": None, "mercados": 0, "motivos": []}
    cols = [ValuationRecord.market_id, ValuationRecord.category, ValuationRecord.recommendation,
            ValuationRecord.reasons, ValuationRecord.edge_pp]  # fmt: skip
    best: dict[str, Any] = {}
    for r in session.execute(select(*cols).where(ValuationRecord.run_id == run.id)):
        cur = best.get(r.market_id)
        key = (r.recommendation == "señal_operable", r.edge_pp if r.edge_pp is not None else -1e9)
        if cur is None or key > cur[0]:
            best[r.market_id] = (key, r)
    reasons: Counter[str] = Counter()
    by_category: Counter[str] = Counter()
    for _key, r in best.values():
        reasons[headline(dict(r._mapping))] += 1
        by_category[r.category] += 1
    return {
        "run": _run_dict(run),
        "mercados": len(best),
        "por_categoria": dict(by_category),
        "motivos": [{"motivo": k, "mercados": n} for k, n in reasons.most_common()],
    }


@app.get("/api/paper")
def paper(session: SessionDep, limit: Annotated[int, Query(ge=1, le=2000)] = 500) -> dict[str, Any]:
    """Cartera de papel (``paper-v1``): posiciones simuladas abiertas por las señales."""
    from sqlalchemy import select

    from radar.db.models import Event, Market, PaperTrade
    from radar.predict.forward import PaperConfig

    cfg = PaperConfig()
    rows = session.execute(
        select(PaperTrade, Event.slug)
        .join(Market, Market.id == PaperTrade.market_id, isouter=True)
        .join(Event, Event.id == Market.event_id, isouter=True)
        .order_by(PaperTrade.opened_at.desc())
        .limit(limit)
    ).all()
    items = []
    for t, slug in rows:
        d = {c.name: getattr(t, c.name) for c in t.__table__.columns}
        for k in ("opened_at", "end_date", "resolved_at", "created_at", "v2_exit_at",
                  "v2_checked_until"):  # fmt: skip
            if d.get(k) is not None:
                d[k] = d[k].isoformat()
        d["url"] = f"https://polymarket.com/event/{slug}" if slug else None
        items.append(d)
    closed = [d for d in items if d["status"] != "abierta"]
    open_ = [d for d in items if d["status"] == "abierta"]
    both = [
        d for d in items if d["status"] != "abierta" and d.get("v2_status") not in (None, "abierta")
    ]

    def days(d: dict[str, Any], key: str) -> float:
        return (
            datetime.fromisoformat(d[key]) - datetime.fromisoformat(d["opened_at"])
        ).total_seconds() / 86400

    v2 = {
        "version": "paper-v2",
        "vendidas": sum(d.get("v2_status") == "vendida" for d in items),
        "cerradas": sum(d.get("v2_status") not in (None, "abierta") for d in items),
        "resultado_usd": sum(
            d.get("v2_pnl_usd") or 0.0 for d in items if d.get("v2_status") not in (None, "abierta")
        ),
        # comparación justa: solo posiciones cerradas en las dos carteras
        "comparables": len(both),
        "vendidas_comparables": sum(d.get("v2_status") == "vendida" for d in both),
        "resultado_v1_comparables_usd": sum(d["pnl_usd"] or 0.0 for d in both),
        "resultado_v2_comparables_usd": sum(d["v2_pnl_usd"] or 0.0 for d in both),
        "dias_v1_comparables": (sum(days(d, "resolved_at") for d in both) / len(both))
        if both
        else None,
        "dias_v2_comparables": (sum(days(d, "v2_exit_at") for d in both) / len(both))
        if both
        else None,
    }
    pnl = sum(d["pnl_usd"] or 0.0 for d in closed)
    cost_closed = sum(d["cost_usd"] for d in closed)
    exposure = sum(d["cost_usd"] for d in open_)
    return {
        "version": "paper-v1",
        "capital_inicial_usd": cfg.capital_usd,
        "exposicion_maxima_usd": cfg.max_exposure_usd,
        "abiertas": len(open_),
        "exposicion_usd": exposure,
        "cerradas": len(closed),
        "ganadas": sum(d["status"] == "ganada" for d in closed),
        "perdidas": sum(d["status"] == "perdida" for d in closed),
        "empates": sum(d["status"] == "empate" for d in closed),
        "resultado_usd": pnl,
        "invertido_cerradas_usd": cost_closed,
        "capital_actual_usd": cfg.capital_usd + pnl,
        "venta_anticipada": v2,
        "items": items,
    }


@app.get("/api/forward")
def forward_eval(session: SessionDep, settings: SettingsDep) -> dict[str, Any]:
    """Última evaluación en vivo (``forward-v1``) por modelo y tipo de contrato."""
    import json

    from sqlalchemy import select

    from radar.db.models import ModelEvaluation
    from radar.predict.service import calibration_path

    run = _latest_prediction_run(session, "forward")
    if run is None:
        return {"run": None, "items": [], "nota": "Información insuficiente: sin evaluación"}
    path = calibration_path(settings)
    reference = (json.loads(path.read_text()) if path.exists() else {}).get(
        "reference_by_variant"
    ) or {}
    rows = session.execute(
        select(ModelEvaluation)
        .where(ModelEvaluation.run_id == run.id)
        .order_by(ModelEvaluation.variant, ModelEvaluation.model)
    ).scalars()
    items = []
    for r in rows:
        d = {c.name: getattr(r, c.name) for c in r.__table__.columns if c.name != "created_at"}
        d["is_reference"] = r.model.startswith("ref-") or (
            r.model == f"cripto-{reference.get(r.variant) or 'rv'}"
        )
        items.append(d)
    return {"run": _run_dict(run), "items": items}


@app.get("/api/markets/{market_id}/predictions")
def market_predictions(
    market_id: str, session: SessionDep, limit: Annotated[int, Query(ge=1, le=500)] = 50
) -> list[dict[str, Any]]:
    from sqlalchemy import select

    from radar.db.models import PredictionRecord

    rows = session.execute(
        select(PredictionRecord)
        .where(PredictionRecord.market_id == market_id)
        .order_by(PredictionRecord.as_of.desc(), PredictionRecord.model)
        .limit(limit)
    ).scalars()
    out = []
    for r in rows:
        d = {c.name: getattr(r, c.name) for c in r.__table__.columns}
        d["as_of"] = r.as_of.isoformat()
        d["created_at"] = r.created_at.isoformat()
        out.append(d)
    return out
