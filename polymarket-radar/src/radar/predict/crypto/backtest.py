"""Backtest cronológico de los modelos cripto sobre mercados resueltos (``crypto-backtest-v1``).

Reglas fijadas antes de ejecutar (preregistro):

- **Partición temporal** por instante de predicción y de resolución:
  entrenamiento = resueltos antes de ``TRAIN_END``; validación = predichos desde
  ``TRAIN_END`` y resueltos antes de ``VALID_END``; prueba = predichos desde
  ``VALID_END``. Las instancias que cruzan una frontera se descartan (embargo).
- **Entrenamiento**: se elige la ventana de volatilidad realizada y la vida media
  EWMA por tramo de horizonte (mínimo log loss) y los cuantiles 10/90 del cociente
  volatilidad realizada/estimada para los intervalos.
- **Validación**: se elige, por variante de contrato, el modelo de referencia
  (mínimo log loss entre los que cubren ≥ 90 % de las instancias).
- **Prueba**: se mide una sola vez. Un par (modelo, variante) queda ``validado`` si
  n ≥ 200, ≥ 20 conglomerados, ECE ≤ 0,05, |calibración global| ≤ 0,03 con IC que
  incluye 0, y Brier menor que el de la tasa base de entrenamiento.
  Aparte se informa si supera al mercado (log loss, IC por conglomerados < 0).
- Conglomerado = activo + fecha ET de resolución.
- Resultado = resolución oficial de Polymarket. Se contrasta con el resultado
  recalculado desde las velas de Binance (tasa de coincidencia).
- Precio del mercado = ``/prices-history`` (referencia **no ejecutable**).
- Operaciones simuladas: **hipotéticas**, nunca ganancias realizadas.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from radar.predict import metrics as MX
from radar.predict.base import CALIB_NOT_VALIDATED, CALIB_VALIDATED, MarketView
from radar.predict.crypto import models as M
from radar.predict.crypto.binance import Candles
from radar.predict.crypto.predictor import (
    BUCKETS,
    METHODS,
    CryptoEvidence,
    CryptoParams,
    CryptoPredictor,
)
from radar.predict.crypto.schedule import horizon_bucket
from radar.predict.crypto.terms import CryptoTerms
from radar.timeutil import utcnow

BACKTEST_VERSION = "crypto-backtest-v1"
ET = ZoneInfo("America/New_York")
TRAIN_END = datetime(2026, 8, 1, tzinfo=UTC)
VALID_END = datetime(2026, 9, 15, tzinfo=UTC)
RV_LOOKBACKS_MIN = (1440, 3 * 1440, 7 * 1440, 14 * 1440, 30 * 1440)
EWMA_HALFLIVES_MIN = (360, 1440, 3 * 1440)
CRITERIA = {
    "min_n": 200,
    "min_clusters": 20,
    "max_ece": 0.05,
    "max_abs_calib_in_large": 0.03,
    "brier_below_train_base_rate": True,
}
ALERT_PP = 5.0
SLIPPAGE_BUFFER = 0.01
STAKE_USD = 25.0
MAX_PRICE_AGE = {1: timedelta(minutes=15), 10: timedelta(hours=1), 60: timedelta(hours=6)}


@dataclass
class Instance:
    market_id: str
    event_id: str
    variant: str
    asset: str
    symbol: str
    as_of: datetime
    resolution: datetime
    y: float
    terms: CryptoTerms
    market: MarketView
    price: float | None
    price_t: datetime | None
    fee_rate: float | None
    split: str
    bucket: str
    cluster: str
    preds: dict[str, tuple[float, float, float]] = field(default_factory=dict)


def resolve_from_candles(terms: CryptoTerms, c: Candles, *, shift_min: int = 0) -> float | None:
    """Resultado recalculado con velas de Binance (1, 0 o 0,5); None si faltan datos."""
    if terms.kind == "touch":
        assert terms.window_start and terms.window_end and terms.barrier is not None
        sub = c.between(terms.window_start, terms.window_end)
        expected = int((terms.window_end - terms.window_start).total_seconds() // 60)
        if terms.direction == "high":
            if len(sub) and float(sub.high.max()) >= terms.barrier:
                return 1.0
        elif len(sub) and float(sub.low.min()) <= terms.barrier:
            return 1.0
        return 0.0 if len(sub) >= expected - 5 else None
    assert terms.obs_open and terms.candle
    minutes = 60 if terms.candle == "1h" else 1
    bar = c.bar(terms.obs_open + timedelta(minutes=shift_min), minutes)
    if bar is None:
        return None
    value = bar[3]
    if terms.kind == "terminal":
        ok = True
        if terms.lower is not None:
            ok &= value >= terms.lower if terms.lower_inclusive else value > terms.lower
        if terms.upper is not None:
            ok &= value <= terms.upper if terms.upper_inclusive else value < terms.upper
        return 1.0 if ok else 0.0
    assert terms.ref_open and terms.ref_candle
    if terms.ref_field == "open":
        ref_bar = c.bar(terms.ref_open, 1)
        ref = ref_bar[0] if ref_bar else None
    else:
        ref_bar = c.bar(terms.ref_open + timedelta(minutes=shift_min), 1)
        ref = ref_bar[3] if ref_bar else None
    if ref is None:
        return None
    if value == ref:
        return 1.0 if terms.tie == "up" else 0.5
    return 1.0 if value > ref else 0.0


def price_at(
    points: list[list[float]], t: datetime, max_age: timedelta
) -> tuple[float | None, datetime | None]:
    ts = int(t.timestamp())
    best = None
    for pt, p in points:
        if pt <= ts:
            best = (pt, p)
        else:
            break
    if best is None:
        return None, None
    when = datetime.fromtimestamp(best[0], UTC)
    if t - when > max_age:
        return None, when
    return float(best[1]), when


def _split(as_of: datetime, resolution: datetime) -> str | None:
    if resolution < TRAIN_END:
        return "train"
    if as_of >= TRAIN_END and resolution < VALID_END:
        return "valid"
    if as_of >= VALID_END:
        return "test"
    return None  # cruza una frontera: embargo


def build_instances(
    records: list[dict[str, Any]], candles: dict[str, Candles]
) -> tuple[list[Instance], dict[str, Any]]:
    """Instancias (mercado × as_of) con resultado oficial y precio de referencia."""
    out: list[Instance] = []
    check: dict[str, Counter[str]] = defaultdict(Counter)
    skipped: Counter[str] = Counter()
    for rec in records:
        terms = CryptoTerms.from_dict(rec["terms"])
        c = candles.get(terms.symbol)
        y = float(rec["outcome_yes"])
        # contraste del resultado oficial con el recalculado desde Binance
        if c is not None:
            own = resolve_from_candles(terms, c)
            key = terms.variant
            if own is None:
                check[key]["sin_datos"] += 1
            else:
                check[key]["coincide" if own == y else "difiere"] += 1
            if terms.kind != "touch" and terms.candle == "1m":
                alt = resolve_from_candles(terms, c, shift_min=1)
                if alt is not None:
                    check[key + "|vela_siguiente"]["coincide" if alt == y else "difiere"] += 1
        mv = MarketView(
            market_id=rec["market_id"],
            question=rec["question"],
            description="",
            outcomes=tuple(rec["outcomes"]),
            token_ids=(rec["yes_token"],),
            category="crypto",
            end_date=datetime.fromisoformat(rec["end_date"]) if rec.get("end_date") else None,
        )
        fid = int(rec.get("price_fidelity_min") or 60)
        points = rec.get("price_history") or []
        res_t = terms.resolution_time
        res_date = res_t.astimezone(ET).date().isoformat()
        for s in rec.get("as_of") or []:
            as_of = datetime.fromisoformat(s)
            split = _split(as_of, res_t)
            if split is None:
                skipped["embargo_entre_particiones"] += 1
                continue
            if (
                c is not None
                and terms.kind == "touch"
                and terms.window_start
                and as_of > terms.window_start
            ):
                sub = c.between(terms.window_start, as_of)
                if len(sub) and (
                    (terms.direction == "high" and float(sub.high.max()) >= (terms.barrier or 0))
                    or (terms.direction == "low" and float(sub.low.min()) <= (terms.barrier or 0))
                ):
                    skipped["toque_ya_ocurrido_en_as_of"] += 1
                    continue
            price, pt = price_at(points, as_of, MAX_PRICE_AGE.get(fid, timedelta(hours=6)))
            out.append(
                Instance(
                    market_id=rec["market_id"],
                    event_id=rec["event_id"],
                    variant=terms.variant,
                    asset=terms.asset,
                    symbol=terms.symbol,
                    as_of=as_of,
                    resolution=res_t,
                    y=y,
                    terms=terms,
                    market=mv,
                    price=price,
                    price_t=pt,
                    fee_rate=rec.get("fee_rate"),
                    split=split,
                    bucket=horizon_bucket(res_t - as_of),
                    cluster=f"{terms.asset}|{res_date}",
                )
            )
    agreement = {k: dict(v) for k, v in sorted(check.items())}
    return out, {"resolution_check": agreement, "skipped": dict(skipped)}


def run_predictions(
    instances: list[Instance],
    evidence: CryptoEvidence,
    params: CryptoParams,
    methods: tuple[str, ...] = METHODS,
    *,
    key_prefix: str = "",
) -> Counter[str]:
    """Llena ``inst.preds[prefijo+método] = (p, lo, hi)``; devuelve conteo de abstenciones."""
    abst: Counter[str] = Counter()
    preds = {m: CryptoPredictor(m, params) for m in methods}
    order = sorted(range(len(instances)), key=lambda i: (instances[i].symbol, instances[i].as_of))
    for i in order:
        inst = instances[i]
        for m, pr in preds.items():
            out = pr.predict_terms(inst.market, inst.terms, evidence, inst.as_of)
            if out.probability is None:
                abst[f"{m}: {out.abstain_reason}"] += 1
                continue
            lo, hi = out.interval or (out.probability, out.probability)
            inst.preds[key_prefix + m] = (out.probability, lo, hi)
    return abst


def _ll(p: list[float], y: list[float]) -> float:
    return MX.log_loss(np.array(p), np.array(y))


def fit_params(
    train: list[Instance], evidence: CryptoEvidence, base: CryptoParams
) -> tuple[CryptoParams, dict[str, Any]]:
    """Ajuste con entrenamiento: ventanas por tramo y cocientes para intervalos."""
    trace: dict[str, Any] = {"rv": {}, "ewma": {}}
    rv_choice: dict[str, int] = {}
    ewma_choice: dict[str, int] = {}
    by_bucket: dict[str, list[Instance]] = defaultdict(list)
    for inst in train:
        by_bucket[inst.bucket].append(inst)
    for method, grid, choice, attr in (
        ("rv", RV_LOOKBACKS_MIN, rv_choice, "rv_lookback_min"),
        ("ewma", EWMA_HALFLIVES_MIN, ewma_choice, "ewma_halflife_min"),
    ):
        for cand in grid:
            params = replace(base, **{attr: dict.fromkeys(BUCKETS, cand)})
            sub = [replace(x, preds={}) for x in train]
            run_predictions(sub, evidence, params, (method,))
            for b in BUCKETS:
                rows = [x for x in sub if x.bucket == b and method in x.preds]
                if not rows:
                    continue
                ll = _ll([x.preds[method][0] for x in rows], [x.y for x in rows])
                trace[method].setdefault(b, {})[str(cand)] = {"log_loss": ll, "n": len(rows)}
        for b in BUCKETS:
            cands = trace[method].get(b) or {}
            if cands:
                choice[b] = int(min(cands, key=lambda k: cands[k]["log_loss"]))
    fitted = replace(
        base,
        version=f"crypto-params-fit-{TRAIN_END:%Y%m%d}",
        fitted_on={"split": "train", "resolution_before": TRAIN_END.isoformat()},
        rv_lookback_min={b: rv_choice.get(b, base.rv_lookback_min[b]) for b in BUCKETS},
        ewma_halflife_min={b: ewma_choice.get(b, base.ewma_halflife_min[b]) for b in BUCKETS},
    )
    fitted.vol_ratio_q, trace["vol_ratio"] = vol_ratio_quantiles(train, evidence, fitted)
    fitted.notes = [
        "ventanas elegidas por mínimo log loss en entrenamiento, por tramo de horizonte",
        "intervalos: cuantiles 10/90 del cociente vol. realizada / vol. estimada (entrenamiento)",
    ]
    return fitted, trace


def vol_ratio_quantiles(
    train: list[Instance], evidence: CryptoEvidence, params: CryptoParams
) -> tuple[dict[str, dict[str, list[float]]], dict[str, Any]]:
    """Cociente sqrt(varianza realizada futura / varianza pronosticada) por método y tramo."""
    seen: set[tuple[str, datetime, datetime]] = set()
    ratios: dict[str, dict[str, list[float]]] = {m: defaultdict(list) for m in METHODS}
    for inst in train:
        key = (inst.symbol, inst.as_of, inst.resolution)
        if key in seen:
            continue
        seen.add(key)
        full = evidence.candles.get(inst.symbol)
        if full is None:
            continue
        fut = full.between(inst.as_of, inst.resolution)
        if len(fut) < 3:
            continue
        r = np.diff(np.log(fut.close))
        tau = (inst.resolution - inst.as_of).total_seconds() / 60
        realized = float(np.sum(r * r))
        past = full.until(inst.as_of)
        forecasts = {
            "rv": M.realized_var(past, params.rv_lookback_min[inst.bucket]),
            "ewma": M.ewma_var(past, params.ewma_halflife_min[inst.bucket]),
            "bootstrap": M.realized_var(past, params.bootstrap_lookback_min),
        }
        dv = evidence.dvol.get(inst.asset)
        got = dv.at(inst.as_of) if dv is not None else None
        if got is not None:
            forecasts["dvol"] = M.dvol_var(got[0])
        for m, est in forecasts.items():
            if est is not None and est.var_per_min > 0:
                ratios[m][inst.bucket].append(math.sqrt(realized / (est.var_per_min * tau)))
    out: dict[str, dict[str, list[float]]] = {}
    trace: dict[str, Any] = {}
    for m in METHODS:
        out[m] = {}
        for b in BUCKETS:
            vals = ratios[m].get(b) or []
            if len(vals) >= 30:
                q10, q50, q90 = (float(x) for x in np.quantile(vals, [0.1, 0.5, 0.9]))
                out[m][b] = [q10, q90]
                trace[f"{m}|{b}"] = {"n": len(vals), "q10": q10, "q50": q50, "q90": q90}
            else:
                out[m][b] = [0.75, 1.35]
                trace[f"{m}|{b}"] = {"n": len(vals), "nota": "insuficiente: valor por defecto"}
    return out, trace


def _arrays(rows: list[Instance], key: str) -> tuple[np.ndarray, np.ndarray, list[str]]:
    return (
        np.array([x.preds[key][0] for x in rows]),
        np.array([x.y for x in rows]),
        [x.cluster for x in rows],
    )


def choose_reference(valid: list[Instance]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    by_variant: dict[str, list[Instance]] = defaultdict(list)
    for x in valid:
        by_variant[x.variant].append(x)
    for v, rows in sorted(by_variant.items()):
        scores = {}
        for m in METHODS:
            sub = [x for x in rows if m in x.preds]
            if len(sub) < 0.9 * len(rows) or not sub:
                continue
            scores[m] = {"log_loss": _ll([x.preds[m][0] for x in sub], [x.y for x in sub]),
                         "n": len(sub)}  # fmt: skip
        best = min(scores, key=lambda k: scores[k]["log_loss"]) if scores else None
        out[v] = {"reference": best, "scores": scores, "n": len(rows)}
    return out


def evaluate_test(test: list[Instance], train: list[Instance], n_boot: int = 500) -> dict[str, Any]:
    """Métricas de prueba por variante y modelo, validación y comparación con el mercado."""
    base_rate: dict[str, float] = {}
    for v in {x.variant for x in train}:
        ys = [x.y for x in train if x.variant == v]
        base_rate[v] = float(np.mean(ys)) if ys else float("nan")
    out: dict[str, Any] = {}
    status: dict[str, str] = {}
    by_variant: dict[str, list[Instance]] = defaultdict(list)
    for x in test:
        by_variant[x.variant].append(x)
    for v, rows in sorted(by_variant.items()):
        res: dict[str, Any] = {"n_instances": len(rows), "models": {}}
        with_price = [x for x in rows if x.price is not None]
        if with_price:
            p = np.array([x.price for x in with_price])
            y = np.array([x.y for x in with_price])
            cl = [x.cluster for x in with_price]
            res["market"] = MX.summarize(p, y, cl, n_boot=n_boot)
        for m in METHODS:
            sub = [x for x in rows if m in x.preds]
            if not sub:
                continue
            p, y, cl = _arrays(sub, m)
            summ = MX.summarize(p, y, cl, n_boot=n_boot)
            br = base_rate.get(v, float("nan"))
            base_brier = float(np.mean((br - y) ** 2)) if not math.isnan(br) else float("nan")
            summ["brier_base_rate_train"] = base_brier
            lo_hi = np.array([[x.preds[m][1], x.preds[m][2]] for x in sub])
            summ["interval_mean_width"] = float(np.mean(lo_hi[:, 1] - lo_hi[:, 0]))
            fails = _criteria_failures(summ, base_brier)
            summ["validation_failures"] = fails
            st = CALIB_VALIDATED if not fails else CALIB_NOT_VALIDATED
            summ["status"] = st
            status[f"cripto-{m}|{v}"] = st
            both = [x for x in sub if x.price is not None]
            if len(both) >= 30:
                pm, ym, clm = _arrays(both, m)
                pk = np.array([x.price for x in both])
                summ["vs_market"] = {
                    "n": len(both),
                    "log_loss_diff": MX.paired_diff(pm, pk, ym, clm, n_boot=n_boot),
                    "brier_diff": MX.paired_diff(pm, pk, ym, clm, MX.brier, n_boot=n_boot),
                }
                d = summ["vs_market"]["log_loss_diff"]
                summ["supera_mercado"] = bool(d["hi"] < 0)
            res["models"][m] = summ
        out[v] = res
    return {"by_variant": out, "status": status, "criteria": CRITERIA}


def _criteria_failures(s: dict[str, Any], base_brier: float) -> list[str]:
    fails = []
    if s["n"] < CRITERIA["min_n"]:
        fails.append(f"n={s['n']} < {CRITERIA['min_n']}")
    if s["n_clusters"] < CRITERIA["min_clusters"]:
        fails.append(f"conglomerados={s['n_clusters']} < {CRITERIA['min_clusters']}")
    if s["ece"]["value"] > CRITERIA["max_ece"]:
        fails.append(f"ECE={s['ece']['value']:.3f} > {CRITERIA['max_ece']}")
    cil = s["calib_in_large"]
    if abs(cil["value"]) > CRITERIA["max_abs_calib_in_large"] or not (cil["lo"] <= 0 <= cil["hi"]):
        fails.append(
            f"calibración global {cil['value']:+.3f} (IC {cil['lo']:+.3f}…{cil['hi']:+.3f})"
        )
    if not (s["brier"]["value"] < base_brier):
        fails.append(f"Brier {s['brier']['value']:.4f} >= tasa base {base_brier:.4f}")
    return fails


def fee_per_share(price: float, rate: float | None) -> float:
    return 0.0 if not rate else rate * price * (1 - price)


def hypothetical_trades(test: list[Instance], reference: dict[str, Any]) -> dict[str, Any]:
    """Operaciones HIPOTÉTICAS en prueba con el modelo de referencia de cada variante.

    Precio = referencia no ejecutable del mercado + comisión del mercado + 0,01 de
    holgura. Una operación por mercado (primer as_of que cumple). Señal si la
    discrepancia bruta ≥ 5 p.p. y la ventaja conservadora (cota del intervalo) > 0.
    """
    trades = []
    done: set[str] = set()
    for x in sorted(test, key=lambda r: r.as_of):
        ref = (reference.get(x.variant) or {}).get("reference")
        if ref is None or ref not in x.preds or x.price is None or x.market_id in done:
            continue
        p, lo, hi = x.preds[ref]
        for side, prob, cons, price in (
            ("YES", p, lo, x.price),
            ("NO", 1 - p, 1 - hi, 1 - x.price),
        ):
            if not (0.01 <= price <= 0.99):
                continue
            cost = price + fee_per_share(price, x.fee_rate) + SLIPPAGE_BUFFER
            if (prob - price) * 100 >= ALERT_PP and cons - cost > 0:
                shares = STAKE_USD / cost
                payoff = x.y if side == "YES" else 1 - x.y
                pnl = shares * payoff - STAKE_USD
                trades.append(
                    {
                        "market_id": x.market_id,
                        "variant": x.variant,
                        "asset": x.asset,
                        "as_of": x.as_of.isoformat(),
                        "side": side,
                        "model": ref,
                        "prob": round(prob, 4),
                        "prob_conservative": round(cons, 4),
                        "ref_price": round(price, 4),
                        "cost_per_share": round(cost, 4),
                        "outcome": payoff,
                        "pnl_hypothetical": round(pnl, 4),
                        "cluster": x.cluster,
                    }
                )
                done.add(x.market_id)
                break
    pnl = np.array([t["pnl_hypothetical"] for t in trades])
    equity = np.cumsum(pnl) if pnl.size else np.array([0.0])
    peak = np.maximum.accumulate(np.concatenate([[0.0], equity]))
    drawdown = float(np.max(peak[1:] - equity)) if pnl.size else 0.0
    by_variant: dict[str, dict[str, float]] = defaultdict(lambda: {"n": 0, "pnl": 0.0, "wins": 0})
    for t in trades:
        b = by_variant[t["variant"]]
        b["n"] += 1
        b["pnl"] += t["pnl_hypothetical"]
        b["wins"] += int(t["pnl_hypothetical"] > 0)
    ci = (
        MX.cluster_bootstrap(lambda i: float(np.mean(pnl[i])), [t["cluster"] for t in trades])
        if len(trades) >= 2
        else None
    )
    return {
        "label": "HIPOTÉTICO: precio de referencia no ejecutable; no son ganancias realizadas",
        "rules": {
            "alerta_pp": ALERT_PP,
            "holgura": SLIPPAGE_BUFFER,
            "monto_usd": STAKE_USD,
            "una_por_mercado": True,
        },
        "n_trades": len(trades),
        "total_pnl": float(pnl.sum()) if pnl.size else 0.0,
        "staked": STAKE_USD * len(trades),
        "mean_pnl_ci": ci.to_dict() if ci else None,
        "hit_rate": float(np.mean(pnl > 0)) if pnl.size else None,
        "max_drawdown": drawdown,
        "by_variant": {k: dict(v) for k, v in by_variant.items()},
        "trades": trades[:500],
    }


def market_vs_model_by_bucket(test: list[Instance], reference: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    groups: dict[str, list[Instance]] = defaultdict(list)
    for x in test:
        ref = (reference.get(x.variant) or {}).get("reference")
        if ref and ref in x.preds and x.price is not None:
            groups[x.bucket].append(x)
    for b, rows in sorted(groups.items()):
        y = np.array([x.y for x in rows])
        pm = np.array([x.preds[(reference[x.variant]["reference"])][0] for x in rows])
        pk = np.array([x.price for x in rows])
        out[b] = {
            "n": len(rows),
            "brier_model": MX.brier(pm, y),
            "brier_market": MX.brier(pk, y),
            "log_loss_model": MX.log_loss(pm, y),
            "log_loss_market": MX.log_loss(pk, y),
        }
    return out


def run_backtest(
    records: list[dict[str, Any]],
    evidence: CryptoEvidence,
    *,
    base: CryptoParams | None = None,
    n_boot: int = 500,
) -> tuple[dict[str, Any], CryptoParams]:
    started = utcnow()
    instances, info = build_instances(records, evidence.candles)
    splits = Counter(x.split for x in instances)
    train = [x for x in instances if x.split == "train"]
    valid = [x for x in instances if x.split == "valid"]
    test = [x for x in instances if x.split == "test"]
    params, fit_trace = fit_params(train, evidence, base or CryptoParams())
    abst = Counter()
    for part in (train, valid, test):
        abst.update(run_predictions(part, evidence, params))
    reference = choose_reference(valid)
    evaluation = evaluate_test(test, train, n_boot=n_boot)
    report = {
        "version": BACKTEST_VERSION,
        "started_at": started.isoformat(),
        "finished_at": utcnow().isoformat(),
        "splits": {
            "train": f"resolución < {TRAIN_END.isoformat()}",
            "valid": f"as_of >= {TRAIN_END.isoformat()} y resolución < {VALID_END.isoformat()}",
            "test": f"as_of >= {VALID_END.isoformat()}",
            "counts": dict(splits),
            "markets_by_split": {
                s: len({x.market_id for x in instances if x.split == s}) for s in splits
            },
            "clusters_by_split": {
                s: len({x.cluster for x in instances if x.split == s}) for s in splits
            },
        },
        "instances": len(instances),
        "instances_with_market_price": sum(1 for x in instances if x.price is not None),
        "build": info,
        "params": params.to_dict(),
        "fit_trace": fit_trace,
        "abstentions": dict(abst.most_common(30)),
        "reference_by_variant": reference,
        "test": evaluation,
        "test_by_bucket": market_vs_model_by_bucket(test, reference),
        "hypothetical": hypothetical_trades(test, reference),
    }
    return report, params
