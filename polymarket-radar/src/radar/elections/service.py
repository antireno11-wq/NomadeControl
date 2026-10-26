"""Orquestación del motor electoral para el CLI y la API.

Cada operación registra una fila en ``election_runs`` con su resumen. Los datos
crudos (revisiones de Wikipedia, respuestas de Polymarket) quedan en la caché de
``data/raw`` con su SHA-256; los manifiestos y reportes en ``data/`` y ``reports/``.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, delete, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from radar.config import Settings
from radar.db.models import (
    ElectionAlert,
    ElectionEstimate,
    ElectionMarket,
    ElectionRun,
    Event,
    Market,
)
from radar.elections.alerts import AlertLedger, verify_chain
from radar.elections.backtest import TokenSpec, outcome_metrics, run_backtest
from radar.elections.calibration import CalibrationBuild, calib_from_document
from radar.elections.contests import (
    BR_2026_R2,
    CONTESTS,
    HISTORICAL_BR_RUNOFFS,
    HISTORICAL_WORLD_RUNOFFS,
    Contest,
)
from radar.elections.discovery import RULES_VERSION, DiscoverySummary, classify
from radar.elections.engine import EngineConfig, Quote, build_estimates, consensus, evaluate
from radar.elections.evaluation import (
    aggregate,
    evaluate_contest_vs_market,
    load_market_event,
    walk_forward_calibration,
)
from radar.elections.fetch import evaluation_times, fetch_point_in_time, write_manifest
from radar.elections.market_history import PRICE_BASIS_ASK, MarketHistory, RawCache
from radar.elections.models import fit_error_model, validate_loo
from radar.elections.polls import parse_page
from radar.elections.sources.wikimedia import Revision, WikimediaClient, make_wikimedia_api
from radar.ingestion.http import ApiClient
from radar.ingestion.pipeline import build_clients
from radar.logging_setup import get_logger
from radar.market.orderbook import compute_metrics, normalize_book, simulate_buy
from radar.timeutil import utcnow

log = get_logger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
CALIBRATION_CONTESTS: tuple[Contest, ...] = (*HISTORICAL_BR_RUNOFFS, *HISTORICAL_WORLD_RUNOFFS)

# Mercados de ganador en Polymarket (era CLOB) por contienda.
MARKET_EVENTS: dict[str, str] = {
    "br-2026-presidente-2t": "brazil-presidential-election",
    "pl-2025-presidente-2t": "poland-presidential-election",
    "ro-2025-presidente-2t": "romania-presidential-election-winner",
    "ec-2025-presidente-2t": "ecuador-presidential-election",
    "cl-2025-presidente-2t": "chile-presidential-election",
}


def data_dir(settings: Settings) -> Path:
    return Path(getattr(settings, "data_dir", None) or PROJECT_ROOT / "data")


def wiki_client(settings: Settings, lang: str = "en") -> WikimediaClient:
    return WikimediaClient(
        make_wikimedia_api(lang), data_dir(settings) / "raw" / "wikimedia", lang=lang
    )


def market_history(settings: Settings) -> MarketHistory:
    clob = ApiClient(
        settings.clob_base_url, name="clob", rate_per_s=4, user_agent=settings.user_agent
    )
    data_api = ApiClient(
        "https://data-api.polymarket.com",
        name="data-api",
        rate_per_s=4,
        user_agent=settings.user_agent,
    )
    return MarketHistory(clob, data_api, RawCache(data_dir(settings) / "raw" / "polymarket"))


def _start_run(engine: Engine, kind: str, mode: str, contest_key: str | None) -> int:
    with engine.begin() as conn:
        return conn.execute(
            insert(ElectionRun)
            .values(
                kind=kind,
                mode=mode,
                contest_key=contest_key,
                started_at=utcnow(),
                status="running",
                summary={},
            )
            .returning(ElectionRun.id)
        ).scalar_one()


def _finish_run(engine: Engine, run_id: int, status: str, summary: dict[str, Any],
                report_path: str | None = None) -> None:  # fmt: skip
    with engine.begin() as conn:
        conn.execute(
            update(ElectionRun)
            .where(ElectionRun.id == run_id)
            .values(
                status=status,
                finished_at=utcnow(),
                summary=_jsonable(summary),
                report_path=report_path,
            )
        )


def _jsonable(obj: Any) -> Any:
    return json.loads(json.dumps(obj, default=str, ensure_ascii=False))


# ---------------------------------------------------------------- descubrimiento
def run_discovery(engine: Engine) -> tuple[int, dict[str, Any]]:
    run_id = _start_run(engine, "discover", "live", None)
    summary = DiscoverySummary()
    events: set[str | None] = set()
    rows = []
    now = utcnow()
    with engine.connect() as conn:
        data = conn.execute(
            select(
                Market.id,
                Market.question,
                Market.group_item_title,
                Market.event_id,
                Event.title,
                Event.slug,
                Event.category,
            )
            .outerjoin(Event, Event.id == Market.event_id)
            .where(Market.closed.is_(False), Market.eligible.is_(True))
        ).all()
    for r in data:
        summary.scanned += 1
        cl = classify(r.question, r.title, r.group_item_title, r.slug, r.category)
        if not cl.electoral:
            continue
        summary.electoral += 1
        events.add(r.event_id)
        summary.by_type[cl.market_type] += 1
        summary.by_office[cl.office] += 1
        summary.by_country[cl.country] += 1
        if cl.contest_key:
            summary.linked_to_contest += 1
        if cl.coverage == "modelado":
            summary.modeled += 1
        else:
            summary.abstain_reasons[cl.abstain_reason or ""] += 1
        rows.append(
            {
                "market_id": r.id,
                "event_id": r.event_id,
                "market_type": cl.market_type,
                "office": cl.office,
                "country": cl.country,
                "year": cl.year,
                "round": cl.round,
                "candidate": cl.candidate,
                "contest_key": cl.contest_key,
                "coverage": cl.coverage,
                "abstain_reason": cl.abstain_reason,
                "rules_version": RULES_VERSION,
                "classified_at": now,
                "run_id": run_id,
            }
        )
    summary.events = len(events)
    with engine.begin() as conn:
        conn.execute(delete(ElectionMarket))
        for i in range(0, len(rows), 1000):
            conn.execute(pg_insert(ElectionMarket).values(rows[i : i + 1000]))
    result = summary.to_dict()
    _finish_run(engine, run_id, "success", result)
    return run_id, result


# ---------------------------------------------------------------- calibración
def _calibration_manifest(settings: Settings) -> Path:
    return data_dir(settings) / "manifests" / "calibration_revisions.json"


def build_calibration(settings: Settings, *, refresh: bool = False) -> CalibrationBuild:
    """Conjunto de calibración. Usa las revisiones fijadas en el manifiesto (reproducible);
    con ``refresh=True`` consulta la última revisión de cada página y actualiza el manifiesto."""
    client = wiki_client(settings)
    manifest_path = _calibration_manifest(settings)
    pinned: dict[str, dict[str, Any]] = {}
    if manifest_path.exists() and not refresh:
        pinned = json.loads(manifest_path.read_text(encoding="utf-8"))
    out = CalibrationBuild()
    new_manifest: dict[str, dict[str, Any]] = {}
    for c in CALIBRATION_CONTESTS:
        try:
            if c.key in pinned:
                rev = Revision(
                    int(pinned[c.key]["revid"]),
                    datetime.fromisoformat(pinned[c.key]["revision_ts"]),
                )
            else:
                rev = client.latest_revision(c.poll_source.title)
            doc = client.revision_html(c.poll_source.title, rev)
        except Exception as exc:
            out.issues.append(f"{c.key}: no se pudo descargar ({exc})"[:300])
            continue
        new_manifest[c.key] = {
            "title": c.poll_source.title,
            "revid": rev.revid,
            "revision_ts": rev.timestamp.isoformat(),
            "sha256": doc.sha256,
        }
        calib, issues, prov = calib_from_document(c, doc)
        out.issues.extend(issues)
        out.provenance.append(prov)
        if calib is not None:
            out.contests.append(calib)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(new_manifest, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return out


# ---------------------------------------------------------------- backtest Brasil
def br2026_tokens(engine: Engine) -> list[TokenSpec]:
    q = text(
        "select m.id, m.condition_id, m.group_item_title, t.token_id, t.outcome_index, "
        "m.fee_schedule from markets m join tokens t on t.market_id = m.id "
        "join election_markets em on em.market_id = m.id "
        "where em.contest_key = :k and em.coverage = 'modelado' order by m.id, t.outcome_index"
    )
    specs: list[TokenSpec] = []
    with engine.connect() as conn:
        for r in conn.execute(q, {"k": BR_2026_R2.key}):
            cand = "a" if BR_2026_R2.candidate_a.matches(r.group_item_title) else "b"
            name = BR_2026_R2.candidate_a.name if cand == "a" else BR_2026_R2.candidate_b.name
            outcome = "YES" if r.outcome_index == 0 else "NO"
            fee = r.fee_schedule or {}
            specs.append(
                TokenSpec(
                    r.id,
                    r.condition_id,
                    r.token_id,
                    f"{name} {outcome}",
                    cand,
                    outcome,
                    fee.get("rate"),
                    fee.get("exponent"),
                )
            )
    return specs


def run_br2026_backtest(engine: Engine, settings: Settings, out_dir: Path) -> dict[str, Any]:
    contest = BR_2026_R2
    run_id = _start_run(engine, "backtest", "backtest_retrospectivo", contest.key)
    client = wiki_client(settings)
    times = evaluation_times(contest)
    docs = fetch_point_in_time(client, contest, times)
    write_manifest(data_dir(settings) / "manifests" / f"{contest.key}.json", contest, docs)
    calib = build_calibration(settings)
    # Solo contiendas anteriores a 2026 calibran el backtest (walk-forward).
    prior = [c for c in calib.contests if CONTESTS[c.key].election_date < contest.election_date]
    validation = validate_loo(prior, "weighted")
    tokens = br2026_tokens(engine)
    if not tokens:
        raise RuntimeError("no hay mercados modelados: ejecute 'radar elections discover'")
    ledger_path = data_dir(settings) / "alerts" / f"backtest_{contest.key}.jsonl"
    if ledger_path.exists():
        ledger_path.unlink()  # el ledger retrospectivo se regenera completo en cada corrida
    ledger = AlertLedger(ledger_path)
    history = market_history(settings)
    result = run_backtest(
        contest,
        [(d.t, d.document) for d in docs],
        prior,
        validation,
        tokens,
        history,
        ledger=ledger,
    )
    # Resultado: última revisión (posterior al cierre) y estado de resolución en Gamma.
    latest_rev = client.latest_revision(contest.poll_source.title)
    latest = client.revision_html(contest.poll_source.title, latest_rev)
    post = parse_page(latest.html, contest)
    valid = [r for r in post.results if r.basis == "valid_votes"]
    gamma = ApiClient(
        settings.gamma_base_url, name="gamma", rate_per_s=4, user_agent=settings.user_agent
    )
    event = load_market_event(gamma, "brazil-presidential-election", contest)
    winner_wiki = None if not valid else ("a" if valid[0].two_party_a > 0.5 else "b")
    result["resultado"] = {
        "wikipedia": {
            **latest.provenance(),
            "a": valid[0].share_a if valid else None,
            "b": valid[0].share_b if valid else None,
            "base": "votos válidos" if valid else None,
        },
        "polymarket": {
            "slug": event.slug,
            "mercados": event.raw_markets,
            "ganador": event.winner_candidate,
            "nota": event.resolution_note,
        },
        "ganador": winner_wiki if winner_wiki == event.winner_candidate else None,
        "concordancia_fuentes": winner_wiki == event.winner_candidate,
    }
    if result["resultado"]["ganador"] is not None:
        result["metricas_resultado"] = outcome_metrics(
            result, result["resultado"]["ganador"] == "a"
        )
    result["calibracion_fuentes"] = calib.provenance
    result["calibracion_problemas"] = calib.issues
    result["ledger"] = {
        "ruta": str(ledger_path.relative_to(PROJECT_ROOT)),
        "alertas": len(ledger.records()),
        "cadena_integra": not verify_chain(ledger.records()),
    }
    _persist_backtest(engine, run_id, result, ledger)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"backtest_{contest.key}.json"
    json_path.write_text(
        json.dumps(_jsonable(result), ensure_ascii=False, indent=1), encoding="utf-8"
    )
    from radar.elections.report import backtest_markdown

    md_path = out_dir / f"backtest_{contest.key}.md"
    md_path.write_text(backtest_markdown(result), encoding="utf-8")
    _finish_run(engine, run_id, "success", summarize_backtest(result), str(md_path))
    return result


def summarize_backtest(result: dict[str, Any]) -> dict[str, Any]:
    tl = result["timeline"]
    first = result.get("primera_alerta")
    return {
        "instantes": len(tl),
        "instantes_con_alerta": sum(1 for p in tl if p.get("alerta")),
        "instantes_con_senal_operable": sum(1 for p in tl if p.get("senal_operable")),
        "primera_alerta": {
            "t": first["t"],
            "token": first["decision"]["quote"]["label"],
            "base": first["decision"]["quote"]["basis"],
            "precio": first["decision"]["quote"]["price"],
            "discrepancia_pp": first["decision"]["discrepancy_pp"],
        }
        if first
        else None,
        "validacion": result["validacion"]["status"],
        "ganador": (result.get("resultado") or {}).get("ganador"),
        "metricas": {
            k: (result.get("metricas_resultado") or {}).get(k)
            for k in ("brier_medio_modelo", "brier_medio_mercado")
        },
    }


def _persist_backtest(
    engine: Engine, run_id: int, result: dict[str, Any], ledger: AlertLedger
) -> None:
    est_rows = []
    for p in result["timeline"]:
        for e in p.get("estimaciones") or []:
            est_rows.append(
                {
                    "run_id": run_id,
                    "mode": "backtest_retrospectivo",
                    "contest_key": result["contest"],
                    "as_of": datetime.fromisoformat(p["t"]),
                    "name": e["name"],
                    "family": e["family"],
                    "status": e["status"],
                    "prob_a": e["prob_a"],
                    "prob_a_low": e["prob_a_low"],
                    "prob_a_high": e["prob_a_high"],
                    "vote_share_a": e["vote_share_a"],
                    "sigma": e["sigma"],
                    "horizon_days": e["horizon_days"],
                    "model_version": e["model_version"],
                    "calibration": e["calibration"],
                    "inputs": _jsonable(e["inputs"]),
                    "abstain_reason": e["abstain_reason"],
                }
            )
    alert_rows = []
    for rec in ledger.records():
        d = rec.payload["decision"]
        q = d["quote"]
        alert_rows.append(
            {
                "run_id": run_id,
                "mode": rec.mode,
                "kind": rec.kind,
                "contest_key": result["contest"],
                "market_id": q["market_id"],
                "token_id": q["token_id"],
                "label": q["label"],
                "as_of": datetime.fromisoformat(rec.payload["as_of"]),
                "created_at": datetime.fromisoformat(rec.created_at),
                "price": q["price"],
                "price_basis": q["basis"],
                "reference_prob": d["reference_prob"],
                "discrepancy_pp": d["discrepancy_pp"],
                "conservative_edge_pp": d["conservative_edge_pp"],
                "signal": d["signal"],
                "gating": d["gating"],
                "ledger_path": str(ledger.path),
                "ledger_seq": rec.seq,
                "sha256": rec.sha256,
                "prev_sha256": rec.prev_sha256,
            }
        )
    with engine.begin() as conn:
        conn.execute(delete(ElectionAlert).where(ElectionAlert.mode == "backtest_retrospectivo"))
        for i in range(0, len(est_rows), 500):
            conn.execute(insert(ElectionEstimate), est_rows[i : i + 500])
        if alert_rows:
            conn.execute(insert(ElectionAlert), alert_rows)


# ---------------------------------------------------------------- evaluación múltiple
def run_world_evaluation(engine: Engine, settings: Settings, out_dir: Path) -> dict[str, Any]:
    run_id = _start_run(engine, "evaluate", "backtest_retrospectivo", None)
    calib = build_calibration(settings)
    validation_all = validate_loo(calib.contests, "weighted")
    validation_all_median = validate_loo(calib.contests, "median")
    history = market_history(settings)
    gamma = ApiClient(
        settings.gamma_base_url, name="gamma", rate_per_s=4, user_agent=settings.user_agent
    )
    client = wiki_client(settings)
    results = []
    for key, slug in MARKET_EVENTS.items():
        contest = CONTESTS[key]
        try:
            rev = client.latest_revision(contest.poll_source.title)
            doc = client.revision_html(contest.poll_source.title, rev)
        except Exception as exc:
            results.append({"contest": key, "abstencion": f"sin página de encuestas ({exc})"[:300]})
            continue
        parsed = parse_page(doc.html, contest)
        prior = walk_forward_calibration(contest, calib.contests, CONTESTS)
        val_prior = (
            validate_loo(prior, "weighted") if len(prior) >= 2 else validate_loo([], "weighted")
        )
        event = load_market_event(gamma, slug, contest)
        r = evaluate_contest_vs_market(contest, parsed, prior, val_prior, event, history)
        r["revision_encuestas"] = doc.provenance()
        r["nota_disponibilidad"] = (
            "revisiones exactas en el backtest específico"
            if key == BR_2026_R2.key
            else "disponibilidad estimada: fin de campo + 2 días (página posterior a la elección)"
        )
        results.append(r)
    out = {
        "creado": utcnow().isoformat(),
        "calibracion": {
            "contiendas": [c.key for c in calib.contests],
            "problemas": calib.issues,
            "fuentes": calib.provenance,
        },
        "validacion_loo_ponderado": asdict(validation_all),
        "validacion_loo_mediana": asdict(validation_all_median),
        "comparacion_mercado": results,
        "agregado": aggregate(results),
        "fuentes_mercado": history.sources,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "evaluacion_multielecciones.json"
    json_path.write_text(json.dumps(_jsonable(out), ensure_ascii=False, indent=1), encoding="utf-8")
    from radar.elections.report import evaluation_markdown

    md_path = out_dir / "evaluacion_multielecciones.md"
    md_path.write_text(evaluation_markdown(out), encoding="utf-8")
    _finish_run(
        engine,
        run_id,
        "success",
        out["agregado"]
        | {"validacion": validation_all.status, "n_calibracion": len(calib.contests)},
        str(md_path),
    )
    return out


# ---------------------------------------------------------------- escaneo en vivo
def live_quotes_from_books(
    tokens: list[TokenSpec],
    books: dict[str, Any],
    now: datetime,
    size_usd: float,
) -> list[Quote]:
    """Cotizaciones con ask ejecutable a partir de libros del CLOB recién descargados."""
    quotes: list[Quote] = []
    for spec in tokens:
        entry = books.get(spec.token_id)
        if entry is None:
            quotes.append(
                Quote(
                    spec.market_id,
                    spec.token_id,
                    spec.label,
                    spec.candidate,
                    spec.outcome,
                    PRICE_BASIS_ASK,
                    None,
                    None,
                )
            )
            continue
        book, received_at = entry
        bids, asks = normalize_book(book.bids, book.asks)
        metrics = compute_metrics(bids, asks, band=0.02)
        fill = simulate_buy(asks, notional_usd=size_usd)
        observed = book.source_ts or received_at
        quotes.append(
            Quote(
                market_id=spec.market_id,
                token_id=spec.token_id,
                label=spec.label,
                candidate=spec.candidate,
                outcome=spec.outcome,
                basis=PRICE_BASIS_ASK,
                price=metrics.best_ask,
                observed_at=observed,
                vwap_for_size=fill.avg_price,
                fill_complete=fill.fully_filled,
                spread=metrics.spread,
                book_age_s=(now - observed).total_seconds(),
                fee_rate=spec.fee_rate,
                fee_exponent=spec.fee_exponent,
                evidence={
                    "book_hash": book.hash,
                    "asks_top": [{"price": lv.price, "size": lv.size} for lv in asks[:10]],
                    "bids_top": [{"price": lv.price, "size": lv.size} for lv in bids[:10]],
                },
            )
        )
    return quotes


def scan_contest(
    contest: Contest,
    now: datetime,
    *,
    doc: Any,
    tokens: list[TokenSpec],
    books: dict[str, Any],
    calibration: list[Any],
    ledger: AlertLedger,
    cfg: EngineConfig | None = None,
) -> dict[str, Any]:
    """Un escaneo en vivo: estimaciones, cotizaciones ejecutables, decisiones y alertas.

    Las alertas se congelan en el ledger en vivo ANTES de conocerse el resultado
    (solo se ejecuta con urnas abiertas)."""
    cfg = cfg or EngineConfig()
    if now >= contest.polls_close_utc:
        return {"contest": contest.key, "abstencion": "urnas cerradas: no se generan alertas"}
    if contest.defined_from_utc and now < contest.defined_from_utc:
        return {"contest": contest.key, "abstencion": "contienda aún no definida"}
    parsed = parse_page(doc.html, contest)
    if parsed.results:
        return {"contest": contest.key, "abstencion": "la fuente ya publica un resultado"}
    models = {m: fit_error_model(calibration, m) for m in ("weighted", "median")}
    validation = validate_loo(calibration, "weighted")
    polls = [p for p in parsed.polls if p.fieldwork_end <= now.date()]
    aggs = [a for a in parsed.aggregators if a.last_update and a.last_update <= now.date()]
    estimates = build_estimates(contest, polls, aggs, now, models)
    quotes = live_quotes_from_books(tokens, books, now, cfg.order_size_usd)
    decisions = evaluate(contest, estimates, quotes, validation, now, cfg)
    alerts = []
    for d in decisions:
        if not d.alert:
            continue
        rec = ledger.append(
            mode="live",
            kind="senal_operable" if d.signal else "investigacion",
            payload={
                "contest": contest.key,
                "as_of": now.isoformat(),
                "decision": d.to_dict(),
                "estimaciones": [asdict(e) for e in estimates],
                "consenso": asdict(consensus(estimates)),
                "revision_wikipedia": doc.provenance(),
                "validacion": {"status": validation.status, "motivos": validation.reasons},
                "cierre_urnas_utc": contest.polls_close_utc.isoformat(),
            },
            created_at=now,
        )
        alerts.append(
            {
                "seq": rec.seq,
                "sha256": rec.sha256,
                "token": d.quote.label,
                "senal_operable": d.signal,
            }
        )
    return {
        "contest": contest.key,
        "estimaciones": len([e for e in estimates if e.status == "ok"]),
        "consenso": asdict(consensus(estimates)),
        "decisiones": [d.to_dict() for d in decisions],
        "alertas": alerts,
        "validacion": validation.status,
    }


def run_live_scan(engine: Engine, settings: Settings) -> dict[str, Any]:
    """Escanea las contiendas configuradas no históricas con datos en vivo."""
    now = utcnow()
    summary: dict[str, Any] = {"t": now.isoformat(), "contiendas": []}
    run_id = _start_run(engine, "scan", "live", None)
    ledger = AlertLedger(latest_alert_ledger(settings, live=True))
    calibration: list[Any] | None = None
    for c in CONTESTS.values():
        if c.historical:
            continue
        if now >= c.polls_close_utc or (c.defined_from_utc and now < c.defined_from_utc):
            summary["contiendas"].append(
                scan_contest(c, now, doc=None, tokens=[], books={}, calibration=[], ledger=ledger)
            )
            continue
        if calibration is None:
            calibration = [
                x
                for x in build_calibration(settings).contests
                if CONTESTS[x.key].election_date < c.election_date
            ]
        client = wiki_client(settings)
        rev = client.latest_revision(c.poll_source.title)
        doc = client.revision_html(c.poll_source.title, rev)
        tokens = br2026_tokens(engine) if c.key == BR_2026_R2.key else []
        _, clob, close = build_clients(settings)
        try:
            books = clob.fetch_books([t.token_id for t in tokens]).books
        finally:
            close()
        summary["contiendas"].append(
            scan_contest(
                c, now, doc=doc, tokens=tokens, books=books, calibration=calibration, ledger=ledger
            )
        )
    _finish_run(engine, run_id, "success", summary)
    return summary


def latest_alert_ledger(settings: Settings, live: bool = True) -> Path:
    name = "live.jsonl" if live else f"backtest_{BR_2026_R2.key}.jsonl"
    return data_dir(settings) / "alerts" / name
