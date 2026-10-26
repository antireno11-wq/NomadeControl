"""Evaluación sobre múltiples elecciones: calibración (solo encuestas) y comparación
con el mercado (contiendas con mercado de Polymarket en la era CLOB).

Reglas preregistradas (``EVAL_RULES``):

- **Walk-forward**: cada contienda se evalúa con un modelo de error calibrado solo
  con contiendas *anteriores* a su fecha. Nunca con la propia ni con posteriores.
- **Disponibilidad de encuestas**: fin de trabajo de campo + 2 días (aproximación
  conservadora; solo la contienda con revisiones exactas usa revisiones).
- **Momentos de decisión**: 7, 3, 1 y 0,5 días antes del cierre de urnas.
- **Operación hipotética**: en la primera alerta de cada contienda, solo si hubo
  compras reales del token en la hora previa; precio = máximo pagado en esa
  ventana + comisión + colchón de deslizamiento; monto US$25; se mantiene hasta
  la resolución. Es **hipotética**: no se ejecutó y no es una ganancia realizada.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any

from radar.elections.backtest import TokenSpec, brier, log_loss
from radar.elections.contests import Contest
from radar.elections.engine import EngineConfig, Quote, build_estimates, consensus, evaluate
from radar.elections.market_history import (
    PRICE_BASIS_REFERENCE,
    PRICE_BASIS_TRADES,
    MarketHistory,
    buy_evidence,
    price_at,
)
from radar.elections.models import CalibContest, ValidationReport, fit_error_model
from radar.elections.polls import ParsedPage
from radar.ingestion.http import ApiClient

EVAL_RULES = {
    "calibracion": "walk-forward (solo contiendas anteriores)",
    "disponibilidad_encuestas": "fin de campo + 2 días",
    "momentos_decision_dias": [7, 3, 1, 0.5],
    "operacion_hipotetica": "primera alerta con compras observadas; máx. precio pagado en 60 min "
    "+ comisión + 0,5 c; US$25; hasta resolución",
}
DECISION_OFFSETS_DAYS = (7.0, 3.0, 1.0, 0.5)
AVAILABILITY_LAG_DAYS = 2
STAKE_USD = 25.0


@dataclass
class MarketEvent:
    slug: str
    tokens: list[TokenSpec]
    winner_candidate: str | None  # "a" | "b" | None (sin resolver)
    resolution_note: str
    raw_markets: list[dict[str, Any]] = field(default_factory=list)


def load_market_event(gamma: ApiClient, slug: str, contest: Contest) -> MarketEvent:
    """Mercados del evento (abiertos o cerrados) para los dos candidatos de la contienda."""
    resp = gamma.request_json(
        "GET", "/events/keyset", params={"slug": slug, "closed": "any", "limit": 5}
    )
    events = resp.data.get("events") or []
    if not events:
        return MarketEvent(slug, [], None, "evento no encontrado")
    tokens: list[TokenSpec] = []
    winners: list[str] = []
    raws = []
    for m in events[0].get("markets") or []:
        title = m.get("groupItemTitle") or m.get("question") or ""
        cand = (
            "a"
            if contest.candidate_a.matches(title)
            else ("b" if contest.candidate_b.matches(title) else None)
        )
        if cand is None or not m.get("clobTokenIds"):
            continue
        ids = json.loads(m["clobTokenIds"])
        prices = json.loads(m.get("outcomePrices") or "[]")
        fee = m.get("feeSchedule") or {}
        raws.append(
            {
                "id": m["id"],
                "title": title,
                "closed": m.get("closed"),
                "outcomePrices": prices,
                "umaResolutionStatus": m.get("umaResolutionStatus"),
            }
        )
        for idx, outcome in enumerate(("YES", "NO")):
            tokens.append(
                TokenSpec(
                    market_id=str(m["id"]),
                    condition_id=m.get("conditionId", ""),
                    token_id=str(ids[idx]),
                    label=f"{(contest.candidate_a if cand == 'a' else contest.candidate_b).name} "
                    f"{outcome}",
                    candidate=cand,
                    outcome=outcome,
                    fee_rate=fee.get("rate"),
                    fee_exponent=fee.get("exponent"),
                )
            )
        if prices and float(prices[0]) >= 0.99:
            winners.append(cand)
    note = "outcomePrices de Gamma (YES ≥ 0,99)"
    winner = winners[0] if len(set(winners)) == 1 else None
    if winner is None:
        note = "sin resolución clara en Gamma"
    return MarketEvent(slug, tokens, winner, note, raws)


def walk_forward_calibration(
    target: Contest, calibration: list[CalibContest], contests: dict[str, Contest]
) -> list[CalibContest]:
    return [
        c
        for c in calibration
        if c.key != target.key and contests[c.key].election_date < target.election_date
    ]


def evaluate_contest_vs_market(
    contest: Contest,
    parsed: ParsedPage,
    calibration_prior: list[CalibContest],
    validation: ValidationReport,
    event: MarketEvent,
    history: MarketHistory,
    *,
    cfg: EngineConfig | None = None,
    seed: int = 11,
) -> dict[str, Any]:
    cfg = cfg or EngineConfig()
    models = {m: fit_error_model(calibration_prior, m) for m in ("weighted", "median")}
    out: dict[str, Any] = {
        "contest": contest.key,
        "candidatos": {"a": contest.candidate_a.name, "b": contest.candidate_b.name},
        "evento_polymarket": event.slug,
        "ganador_segun_mercado": event.winner_candidate,
        "nota_resolucion": event.resolution_note,
        "calibrado_con": [c.key for c in calibration_prior],
        "puntos": [],
        "operacion_hipotetica": None,
    }
    if not calibration_prior:
        out["abstencion"] = "sin contiendas anteriores para calibrar"
        return out
    if not event.tokens:
        out["abstencion"] = "sin mercados del par de candidatos"
        return out
    times = [contest.polls_close_utc - timedelta(days=d) for d in DECISION_OFFSETS_DAYS]
    series = {
        t.token_id: history.price_history(
            t.token_id, min(times) - timedelta(days=1), contest.polls_close_utc
        )
        for t in event.tokens
    }
    for t in times:
        polls = [
            p
            for p in parsed.polls
            if p.fieldwork_end + timedelta(days=AVAILABILITY_LAG_DAYS) <= t.date()
        ]
        aggs = [a for a in parsed.aggregators if a.last_update and a.last_update <= t.date()]
        est = build_estimates(
            _as_defined(contest), polls, aggs, t, models, seed=seed + int(t.timestamp()) % 1000
        )
        cons = consensus(est)
        quotes: list[Quote] = []
        evid: dict[str, Any] = {}
        trades_by_cond: dict[str, Any] = {}
        for spec in event.tokens:
            ref = price_at(series[spec.token_id], t)
            quotes.append(
                Quote(
                    spec.market_id,
                    spec.token_id,
                    spec.label,
                    spec.candidate,
                    spec.outcome,
                    PRICE_BASIS_REFERENCE,
                    ref.price if ref else None,
                    ref.t if ref else None,
                    fee_rate=spec.fee_rate,
                    fee_exponent=spec.fee_exponent,
                )
            )
            if spec.condition_id not in trades_by_cond:
                trades_by_cond[spec.condition_id] = history.trades(
                    spec.condition_id, t - timedelta(minutes=60), t
                )
            ev = buy_evidence(
                trades_by_cond[spec.condition_id], spec.token_id, t - timedelta(minutes=60), t
            )
            evid[spec.label] = asdict(ev) | {
                "window_start": ev.window_start.isoformat(),
                "window_end": ev.window_end.isoformat(),
                "last_buy": None,
            }
            if ev.max_buy_price is not None:
                quotes.append(
                    Quote(
                        spec.market_id,
                        spec.token_id,
                        spec.label,
                        spec.candidate,
                        spec.outcome,
                        PRICE_BASIS_TRADES,
                        ev.max_buy_price,
                        ev.window_end,
                        fee_rate=spec.fee_rate,
                        fee_exponent=spec.fee_exponent,
                    )
                )
        decisions = evaluate(_as_defined(contest), est, quotes, validation, t, cfg)
        market_a = next(
            (
                q.price
                for q in quotes
                if q.candidate == "a" and q.outcome == "YES" and q.basis == PRICE_BASIS_REFERENCE
            ),
            None,
        )
        point = {
            "t": t.isoformat(),
            "dias_al_cierre": round((contest.polls_close_utc - t).total_seconds() / 86400, 3),
            "encuestas_disponibles": len(polls),
            "modelo_p_a": cons.reference_prob_a,
            "rango_estimaciones": [cons.min_prob_a, cons.max_prob_a],
            "n_estimaciones": cons.n_estimates,
            "mercado_p_a_referencia": market_a,
            "alertas": [
                {
                    "token": d.quote.label,
                    "base": d.quote.basis,
                    "precio": d.quote.price,
                    "discrepancia_pp": d.discrepancy_pp,
                    "ventaja_conservadora_pp": d.conservative_edge_pp,
                    "senal_operable": d.signal,
                    "bloqueos": d.gating,
                }
                for d in decisions
                if d.alert
            ],
            "evidencia_operaciones": evid,
        }
        out["puntos"].append(point)
        if out["operacion_hipotetica"] is None:
            trade_alerts = [d for d in decisions if d.alert and d.quote.basis == PRICE_BASIS_TRADES]
            if trade_alerts:
                best = max(trade_alerts, key=lambda d: d.discrepancy_pp or 0)
                out["operacion_hipotetica"] = _hypothetical(best, event, t, cfg)
    if event.winner_candidate is not None:
        y = 1.0 if event.winner_candidate == "a" else 0.0
        scored = [
            p
            for p in out["puntos"]
            if p["modelo_p_a"] is not None and p["mercado_p_a_referencia"] is not None
        ]
        out["metricas"] = {
            "n_puntos": len(scored),
            "brier_modelo": _mean([brier(p["modelo_p_a"], y) for p in scored]),
            "brier_mercado": _mean([brier(p["mercado_p_a_referencia"], y) for p in scored]),
            "logloss_modelo": _mean([log_loss(p["modelo_p_a"], y) for p in scored]),
            "logloss_mercado": _mean([log_loss(p["mercado_p_a_referencia"], y) for p in scored]),
        }
    return out


def _as_defined(contest: Contest) -> Contest:
    """Las contiendas históricas se evalúan siempre después de definidas."""
    if contest.defined_from_utc is not None:
        return contest
    from dataclasses import replace

    return replace(contest, defined_from_utc=contest.polls_close_utc - timedelta(days=60))


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _hypothetical(
    decision: Any, event: MarketEvent, t: datetime, cfg: EngineConfig
) -> dict[str, Any]:
    q = decision.quote
    cost = decision.cost_per_share
    shares = STAKE_USD / cost
    won = None
    if event.winner_candidate is not None:
        cand_won = event.winner_candidate == q.candidate
        won = cand_won if q.outcome == "YES" else not cand_won
    payout = shares if won else (0.0 if won is not None else None)
    return {
        "tipo": "HIPOTÉTICA (no ejecutada, no es ganancia realizada)",
        "t": t.isoformat(),
        "token": q.label,
        "precio_base": q.price,
        "base_precio": q.basis,
        "costo_por_accion": cost,
        "monto_usd": STAKE_USD,
        "acciones": round(shares, 4),
        "gana": won,
        "pago_usd": round(payout, 4) if payout is not None else None,
        "pnl_hipotetico_usd": round(payout - STAKE_USD, 4) if payout is not None else None,
        "senal_operable": decision.signal,
        "bloqueos": decision.gating,
    }


def aggregate(results: list[dict[str, Any]]) -> dict[str, Any]:
    evaluated = [r for r in results if "abstencion" not in r]
    trades = [r["operacion_hipotetica"] for r in evaluated if r.get("operacion_hipotetica")]
    settled = [t for t in trades if t.get("pnl_hipotetico_usd") is not None]
    metr = [r["metricas"] for r in evaluated if r.get("metricas") and r["metricas"]["n_puntos"]]
    return {
        "reglas": EVAL_RULES,
        "contiendas": len(results),
        "contiendas_evaluadas": len(evaluated),
        "contiendas_con_alerta": sum(
            1 for r in evaluated if any(p["alertas"] for p in r["puntos"])
        ),
        "senales_operables": sum(
            1 for r in evaluated for p in r["puntos"] for a in p["alertas"] if a["senal_operable"]
        ),
        "operaciones_hipoteticas": len(trades),
        "pnl_hipotetico_total_usd": round(sum(t["pnl_hipotetico_usd"] for t in settled), 4)
        if settled
        else None,
        "capital_hipotetico_usd": STAKE_USD * len(settled),
        "brier_medio_modelo": _mean(
            [m["brier_modelo"] for m in metr if m["brier_modelo"] is not None]
        ),
        "brier_medio_mercado": _mean(
            [m["brier_mercado"] for m in metr if m["brier_mercado"] is not None]
        ),
        "advertencia": (
            "Muestra pequeña, precios históricos no ejecutables y operaciones hipotéticas: "
            "esto no demuestra rentabilidad ni calibración."
        ),
    }
