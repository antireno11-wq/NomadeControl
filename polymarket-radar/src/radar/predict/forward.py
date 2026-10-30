"""Evaluación en vivo (``forward-v1``) y cartera de papel (``paper-v1``).

Reglas en ``docs/PREREGISTRO_VIVO.md``. Después de cada corrida en vivo:

1. ``capture``: las predicciones que caen en un momento preregistrado antes de la
   resolución se copian a ``forward_instances`` (con el punto medio del libro de esa tanda);
2. ``open_paper``: cada señal operable nueva abre una posición simulada, si cabe en la
   exposición máxima;
3. ``resolve``: con la resolución oficial de Polymarket se completa ``y`` y se cierran las
   posiciones;
4. ``evaluate``: métricas por modelo y variante contra el resultado y contra el mercado; un
   par peor que el mercado queda suspendido para las señales.

Todo es simulado: no hay órdenes reales.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from radar.config import Settings
from radar.logging_setup import get_logger
from radar.predict import metrics as MX
from radar.predict.base import CALIB_NOT_VALIDATED, CALIB_VALIDATED
from radar.predict.crypto.backtest import CRITERIA
from radar.predict.crypto.schedule import OFFSETS as CRYPTO_OFFSETS
from radar.predict.external import OFFSETS_EXTERNAL
from radar.timeutil import utcnow

log = get_logger(__name__)

FORWARD_VERSION = "forward-v1"
PAPER_VERSION = "paper-v1"
WINDOW_MIN = 40.0  # una predicción sirve al momento d si 0 ≤ (R − d) − as_of ≤ 40 min
MIN_VS_MARKET = 30  # instancias con precio para comparar con el mercado (igual que el backtest)
ET = ZoneInfo("America/New_York")
RESOLVE_GRACE = timedelta(minutes=5)
GAMMA_BATCH = 50
GAMMA_MAX_BATCHES = 20
OFFSETS = {**CRYPTO_OFFSETS, **OFFSETS_EXTERNAL}
ENABLE_GAP = timedelta(days=7)  # familias nuevas: dos evaluaciones que pasan, separadas 7 días


@dataclass(frozen=True)
class PaperConfig:
    capital_usd: float = 1000.0
    reserve_usd: float = 700.0
    max_exposure_usd: float = 300.0


# ----------------------------------------------------------------- 1. instancias


def instance_moments(variant: str, tau_min: float) -> list[tuple[int, float]]:
    """Momentos d (min) a los que sirve una predicción hecha ``tau_min`` antes de R."""
    out = []
    for off in OFFSETS.get(variant, ()):
        d = off.total_seconds() / 60
        gap = tau_min - d
        if 0 <= gap <= WINDOW_MIN:
            out.append((round(d), gap))
    return out


def capture(engine: Any, run_ids: list[int] | None = None) -> dict[str, int]:
    """Copia a ``forward_instances`` las predicciones que sirven a algún momento.

    Sin ``run_ids`` procesa las corridas en vivo exitosas posteriores a la última ya
    capturada. Es idempotente: ante dos predicciones para el mismo momento queda la más
    cercana a él (la última antes de R − d)."""
    from sqlalchemy import func, select, text
    from sqlalchemy.dialects.postgresql import insert

    from radar.db.models import ForwardInstance, PredictionRun

    with engine.connect() as conn:
        if run_ids is None:
            last = conn.execute(select(func.max(ForwardInstance.run_id))).scalar() or 0
            run_ids = list(
                conn.execute(
                    select(PredictionRun.id)
                    .where(PredictionRun.kind == "live", PredictionRun.status == "success")
                    .where(PredictionRun.id >= last)
                    .order_by(PredictionRun.id)
                ).scalars()
            )
    n_rows = 0
    q = text(
        """
        select p.id, p.run_id, p.market_id, p.model, p.family, p.outcome, p.as_of,
               p.probability, p.details->'terms'->>'variant' as variant,
               p.details->'terms'->>'asset' as asset, (p.details->>'tau_min')::float as tau,
               p.details->'features' as features, v.p_market_mid
        from predictions p
        left join valuations v
          on v.run_id = p.run_id and v.market_id = p.market_id and v.outcome = p.outcome
        where p.run_id = :r and p.probability is not null
        """
    )
    for run_id in run_ids:
        rows: dict[tuple[str, str, int], dict[str, Any]] = {}
        with engine.connect() as conn:
            for r in conn.execute(q, {"r": run_id}).mappings():
                if r["tau"] is None or not r["variant"]:
                    continue
                res_t = r["as_of"] + timedelta(minutes=r["tau"])
                day = res_t.astimezone(ET).date().isoformat()
                for d, gap in instance_moments(r["variant"], r["tau"]):
                    key = (r["market_id"], r["model"], d)
                    if key in rows and rows[key]["gap_min"] <= gap:
                        continue
                    rows[key] = {
                        "market_id": r["market_id"],
                        "model": r["model"],
                        "family": r["family"],
                        "variant": r["variant"],
                        "moment_min": d,
                        "gap_min": gap,
                        "prediction_id": r["id"],
                        "run_id": run_id,
                        "outcome": r["outcome"],
                        "as_of": r["as_of"],
                        "resolution_time": res_t,
                        "cluster": f"{r['asset']}|{day}",
                        "p_model": r["probability"],
                        "p_market": r["p_market_mid"],
                        "features": r["features"],
                    }
        if not rows:
            continue
        stmt = insert(ForwardInstance).values(list(rows.values()))
        cols = ("gap_min", "prediction_id", "run_id", "as_of", "p_model", "p_market", "features")
        stmt = stmt.on_conflict_do_update(
            constraint="uq_forward_market_model_moment",
            set_={c: stmt.excluded[c] for c in cols},
            where=stmt.excluded.gap_min < ForwardInstance.gap_min,
        )
        with engine.begin() as conn:
            conn.execute(stmt)
        n_rows += len(rows)
    return {"corridas": len(run_ids), "instancias_vistas": n_rows}


# --------------------------------------------------------------- 2. cartera de papel


def open_paper(engine: Any, cfg: PaperConfig | None = None) -> dict[str, int]:
    """Abre una posición por cada señal operable nueva (mercado y resultado), en orden
    cronológico, si cabe en la exposición y en el capital disponible."""
    from sqlalchemy import select, update
    from sqlalchemy.dialects.postgresql import insert

    from radar.db.models import PaperTrade, ValuationRecord
    from radar.predict.valuation import REC_SIGNAL

    cfg = cfg or PaperConfig()
    with engine.connect() as conn:
        trades = [dict(r._mapping) for r in conn.execute(select(PaperTrade.__table__))]
        signals = conn.execute(
            select(ValuationRecord.__table__)
            .where(ValuationRecord.recommendation == REC_SIGNAL)
            .order_by(ValuationRecord.as_of, ValuationRecord.id)
        ).all()
    held = {(t["market_id"], t["token_id"]) for t in trades}
    opened = omitted = 0
    new_rows: list[dict[str, Any]] = []
    for v in signals:
        if (v.market_id, v.token_id) in held:
            continue
        held.add((v.market_id, v.token_id))
        if not v.fill_shares or v.ask_vwap is None:
            continue
        shares = float(v.fill_shares)
        fee = float(v.fee_per_share or 0.0)
        cost = shares * (float(v.ask_vwap) + fee)
        t = v.as_of
        book = trades + new_rows
        exposure = sum(
            x["cost_usd"] for x in book
            if x["opened_at"] <= t and (x["end_date"] is None or x["end_date"] > t)
        )  # fmt: skip
        realized = sum(
            x["pnl_usd"] for x in book
            if x["pnl_usd"] is not None and x["resolved_at"] is not None
            and x["resolved_at"] <= t
        )  # fmt: skip
        room = min(cfg.max_exposure_usd, cfg.capital_usd + realized - cfg.reserve_usd)
        if exposure + cost > room + 1e-9:
            omitted += 1
            continue
        new_rows.append(
            {
                "version": PAPER_VERSION,
                "valuation_id": v.id,
                "run_id": v.run_id,
                "market_id": v.market_id,
                "token_id": v.token_id,
                "outcome": v.outcome,
                "question": v.question,
                "category": v.category,
                "variant": v.variant,
                "model": v.model,
                "opened_at": t,
                "end_date": v.end_date,
                "p_model": v.p_model,
                "entry_price": float(v.ask_vwap),
                "fee_per_share": fee,
                "shares": shares,
                "cost_usd": cost,
                "ev_net_usd": v.ev_net_usd,
                "status": "abierta",
                "final_price": None,
                "payout_usd": None,
                "pnl_usd": None,
                "resolved_at": None,
                "created_at": utcnow(),
                "v2_status": "abierta",
            }
        )
        opened += 1
    with engine.begin() as conn:
        if new_rows:
            conn.execute(insert(PaperTrade).values(new_rows).on_conflict_do_nothing())
        # Posiciones creadas sin paper-v2 (p. ej. por un proceso con código anterior):
        # parten igual que en paper-v1.
        conn.execute(
            update(PaperTrade)
            .where(PaperTrade.v2_status.is_(None))
            .values(
                v2_status=PaperTrade.status,
                v2_exit_at=PaperTrade.resolved_at,
                v2_exit_price=PaperTrade.final_price,
                v2_payout_usd=PaperTrade.payout_usd,
                v2_pnl_usd=PaperTrade.pnl_usd,
            )
        )
    return {"abiertas": opened, "omitidas_por_exposicion": omitted}


# --------------------------------------------------------- 2b. venta anticipada


def open_positions(engine: Any) -> dict[str, float]:
    """Tokens con una posición abierta en ``paper-v2`` → acciones (para cotizar su venta)."""
    from sqlalchemy import select

    from radar.db.models import PaperTrade

    with engine.connect() as conn:
        rows = conn.execute(
            select(PaperTrade.token_id, PaperTrade.shares).where(PaperTrade.v2_status == "abierta")
        ).all()
    return {tok: float(sh) for tok, sh in rows}


def should_sell(q: Any, max_book_age_s: float) -> bool:
    """Regla de ``paper-v2``: alguien paga por la posición (VWAP de venta menos comisión) lo
    mismo o más de lo que el radar cree que vale, con el libro fresco y completo."""
    return (
        bool(q.sell_complete)
        and q.sell_vwap is not None
        and q.sell_fee_per_share is not None
        and q.p_model is not None
        and q.book_age_s is not None
        and q.book_age_s <= max_book_age_s
        and q.sell_vwap - q.sell_fee_per_share >= q.p_model
    )


def sell_early(engine: Any) -> dict[str, int]:
    """Revisa en orden los precios de venta guardados desde la última revisión de cada
    posición abierta de ``paper-v2`` y la vende en el primero que cumple la regla."""
    from sqlalchemy import select, update

    from radar.db.models import PaperTrade, ValuationRecord
    from radar.predict.valuation import ValuationConfig

    max_age = ValuationConfig().max_book_age_s
    v = ValuationRecord
    sold = checked = 0
    with engine.begin() as conn:
        trades = conn.execute(
            select(PaperTrade.__table__).where(PaperTrade.v2_status == "abierta")
        ).all()
        for t in trades:
            since = t.v2_checked_until or t.opened_at
            quotes = conn.execute(
                select(v.as_of, v.p_model, v.sell_vwap, v.sell_fee_per_share, v.sell_complete,
                       v.book_age_s)
                .where(v.token_id == t.token_id, v.as_of > since, v.sell_vwap.is_not(None))
                .order_by(v.as_of)
            ).all()  # fmt: skip
            values: dict[str, Any] = {}
            for q in quotes:
                checked += 1
                values["v2_checked_until"] = q.as_of
                if should_sell(q, max_age):
                    payout = t.shares * (q.sell_vwap - q.sell_fee_per_share)
                    values |= {
                        "v2_status": "vendida",
                        "v2_exit_at": q.as_of,
                        "v2_exit_price": q.sell_vwap,
                        "v2_exit_fee": q.sell_fee_per_share,
                        "v2_payout_usd": payout,
                        "v2_pnl_usd": payout - t.cost_usd,
                    }
                    sold += 1
                    break
            if values:
                conn.execute(update(PaperTrade).where(PaperTrade.id == t.id).values(**values))
    return {"vendidas": sold, "precios_revisados": checked}


# ------------------------------------------------------------------ 3. resolución


def final_prices(outcome_prices: list[Any] | None, uma_status: str | None) -> list[float] | None:
    """Precios finales oficiales (1/0 o 0,5/0,5) o None si todavía no hay resolución."""
    if (uma_status or "").lower() != "resolved" or not outcome_prices:
        return None
    try:
        ps = [float(x) for x in outcome_prices]
    except (TypeError, ValueError):
        return None
    if any(p not in (0.0, 0.5, 1.0) for p in ps) or not math.isclose(sum(ps), 1.0):
        return None
    return ps


def resolve(engine: Any, settings: Settings | None = None, now: datetime | None = None) -> dict:
    """Completa ``y`` de las instancias y cierra las posiciones cuyos mercados ya se
    resolvieron. Usa la base; los que falten se consultan a Gamma por id."""
    from sqlalchemy import select, update

    from radar.db.models import ForwardInstance, Market, PaperTrade

    now = now or utcnow()
    cutoff = now - RESOLVE_GRACE
    with engine.connect() as conn:
        pending = set(
            conn.execute(
                select(ForwardInstance.market_id)
                .where(ForwardInstance.y.is_(None), ForwardInstance.resolution_time < cutoff)
                .distinct()
            ).scalars()
        )
        pending |= set(
            conn.execute(
                select(PaperTrade.market_id).where(
                    PaperTrade.status == "abierta", PaperTrade.end_date < cutoff
                )
            ).scalars()
        )
        known: dict[str, tuple[list[str], list[float]]] = {}
        for mid, outcomes, prices, uma in conn.execute(
            select(
                Market.id, Market.outcomes, Market.gamma_outcome_prices,
                Market.uma_resolution_status,
            ).where(Market.id.in_(pending), Market.closed.is_(True))
        ):  # fmt: skip
            fp = final_prices(prices, uma)
            if fp is not None:
                known[mid] = (list(outcomes or []), fp)
    asked = 0
    missing = sorted(pending - set(known))
    if missing and settings is not None:
        from radar.ingestion import gamma as gamma_mod
        from radar.ingestion.pipeline import build_clients

        gamma, _clob, close = build_clients(settings)
        try:
            for i in range(0, min(len(missing), GAMMA_BATCH * GAMMA_MAX_BATCHES), GAMMA_BATCH):
                batch = missing[i : i + GAMMA_BATCH]
                try:
                    raws, _received = gamma.fetch_markets_by_ids(batch)
                except Exception as exc:  # se reintenta en la próxima corrida
                    log.warning("forward_resolve_gamma_failed", error=repr(exc))
                    break
                asked += len(batch)
                for m, _raw in gamma_mod.parse_markets(raws).valid:
                    fp = final_prices(m.outcome_prices, m.uma_resolution_status)
                    if m.closed and fp is not None:
                        known[m.id] = (list(m.outcomes), fp)
        finally:
            close()
    n_inst = n_paper = 0
    with engine.begin() as conn:
        for mid, (outcomes, fp) in known.items():
            for i, outcome in enumerate(outcomes):
                if i >= len(fp):
                    break
                n_inst += conn.execute(
                    update(ForwardInstance)
                    .where(
                        ForwardInstance.market_id == mid,
                        ForwardInstance.outcome == outcome,
                        ForwardInstance.y.is_(None),
                    )
                    .values(y=fp[i], resolved_at=now)
                ).rowcount
                for tr in conn.execute(
                    select(PaperTrade.__table__).where(
                        PaperTrade.market_id == mid,
                        PaperTrade.outcome == outcome,
                        PaperTrade.status == "abierta",
                    )
                ).all():
                    payout = tr.shares * fp[i]
                    status = "ganada" if fp[i] == 1.0 else "perdida" if fp[i] == 0.0 else "empate"
                    values: dict[str, Any] = {
                        "status": status,
                        "final_price": fp[i],
                        "payout_usd": payout,
                        "pnl_usd": payout - tr.cost_usd,
                        "resolved_at": now,
                    }
                    if tr.v2_status == "abierta":  # paper-v2 no la vendió: termina igual
                        values |= {
                            "v2_status": status,
                            "v2_exit_at": now,
                            "v2_exit_price": fp[i],
                            "v2_payout_usd": payout,
                            "v2_pnl_usd": payout - tr.cost_usd,
                        }
                    conn.execute(update(PaperTrade).where(PaperTrade.id == tr.id).values(**values))
                    n_paper += 1
    return {
        "mercados_pendientes": len(pending),
        "resueltos": len(known),
        "consultados_a_gamma": asked,
        "instancias_completadas": n_inst,
        "posiciones_cerradas": n_paper,
    }


# ------------------------------------------------------------------- 4. evaluación


def evaluate(engine: Any, *, n_boot: int = 500) -> dict[str, Any]:
    """Métricas en vivo por modelo y variante; se guardan en ``model_evaluations``."""
    from sqlalchemy import insert, select

    from radar.db.models import ForwardInstance, ModelEvaluation
    from radar.predict.service import finish_run, start_run

    with engine.connect() as conn:
        rows = conn.execute(
            select(
                ForwardInstance.prediction_id, ForwardInstance.model, ForwardInstance.family,
                ForwardInstance.variant, ForwardInstance.p_model, ForwardInstance.p_market,
                ForwardInstance.y, ForwardInstance.cluster,
            ).where(ForwardInstance.y.is_not(None))
            .order_by(ForwardInstance.prediction_id, ForwardInstance.moment_min)
        ).all()  # fmt: skip
    seen: set[int] = set()
    groups: dict[tuple[str, str, str], list[Any]] = defaultdict(list)
    for r in rows:
        if r.prediction_id in seen:  # una predicción que sirve a dos momentos cuenta una vez
            continue
        seen.add(r.prediction_id)
        groups[(r.family, r.model, r.variant)].append(r)
    run_id = start_run(engine, "forward")
    out: dict[str, Any] = {}
    eval_rows: list[dict[str, Any]] = []
    created = utcnow()
    for (family, model, variant), sub in sorted(groups.items()):
        p = np.array([x.p_model for x in sub], dtype=float)
        y = np.array([x.y for x in sub], dtype=float)
        cl = [x.cluster for x in sub]
        s = MX.summarize(p, y, cl, n_boot=n_boot)
        base = float(np.mean((y.mean() - y) ** 2))
        fails = _failures(s, base)
        res: dict[str, Any] = {"n": s["n"], "conglomerados": s["n_clusters"], "fallas": fails}
        both = [x for x in sub if x.p_market is not None]
        mkt_brier = mkt_ll = None
        diff: dict[str, float] | None = None
        if len(both) >= MIN_VS_MARKET:
            pm = np.array([x.p_model for x in both], dtype=float)
            pk = np.array([x.p_market for x in both], dtype=float)
            ym = np.array([x.y for x in both], dtype=float)
            clm = [x.cluster for x in both]
            diff = MX.paired_diff(pm, pk, ym, clm, n_boot=n_boot)
            mkt_brier, mkt_ll = MX.brier(pk, ym), MX.log_loss(pk, ym)
        enough = s["n"] >= CRITERIA["min_n"] and s["n_clusters"] >= CRITERIA["min_clusters"]
        worse = bool(diff and enough and diff["lo"] > 0)
        if worse:
            fails.append("peor que el mercado en vivo")
        status = CALIB_VALIDATED if not fails else CALIB_NOT_VALIDATED
        res |= {"estado": status, "vs_mercado": diff, "peor_que_mercado": worse}
        out[f"{model}|{variant}"] = res
        eval_rows.append(
            {
                "run_id": run_id,
                "created_at": created,
                "backtest_version": FORWARD_VERSION,
                "family": family,
                "model": model,
                "variant": variant,
                "split": "vivo",
                "n": s["n"],
                "n_clusters": s["n_clusters"],
                "brier": s["brier"]["value"],
                "brier_lo": _f(s["brier"]["lo"]),
                "brier_hi": _f(s["brier"]["hi"]),
                "log_loss": s["log_loss"]["value"],
                "log_loss_lo": _f(s["log_loss"]["lo"]),
                "log_loss_hi": _f(s["log_loss"]["hi"]),
                "ece": s["ece"]["value"],
                "calib_in_large": s["calib_in_large"]["value"],
                "market_brier": mkt_brier,
                "market_log_loss": mkt_ll,
                "vs_market_ll_diff": diff["value"] if diff else None,
                "vs_market_ll_lo": _f(diff["lo"]) if diff else None,
                "vs_market_ll_hi": _f(diff["hi"]) if diff else None,
                "supera_mercado": bool(diff and diff["hi"] < 0) if diff else None,
                "is_reference": False,
                "status": status,
                "failures": fails,
                "bins": _jsonable_bins(s["bins"]),
            }
        )
    if eval_rows:
        with engine.begin() as conn:
            conn.execute(insert(ModelEvaluation), eval_rows)
    summary = {"version": FORWARD_VERSION, "instancias": len(seen), "pares": out}
    finish_run(engine, run_id, "success", summary)
    return {"run_id": run_id, **summary}


def _failures(s: dict[str, Any], base_brier: float) -> list[str]:
    fails = []
    if s["n"] < CRITERIA["min_n"]:
        fails.append(f"n={s['n']} < {CRITERIA['min_n']}")
    if s["n_clusters"] < CRITERIA["min_clusters"]:
        fails.append(f"conglomerados={s['n_clusters']} < {CRITERIA['min_clusters']}")
    if s["ece"]["value"] > CRITERIA["max_ece"]:
        fails.append(f"ECE={s['ece']['value']:.3f} > {CRITERIA['max_ece']}")
    cil = s["calib_in_large"]
    lo, hi = cil["lo"], cil["hi"]
    if abs(cil["value"]) > CRITERIA["max_abs_calib_in_large"] or not (lo <= 0 <= hi):
        fails.append(f"calibración global {cil['value']:+.3f}")
    if not (s["brier"]["value"] < base_brier):
        fails.append(f"Brier {s['brier']['value']:.4f} >= tasa observada {base_brier:.4f}")
    return fails


def _f(x: float) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def _jsonable_bins(bins: list[dict[str, float]]) -> list[dict[str, float | None]]:
    return [{k: _f(v) if isinstance(v, float) else v for k, v in b.items()} for b in bins]


def suspended_pairs(engine: Any) -> set[str]:
    """Pares ``modelo|variante`` peores que el mercado en la última evaluación en vivo."""
    from sqlalchemy import func, select

    from radar.db.models import ModelEvaluation

    with engine.connect() as conn:
        last = conn.execute(
            select(func.max(ModelEvaluation.run_id)).where(
                ModelEvaluation.backtest_version == FORWARD_VERSION
            )
        ).scalar()
        if last is None:
            return set()
        rows = conn.execute(
            select(ModelEvaluation.model, ModelEvaluation.variant).where(
                ModelEvaluation.run_id == last,
                ModelEvaluation.vs_market_ll_lo > 0,
                ModelEvaluation.n >= CRITERIA["min_n"],
                ModelEvaluation.n_clusters >= CRITERIA["min_clusters"],
            )
        ).all()
    return {f"{m}|{v}" for m, v in rows}


def enabled_pairs(engine: Any) -> set[str]:
    """Pares de familias nuevas (no cripto) habilitados para señales: validados y mejores que
    el mercado en la última evaluación y también en una al menos 7 días anterior."""
    from sqlalchemy import func, select

    from radar.db.models import ModelEvaluation, PredictionRun

    def passing(run_id: int) -> set[str]:
        with engine.connect() as conn:
            rows = conn.execute(
                select(ModelEvaluation.model, ModelEvaluation.variant).where(
                    ModelEvaluation.run_id == run_id,
                    ModelEvaluation.family != "cripto",
                    ModelEvaluation.status == CALIB_VALIDATED,
                    ModelEvaluation.supera_mercado.is_(True),
                )
            ).all()
        return {f"{m}|{v}" for m, v in rows}

    with engine.connect() as conn:
        last = conn.execute(
            select(PredictionRun.id, PredictionRun.started_at)
            .where(PredictionRun.kind == "forward", PredictionRun.status == "success")
            .order_by(PredictionRun.id.desc())
            .limit(1)
        ).first()
        if last is None:
            return set()
        older = conn.execute(
            select(func.max(PredictionRun.id)).where(
                PredictionRun.kind == "forward",
                PredictionRun.status == "success",
                PredictionRun.started_at <= last.started_at - ENABLE_GAP,
            )
        ).scalar()
    if older is None:
        return set()
    return passing(last.id) & passing(older)


# ---------------------------------------------------------------------- todo junto


def update(settings: Settings, engine: Any, *, n_boot: int = 500) -> dict[str, Any]:
    """Los cuatro pasos, en orden. Se llama después de cada corrida en vivo."""
    started = datetime.now(UTC)
    out: dict[str, Any] = {"capturadas": capture(engine)}
    out["cartera"] = open_paper(engine)
    out["venta_anticipada"] = sell_early(engine)
    out["resolucion"] = resolve(engine, settings)
    ev = evaluate(engine, n_boot=n_boot)
    out["evaluacion"] = {"run_id": ev["run_id"], "instancias": ev["instancias"]}
    try:  # v2 corre en paralelo: un error suyo no detiene forward-v1
        cmp = compare_v2(settings, engine, n_boot=n_boot)
        out["comparacion_v2"] = {"run_id": cmp["run_id"], "pares": len(cmp["pares"])}
    except Exception as exc:
        log.exception("compare_v2_failed")
        out["comparacion_v2"] = {"error": repr(exc)}
    out["segundos"] = round((datetime.now(UTC) - started).total_seconds(), 1)
    return out


# ------------------------------------------------------------- 5. v2 contra v1 (crypto-eval-v2)

V2_MODELS = ("cripto2-vol", "cripto2-opciones", "cripto2-mezcla")
EVAL_V2_VERSION = "crypto-eval-v2"


def compare_v2(settings: Settings, engine: Any, *, n_boot: int = 500) -> dict[str, Any]:
    """Diferencia de log loss pareada (mismo mercado y momento) de cada modelo v2 contra la
    referencia v1 de su variante y contra el mercado (``docs/PREREGISTRO_CRIPTO_V2.md``)."""
    import json

    from sqlalchemy import select

    from radar.db.models import ForwardInstance
    from radar.predict.service import calibration_path, finish_run, start_run

    path = calibration_path(settings)
    reference = (json.loads(path.read_text()) if path.exists() else {}).get(
        "reference_by_variant"
    ) or {}
    with engine.connect() as conn:
        rows = conn.execute(
            select(
                ForwardInstance.prediction_id, ForwardInstance.market_id, ForwardInstance.model,
                ForwardInstance.variant, ForwardInstance.moment_min, ForwardInstance.p_model,
                ForwardInstance.p_market, ForwardInstance.y, ForwardInstance.cluster,
            )
            .where(ForwardInstance.y.is_not(None), ForwardInstance.family == "cripto")
            .order_by(ForwardInstance.prediction_id, ForwardInstance.moment_min)
        ).all()  # fmt: skip
    by_key = {(r.market_id, r.moment_min, r.model): r for r in rows}
    seen: set[int] = set()
    groups: dict[tuple[str, str], list[tuple[Any, Any]]] = defaultdict(list)
    for r in rows:
        if r.model not in V2_MODELS or r.prediction_id in seen:
            continue
        seen.add(r.prediction_id)
        ref = by_key.get((r.market_id, r.moment_min, f"cripto-{reference.get(r.variant) or 'rv'}"))
        groups[(r.model, r.variant)].append((r, ref))
    out: dict[str, Any] = {}
    for (model, variant), pairs in sorted(groups.items()):
        res: dict[str, Any] = {
            "n": len(pairs),
            "referencia_v1": f"cripto-{reference.get(variant) or 'rv'}",
        }
        both = [(a, b) for a, b in pairs if b is not None]
        if len(both) >= MIN_VS_MARKET:
            y = np.array([a.y for a, _ in both], dtype=float)
            d = MX.paired_diff(np.array([a.p_model for a, _ in both], dtype=float),
                               np.array([b.p_model for _, b in both], dtype=float), y,
                               [a.cluster for a, _ in both], n_boot=n_boot)  # fmt: skip
            res["vs_v1"] = {"n": len(both), "conglomerados": len({a.cluster for a, _ in both}),
                            "log_loss_diff": d}  # fmt: skip
            res["supera_v1"] = bool(d["hi"] < 0)
            res["peor_que_v1"] = bool(d["lo"] > 0)
        mk = [a for a, _ in pairs if a.p_market is not None]
        if len(mk) >= MIN_VS_MARKET:
            d = MX.paired_diff(np.array([a.p_model for a in mk], dtype=float),
                               np.array([a.p_market for a in mk], dtype=float),
                               np.array([a.y for a in mk], dtype=float),
                               [a.cluster for a in mk], n_boot=n_boot)  # fmt: skip
            res["vs_mercado"] = {"n": len(mk), "log_loss_diff": d}
            res["supera_mercado"] = bool(d["hi"] < 0)
        out[f"{model}|{variant}"] = res
    run_id = start_run(engine, "forward-v2")
    summary = {"version": EVAL_V2_VERSION, "pares": out}
    finish_run(engine, run_id, "success", summary)
    return {"run_id": run_id, **summary}
