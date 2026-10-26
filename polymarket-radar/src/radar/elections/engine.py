"""Motor de discrepancias electorales.

Para un instante ``as_of``:

1. ``build_estimates``: varias estimaciones independientes de P(A gana), todas
   registradas (ninguna se descarta por ser menos favorable):
   - ``interno:ponderado+t``, ``interno:ponderado+empirico``, ``interno:mediana+t``
   - ``agregador:<nombre>`` para cada promedio publicado (convertido a
     probabilidad con el mismo modelo de error; calibración prestada del promedio
     ponderado porque no hay historial de esos agregadores).
2. **Referencia preregistrada**: mediana de las probabilidades de todas las
   estimaciones válidas. El desacuerdo se informa como rango y desviación.
3. ``evaluate``: para cada token cotizado, discrepancia bruta = P(token) − precio.
   - **Alerta de investigación** si la discrepancia de la referencia ≥ umbral
     (5 p.p. por defecto). Es una invitación a revisar, no una recomendación.
   - **Señal operable** solo si se cumplen TODAS las condiciones de
     ``gating_reasons``: modelo validado, precio = ask ejecutable del CLOB, urnas
     abiertas, comisión verificada, liquidez suficiente y ventaja conservadora
     > 0 después de costos. La ventaja conservadora usa, para cada estimación,
     el extremo desfavorable de su intervalo, y toma la mínima entre todas.
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime

import numpy as np

from radar.elections.contests import Contest
from radar.elections.market_history import PRICE_BASIS_ASK
from radar.elections.models import (
    MODEL_VERSION,
    ErrorModel,
    PollObs,
    ValidationReport,
    bootstrap_sigmas,
    pollster_median,
    prob_empirical,
    prob_t,
    weighted_average,
)
from radar.elections.polls import AggregatorRow, PollRow


@dataclass(frozen=True)
class Estimate:
    name: str
    family: str  # interno | agregador
    status: str  # ok | abstencion
    prob_a: float | None
    prob_a_low: float | None
    prob_a_high: float | None
    vote_share_a: float | None
    sigma: float | None
    horizon_days: float
    model_version: str
    calibration: str
    inputs: dict[str, object]
    abstain_reason: str | None = None


@dataclass(frozen=True)
class EngineConfig:
    alert_threshold_pp: float = 5.0
    min_conservative_edge_pp: float = 0.0
    slippage_buffer: float = 0.005
    max_spread: float = 0.05
    max_book_age_s: float = 900.0
    order_size_usd: float = 25.0
    min_estimates: int = 2


def _abstain(name: str, family: str, d: float, reason: str, calibration: str = "") -> Estimate:
    return Estimate(
        name=name,
        family=family,
        status="abstencion",
        prob_a=None,
        prob_a_low=None,
        prob_a_high=None,
        vote_share_a=None,
        sigma=None,
        horizon_days=d,
        model_version=MODEL_VERSION,
        calibration=calibration,
        inputs={},
        abstain_reason=reason,
    )


def build_estimates(
    contest: Contest,
    polls: Sequence[PollRow],
    aggregators: Sequence[AggregatorRow],
    as_of: datetime,
    error_models: dict[str, ErrorModel],
    *,
    seed: int = 20261025,
) -> list[Estimate]:
    d = (contest.polls_close_utc - as_of).total_seconds() / 86400
    names = [
        ("interno:ponderado+t", "weighted", "t"),
        ("interno:ponderado+empirico", "weighted", "empirical"),
        ("interno:mediana+t", "median", "t"),
    ]
    if as_of >= contest.polls_close_utc:
        reason = "urnas cerradas: el resultado puede ser público; no se estima"
        return [_abstain(n, "interno", d, reason) for n, _, _ in names]
    if contest.defined_from_utc and as_of < contest.defined_from_utc:
        reason = "contienda aún no definida (el par de candidatos no se conocía)"
        return [_abstain(n, "interno", d, reason) for n, _, _ in names]

    as_of_date = as_of.date()
    obs = [
        PollObs(p.pollster, p.fieldwork_end, p.two_party_a, p.sample_size, p.key())
        for p in polls
        if p.fieldwork_end <= as_of_date
    ]
    out: list[Estimate] = []
    rng = np.random.default_rng(seed)
    for i, (name, method, kind) in enumerate(names):
        model = error_models.get(method)
        calib = (
            f"error calibrado con {model.n_contests} contiendas: {', '.join(sorted(model.errors))}"
            if model
            else ""
        )
        if model is None or model.n_contests == 0:
            out.append(_abstain(name, "interno", d, "sin contiendas de calibración", calib))
            continue
        avg = (weighted_average if method == "weighted" else pollster_median)(obs, as_of_date)
        if avg.value is None:
            out.append(_abstain(name, "interno", d, avg.reason or "sin promedio", calib))
            continue
        if kind == "t":
            sig = bootstrap_sigmas(model, d, rng)
            pr = prob_t(avg.value, sig, seed=seed + i)
        else:
            pr = prob_empirical(avg.value, model, d, seed=seed + i)
            if pr is None:
                out.append(_abstain(name, "interno", d, "sin errores empíricos", calib))
                continue
        out.append(
            Estimate(
                name=name,
                family="interno",
                status="ok",
                prob_a=pr.prob_a,
                prob_a_low=pr.prob_a_low,
                prob_a_high=pr.prob_a_high,
                vote_share_a=avg.value,
                sigma=pr.sigma,
                horizon_days=round(d, 3),
                model_version=MODEL_VERSION,
                calibration=calib,
                inputs={
                    "metodo_promedio": method,
                    "error": kind,
                    "n_encuestas": avg.n_polls,
                    "n_encuestadoras": avg.n_pollsters,
                    "encuesta_mas_reciente": avg.newest_fieldwork_end.isoformat()
                    if avg.newest_fieldwork_end
                    else None,
                    "poll_keys": list(avg.used_keys),
                    "semilla": pr.seed,
                    "simulaciones": pr.draws,
                },
            )
        )
    wmodel = error_models.get("weighted")
    for j, agg in enumerate(aggregators):
        name = f"agregador:{agg.aggregator}"
        if agg.last_update is None or agg.last_update > as_of_date:
            continue  # aún no publicado en as_of
        if wmodel is None or wmodel.n_contests == 0:
            out.append(_abstain(name, "agregador", d, "sin contiendas de calibración"))
            continue
        sig = bootstrap_sigmas(wmodel, d, rng)
        pr = prob_t(agg.two_party_a, sig, seed=seed + 100 + j)
        out.append(
            Estimate(
                name=name,
                family="agregador",
                status="ok",
                prob_a=pr.prob_a,
                prob_a_low=pr.prob_a_low,
                prob_a_high=pr.prob_a_high,
                vote_share_a=agg.two_party_a,
                sigma=pr.sigma,
                horizon_days=round(d, 3),
                model_version=MODEL_VERSION,
                calibration="error prestado del promedio ponderado (sin historial del agregador)",
                inputs={
                    "agregador": agg.aggregator,
                    "ultima_actualizacion": agg.last_update.isoformat(),
                    "valor_a": agg.share_a,
                    "valor_b": agg.share_b,
                    "otros": agg.other,
                    "semilla": pr.seed,
                },
            )
        )
    return out


@dataclass(frozen=True)
class Consensus:
    reference_prob_a: float | None
    n_estimates: int
    min_prob_a: float | None
    max_prob_a: float | None
    stdev_prob_a: float | None
    rule: str = "mediana de todas las estimaciones válidas (preregistrada)"


def consensus(estimates: Sequence[Estimate]) -> Consensus:
    ok = [e.prob_a for e in estimates if e.status == "ok" and e.prob_a is not None]
    if not ok:
        return Consensus(None, 0, None, None, None)
    return Consensus(
        reference_prob_a=float(statistics.median(ok)),
        n_estimates=len(ok),
        min_prob_a=min(ok),
        max_prob_a=max(ok),
        stdev_prob_a=float(statistics.pstdev(ok)) if len(ok) > 1 else 0.0,
    )


# ---------------------------------------------------------------- cotizaciones
@dataclass(frozen=True)
class Quote:
    market_id: str
    token_id: str
    label: str
    candidate: str  # "a" | "b"
    outcome: str  # "YES" | "NO"
    basis: str  # ask_ejecutable | precio_ejecutado_observado | precio_referencia_no_ejecutable
    price: float | None
    observed_at: datetime | None
    vwap_for_size: float | None = None
    fill_complete: bool | None = None
    spread: float | None = None
    book_age_s: float | None = None
    fee_rate: float | None = None
    fee_exponent: float | None = None
    evidence: dict[str, object] = field(default_factory=dict)


def token_prob(prob_a: float, candidate: str, outcome: str) -> float:
    """Contienda de dos candidatos: P(B) = 1 − P(A); NO = 1 − YES."""
    p_cand = prob_a if candidate == "a" else 1.0 - prob_a
    return p_cand if outcome == "YES" else 1.0 - p_cand


def token_prob_low(e: Estimate, candidate: str, outcome: str) -> float | None:
    """Extremo desfavorable del intervalo para quien compra este token."""
    if e.prob_a_low is None or e.prob_a_high is None:
        return None
    favours_a = (candidate == "a") == (outcome == "YES")
    return e.prob_a_low if favours_a else 1.0 - e.prob_a_high


def fee_per_share(price: float, rate: float | None, exponent: float | None) -> float | None:
    """Comisión del tomador por acción según docs.polymarket.com/trading/fees:
    ``fee = C × feeRate × p × (1 − p)``. Solo verificada para exponente 1 o tasa 0."""
    if rate is None:
        return None
    if rate == 0:
        return 0.0
    if exponent not in (None, 1, 1.0):
        return None
    return rate * price * (1 - price)


@dataclass
class Decision:
    quote: Quote
    reference_prob: float | None
    discrepancy_pp: float | None
    per_estimate: list[dict[str, object]]
    alert: bool
    conservative_edge_pp: float | None
    cost_per_share: float | None
    signal: bool
    gating: list[str]

    def to_dict(self) -> dict[str, object]:
        d = asdict(self)
        d["quote"]["observed_at"] = (
            self.quote.observed_at.isoformat() if self.quote.observed_at else None
        )
        return d


def evaluate(
    contest: Contest,
    estimates: Sequence[Estimate],
    quotes: Sequence[Quote],
    validation: ValidationReport,
    as_of: datetime,
    cfg: EngineConfig | None = None,
) -> list[Decision]:
    cfg = cfg or EngineConfig()
    cons = consensus(estimates)
    ok = [e for e in estimates if e.status == "ok" and e.prob_a is not None]
    decisions: list[Decision] = []
    for q in quotes:
        if q.price is None or cons.reference_prob_a is None:
            decisions.append(
                Decision(q, None, None, [], False, None, None, False, ["información insuficiente"])
            )
            continue
        ref = token_prob(cons.reference_prob_a, q.candidate, q.outcome)
        disc = (ref - q.price) * 100
        per = [
            {
                "estimacion": e.name,
                "prob_token": round(token_prob(e.prob_a, q.candidate, q.outcome), 6),  # type: ignore[arg-type]
                "discrepancia_pp": round(
                    (token_prob(e.prob_a, q.candidate, q.outcome) - q.price) * 100,  # type: ignore[arg-type]
                    3,
                ),
            }
            for e in ok
        ]
        entry = q.vwap_for_size if q.vwap_for_size is not None else q.price
        fee = fee_per_share(entry, q.fee_rate, q.fee_exponent)
        cost = entry + (fee or 0.0) + cfg.slippage_buffer
        lows = [token_prob_low(e, q.candidate, q.outcome) for e in ok]
        lows_ok = [x for x in lows if x is not None]
        cons_edge = (min(lows_ok) - cost) * 100 if lows_ok else None
        gating = gating_reasons(contest, q, validation, as_of, cfg, fee, cons_edge, len(ok))
        decisions.append(
            Decision(
                quote=q,
                reference_prob=round(ref, 6),
                discrepancy_pp=round(disc, 3),
                per_estimate=per,
                alert=disc >= cfg.alert_threshold_pp,
                conservative_edge_pp=round(cons_edge, 3) if cons_edge is not None else None,
                cost_per_share=round(cost, 6),
                signal=not gating,
                gating=gating,
            )
        )
    return decisions


def gating_reasons(
    contest: Contest,
    q: Quote,
    validation: ValidationReport,
    as_of: datetime,
    cfg: EngineConfig,
    fee: float | None,
    cons_edge_pp: float | None,
    n_estimates: int,
) -> list[str]:
    r: list[str] = []
    if validation.status != "validado":
        r.append("modelo no validado: " + "; ".join(validation.reasons))
    if q.basis != PRICE_BASIS_ASK:
        r.append(f"precio no ejecutable ({q.basis}): se requiere ask del order book del CLOB")
    if as_of >= contest.polls_close_utc:
        r.append("urnas cerradas")
    if fee is None:
        r.append("modelo de comisión no verificado para este mercado")
    if q.basis == PRICE_BASIS_ASK:
        if not q.fill_complete:
            r.append(f"liquidez insuficiente para US${cfg.order_size_usd:.0f}")
        if q.spread is None or q.spread > cfg.max_spread:
            r.append(f"spread {q.spread} > {cfg.max_spread}")
        if q.book_age_s is None or q.book_age_s > cfg.max_book_age_s:
            r.append(f"libro con antigüedad {q.book_age_s} s > {cfg.max_book_age_s} s")
    if n_estimates < cfg.min_estimates:
        r.append(f"menos de {cfg.min_estimates} estimaciones válidas")
    if cons_edge_pp is None or cons_edge_pp <= cfg.min_conservative_edge_pp:
        r.append(f"ventaja conservadora {cons_edge_pp} p.p. no positiva tras costos")
    return r
