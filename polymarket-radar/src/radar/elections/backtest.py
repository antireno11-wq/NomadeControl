"""Backtest retrospectivo y cronológico de una contienda.

En cada instante T:

- Encuestas y agregadores: solo los que figuran en la **revisión de Wikipedia
  vigente en T** (timestamp de revisión <= T). Si esa revisión ya tuviera una
  fila de resultado de la contienda, el punto se marca como posible fuga y se
  excluye.
- Calibración del error: solo contiendas históricas anteriores (nunca la evaluada).
- Mercado: precio de referencia ``prices-history`` <= T (NO ejecutable) y
  operaciones reales de compra en ``[T − ventana, T]`` (precio ejecutado
  observado). No existen libros históricos: no hay ask ejecutable en el pasado,
  por lo que ninguna señal del backtest puede ser operable.

Las alertas que produce el backtest se guardan como ``backtest_retrospectivo``:
se generan hoy, con el resultado ya conocido, y no son evidencia previa.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any

from radar.elections.alerts import AlertLedger
from radar.elections.contests import Contest
from radar.elections.engine import (
    EngineConfig,
    Quote,
    build_estimates,
    consensus,
    evaluate,
)
from radar.elections.market_history import (
    PRICE_BASIS_REFERENCE,
    PRICE_BASIS_TRADES,
    MarketHistory,
    buy_evidence,
    price_at,
)
from radar.elections.models import (
    MODEL_VERSION,
    CalibContest,
    ValidationReport,
    fit_error_model,
)
from radar.elections.polls import parse_page
from radar.elections.sources.wikimedia import WikiDocument
from radar.timeutil import utcnow


@dataclass(frozen=True)
class TokenSpec:
    market_id: str
    condition_id: str
    token_id: str
    label: str
    candidate: str  # a | b
    outcome: str  # YES | NO
    fee_rate: float | None
    fee_exponent: float | None


def _iso(x: datetime | None) -> str | None:
    return x.isoformat() if x else None


def run_backtest(
    contest: Contest,
    docs: list[tuple[datetime, WikiDocument | None]],
    calibration: list[CalibContest],
    validation: ValidationReport,
    tokens: list[TokenSpec],
    history: MarketHistory,
    *,
    cfg: EngineConfig | None = None,
    trade_window: timedelta = timedelta(minutes=60),
    ledger: AlertLedger | None = None,
    seed: int = 20261025,
) -> dict[str, Any]:
    cfg = cfg or EngineConfig()
    models = {m: fit_error_model(calibration, m) for m in ("weighted", "median")}
    start = min(t for t, _ in docs) - timedelta(days=2)
    end = contest.polls_close_utc + timedelta(hours=8)
    series = {t.token_id: history.price_history(t.token_id, start, end) for t in tokens}
    timeline: list[dict[str, Any]] = []
    last_alert_state: dict[str, float] = {}
    first_alert: dict[str, Any] | None = None
    for t, doc in docs:
        point: dict[str, Any] = {"t": t.isoformat(), "dias_al_cierre": None}
        point["dias_al_cierre"] = round((contest.polls_close_utc - t).total_seconds() / 86400, 3)
        if doc is None:
            point["estado"] = "sin revisión disponible"
            timeline.append(point)
            continue
        parsed = parse_page(doc.html, contest)
        point["revision"] = {
            "revid": doc.revid,
            "revision_ts": doc.revision_ts.isoformat(),
            "sha256": doc.sha256,
            "url": doc.url,
        }
        if doc.revision_ts > t:
            raise ValueError(f"revisión {doc.revid} posterior a T={t}: error de selección")
        if parsed.results and t < contest.polls_close_utc:
            point["estado"] = "posible fuga: la revisión ya contiene resultado; punto excluido"
            timeline.append(point)
            continue
        polls = [p for p in parsed.polls if p.fieldwork_end <= t.date()]
        aggs = [a for a in parsed.aggregators if a.last_update and a.last_update <= t.date()]
        estimates = build_estimates(contest, polls, aggs, t, models, seed=seed)
        cons = consensus(estimates)
        quotes: list[Quote] = []
        evidence_out: dict[str, Any] = {}
        trades_cache: dict[str, Any] = {}
        for spec in tokens:
            ref = price_at(series[spec.token_id], t)
            quotes.append(
                Quote(
                    market_id=spec.market_id,
                    token_id=spec.token_id,
                    label=spec.label,
                    candidate=spec.candidate,
                    outcome=spec.outcome,
                    basis=PRICE_BASIS_REFERENCE,
                    price=ref.price if ref else None,
                    observed_at=ref.t if ref else None,
                    fee_rate=spec.fee_rate,
                    fee_exponent=spec.fee_exponent,
                )
            )
            if spec.condition_id not in trades_cache:
                trades_cache[spec.condition_id] = history.trades(
                    spec.condition_id, t - trade_window, t
                )
            ev = buy_evidence(trades_cache[spec.condition_id], spec.token_id, t - trade_window, t)
            evidence_out[spec.label] = {
                "ventana": [_iso(ev.window_start), _iso(ev.window_end)],
                "compras": ev.n_buys,
                "acciones": ev.buy_shares,
                "nocional_usd": ev.buy_notional,
                "precio_min": ev.min_buy_price,
                "precio_max": ev.max_buy_price,
                "vwap": ev.vwap_buy_price,
                "ultima_compra": {
                    "t": _iso(ev.last_buy.t),
                    "precio": ev.last_buy.price,
                    "acciones": ev.last_buy.size,
                    "tx": ev.last_buy.tx,
                }
                if ev.last_buy
                else None,
            }
            if ev.max_buy_price is not None:
                # Conservador para quien compra: el precio más alto pagado en la ventana.
                quotes.append(
                    Quote(
                        market_id=spec.market_id,
                        token_id=spec.token_id,
                        label=spec.label,
                        candidate=spec.candidate,
                        outcome=spec.outcome,
                        basis=PRICE_BASIS_TRADES,
                        price=ev.max_buy_price,
                        observed_at=ev.last_buy.t if ev.last_buy else None,
                        fee_rate=spec.fee_rate,
                        fee_exponent=spec.fee_exponent,
                        evidence={"compras": ev.n_buys, "nocional_usd": ev.buy_notional},
                    )
                )
        decisions = evaluate(contest, estimates, quotes, validation, t, cfg)
        point.update(
            {
                "encuestas_en_revision": len(polls),
                "encuesta_mas_reciente": max((p.fieldwork_end for p in polls), default=None),
                "agregadores": [
                    {
                        "nombre": a.aggregator,
                        "actualizado": a.last_update.isoformat() if a.last_update else None,
                        "a": a.share_a,
                        "b": a.share_b,
                    }
                    for a in aggs
                ],
                "estimaciones": [asdict(e) for e in estimates],
                "consenso": asdict(cons),
                "decisiones": [d.to_dict() for d in decisions],
                "evidencia_operaciones": evidence_out,
                "alerta": any(d.alert for d in decisions),
                "senal_operable": any(d.signal for d in decisions),
            }
        )
        if isinstance(point["encuesta_mas_reciente"], type(t.date())):
            point["encuesta_mas_reciente"] = point["encuesta_mas_reciente"].isoformat()
        timeline.append(point)
        for d in decisions:
            if not d.alert:
                continue
            key = f"{d.quote.label}|{d.quote.basis}"
            prev = last_alert_state.get(key)
            if prev is not None and abs(prev - (d.discrepancy_pp or 0)) < 1.0:
                continue
            last_alert_state[key] = d.discrepancy_pp or 0.0
            payload = {
                "contest": contest.key,
                "as_of": t.isoformat(),
                "model_version": MODEL_VERSION,
                "decision": d.to_dict(),
                "estimaciones": [asdict(e) for e in estimates],
                "consenso": asdict(cons),
                "revision_wikipedia": point["revision"],
                "evidencia_operaciones": evidence_out.get(d.quote.label),
                "umbral_pp": cfg.alert_threshold_pp,
            }
            if ledger is not None:
                ledger.append(
                    mode="backtest_retrospectivo",
                    kind="senal_operable" if d.signal else "investigacion",
                    payload=payload,
                    created_at=utcnow(),
                )
            if first_alert is None:
                first_alert = {"t": t.isoformat(), **payload}
    for k in ("weighted", "median"):
        models[k].errors = {
            c: [(d, round(e, 6)) for d, e in v] for c, v in models[k].errors.items()
        }
    return {
        "contest": contest.key,
        "candidatos": {"a": contest.candidate_a.name, "b": contest.candidate_b.name},
        "modo": "backtest_retrospectivo",
        "creado": utcnow().isoformat(),
        "model_version": MODEL_VERSION,
        "config": asdict(cfg),
        "ventana_operaciones_min": trade_window.total_seconds() / 60,
        "cierre_urnas_utc": contest.polls_close_utc.isoformat(),
        "calibracion": {
            m: {
                "contiendas": sorted(models[m].errors),
                "sigma0_pp": round(math.sqrt(max(models[m].s0_sq, 0)) * 100, 3),
                "k_pp2_por_dia": round(models[m].k * 1e4, 4),
                "errores": models[m].errors,
            }
            for m in models
        },
        "validacion": asdict(validation),
        "timeline": timeline,
        "primera_alerta": first_alert,
        "fuentes_mercado": history.sources,
    }


def brier(p: float, y: float) -> float:
    return (p - y) ** 2


def log_loss(p: float, y: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return -(y * math.log(p) + (1 - y) * math.log(1 - p))


def outcome_metrics(result: dict[str, Any], winner_is_a: bool) -> dict[str, Any]:
    """Brier y log loss de la referencia del modelo y del precio de referencia del
    mercado (token "YES" de A) en cada instante. n = 1 contienda."""
    y = 1.0 if winner_is_a else 0.0
    rows = []
    for p in result["timeline"]:
        cons = (p.get("consenso") or {}).get("reference_prob_a")
        mkt = None
        for d in p.get("decisiones") or []:
            q = d["quote"]
            if (
                q["candidate"] == "a"
                and q["outcome"] == "YES"
                and q["basis"] == PRICE_BASIS_REFERENCE
            ):
                mkt = q["price"]
        if cons is None or mkt is None:
            continue
        rows.append(
            {
                "t": p["t"],
                "modelo_p_a": cons,
                "mercado_p_a": mkt,
                "brier_modelo": brier(cons, y),
                "brier_mercado": brier(mkt, y),
                "logloss_modelo": log_loss(cons, y),
                "logloss_mercado": log_loss(mkt, y),
            }
        )

    def mean(k: str) -> float | None:
        return sum(r[k] for r in rows) / len(rows) if rows else None

    return {
        "n_contiendas": 1,
        "advertencia": (
            "Una sola elección. Que el resultado coincida o no con una estimación no "
            "prueba que estuviera bien calibrada."
        ),
        "n_instantes": len(rows),
        "brier_medio_modelo": mean("brier_modelo"),
        "brier_medio_mercado": mean("brier_mercado"),
        "logloss_medio_modelo": mean("logloss_modelo"),
        "logloss_medio_mercado": mean("logloss_mercado"),
        "por_instante": rows,
    }
