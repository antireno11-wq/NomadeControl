"""Ajuste y evaluación de ``cripto2-vol`` (``crypto-eval-v2``).

Reglas en ``docs/PREREGISTRO_CRIPTO_V2.md``. Usa las mismas instancias y particiones que
``crypto-backtest-v1``:

- ``k_evento`` y ν se ajustan con entrenamiento;
- la recalibración, con entrenamiento + validación;
- la prueba se mide una sola vez (``evaluate_test=True``) contra los criterios de v1, contra
  el precio del mercado y contra la referencia v1 de cada variante.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
from scipy.optimize import minimize

from radar.predict import metrics as MX
from radar.predict.base import CALIB_NOT_VALIDATED, CALIB_VALIDATED
from radar.predict.crypto.backtest import (
    CRITERIA,
    TRAIN_END,
    VALID_END,
    Instance,
    _criteria_failures,
    build_instances,
)
from radar.predict.crypto.binance import MINUTE_MS
from radar.predict.crypto.events import ALL_EVENTS, EVENT_MINUTES
from radar.predict.crypto.predictor import BUCKETS, CryptoEvidence, CryptoParams, CryptoPredictor
from radar.predict.crypto.v2 import (
    NU_GRID,
    VOL_NAME,
    CryptoV2Params,
    VolV2Predictor,
    build_profile,
    deseasonalized_ewma,
    logit,
    returns_with_time,
)
from radar.timeutil import utcnow

EVAL_V2_VERSION = "crypto-eval-v2"
V2_KEY = VOL_NAME
MIN_PAIRED = 30


def _predict(
    instances: list[Instance], pred: CryptoPredictor, key: str, evidence: CryptoEvidence
) -> Counter[str]:
    abst: Counter[str] = Counter()
    order = sorted(range(len(instances)), key=lambda i: (instances[i].symbol, instances[i].as_of))
    for i in order:
        x = instances[i]
        out = pred.predict_terms(x.market, x.terms, evidence, x.as_of)
        if out.probability is None:
            abst[f"{key}: {out.abstain_reason}"] += 1
            continue
        lo, hi = out.interval or (out.probability, out.probability)
        x.preds[key] = (out.probability, lo, hi)
    return abst


# --- 1. k_evento (solo velas de entrenamiento) --------------------------------------------------


def fit_k_event(evidence: CryptoEvidence, params: CryptoParams) -> tuple[float, dict[str, Any]]:
    hl = params.ewma_halflife_min.get("<=2h", 1440)
    ratios: list[float] = []
    rows: list[dict[str, Any]] = []
    for t_ev, kind in ALL_EVENTS:
        if t_ev + timedelta(minutes=EVENT_MINUTES) > TRAIN_END:
            continue
        t_ms = int(t_ev.timestamp() * 1000)
        for sym, c in sorted(evidence.candles.items()):
            before = c.until(t_ev)
            if not len(before):
                continue
            day0 = datetime(t_ev.year, t_ev.month, t_ev.day, tzinfo=UTC)
            prof = build_profile(c, day0)
            if prof is None:
                continue
            base = deseasonalized_ewma(before, hl, prof)
            if base is None:
                continue
            expected = (
                base.var_per_min
                * prof.mean_over(t_ms, t_ms + EVENT_MINUTES * MINUTE_MS)
                * EVENT_MINUTES
            )
            r, _t = returns_with_time(
                c.between_ms(t_ms - MINUTE_MS, t_ms + EVENT_MINUTES * MINUTE_MS)
            )
            if r.size < 0.8 * EVENT_MINUTES / 5 or expected <= 0:
                continue
            ratio = float(np.sum(r * r)) / expected
            ratios.append(ratio)
            rows.append({"evento": kind, "t": t_ev.isoformat(), "simbolo": sym,
                         "cociente": round(ratio, 4)})  # fmt: skip
    k = max(0.0, float(np.median(ratios)) - 1.0) if ratios else 0.0
    return k, {"n": len(ratios), "mediana_cociente": float(np.median(ratios)) if ratios else None,
               "eventos": rows}  # fmt: skip


# --- 2. ν por tramo (entrenamiento) ------------------------------------------------------------


def fit_nu(
    train: list[Instance], evidence: CryptoEvidence, params: CryptoParams, v2: CryptoV2Params
) -> tuple[dict[str, float | None], dict[str, Any]]:
    rows = [x for x in train if x.terms.kind != "touch"]
    trace: dict[str, dict[str, Any]] = defaultdict(dict)
    for nu in NU_GRID:
        cand = replace(v2, nu=dict.fromkeys(BUCKETS, nu))
        sub = [replace(x, preds={}) for x in rows]
        _predict(sub, VolV2Predictor(params, cand, apply_recal=False), "p", evidence)
        for b in BUCKETS:
            got = [x for x in sub if x.bucket == b and "p" in x.preds]
            if got:
                ll = MX.log_loss(np.array([x.preds["p"][0] for x in got]),
                                 np.array([x.y for x in got]))  # fmt: skip
                trace[b]["inf" if nu is None else str(nu)] = {"log_loss": ll, "n": len(got)}
    chosen: dict[str, float | None] = {}
    for b in BUCKETS:
        cands = trace.get(b) or {}
        if not cands:
            chosen[b] = None
            continue
        best = min(cands, key=lambda k: cands[k]["log_loss"])
        chosen[b] = None if best == "inf" else float(best)
    return chosen, dict(trace)


# --- 3. recalibración (entrenamiento + validación) -----------------------------------------------


def fit_logistic(p: np.ndarray, y: np.ndarray) -> list[float]:
    x = np.array([logit(float(v)) for v in p])

    def nll(w: np.ndarray) -> float:
        z = w[0] + w[1] * x
        return float(np.sum(np.logaddexp(0.0, z) - y * z))

    res = minimize(nll, np.array([0.0, 1.0]), method="BFGS")
    return [float(res.x[0]), float(res.x[1])]


def fit_recal(
    rows: list[Instance], evidence: CryptoEvidence, params: CryptoParams, v2: CryptoV2Params
) -> tuple[dict[str, list[float]], dict[str, Any]]:
    sub = [replace(x, preds={}) for x in rows]
    _predict(sub, VolV2Predictor(params, v2, apply_recal=False), "p", evidence)
    out: dict[str, list[float]] = {}
    trace: dict[str, Any] = {}
    for b in BUCKETS:
        got = [x for x in sub if x.bucket == b and "p" in x.preds]
        if len(got) < 200:
            out[b] = [0.0, 1.0]
            trace[b] = {"n": len(got), "nota": "menos de 200 instancias: sin recalibrar"}
            continue
        p = np.array([x.preds["p"][0] for x in got])
        y = np.array([x.y for x in got])
        out[b] = fit_logistic(p, y)
        trace[b] = {"n": len(got), "a_b": out[b]}
    return out, trace


def fit_v2(
    train: list[Instance], valid: list[Instance], evidence: CryptoEvidence, params: CryptoParams
) -> tuple[CryptoV2Params, dict[str, Any]]:
    k, k_trace = fit_k_event(evidence, params)
    v2 = CryptoV2Params(base_params_sha256=params.sha256(), k_event=k)
    nu, nu_trace = fit_nu(train, evidence, params, v2)
    v2 = replace(v2, nu=nu)
    recal, recal_trace = fit_recal(train + valid, evidence, params, v2)
    v2 = replace(
        v2,
        version=f"crypto-params-v2-fit-{VALID_END:%Y%m%d}",
        recal=recal,
        fitted_on={
            "k_evento_y_nu": f"entrenamiento (resolución < {TRAIN_END.isoformat()})",
            "recalibracion": f"entrenamiento + validación (resolución < {VALID_END.isoformat()})",
            "fitted_at": utcnow().isoformat(),
        },
        notes=[
            "k_evento: mediana de (var. realizada / esperada) − 1 en la hora de cada evento",
            "nu: mínimo log loss en entrenamiento por tramo (None = normal)",
            "recal: logística a + b·logit(p) por tramo, máxima verosimilitud",
        ],
    )
    return v2, {"k_evento": k_trace, "nu": nu_trace, "recal": recal_trace}


# --- 4. evaluación ---------------------------------------------------------------------------


def _paired(rows: list[Instance], a: str, b: str | None) -> dict[str, Any] | None:
    both = [
        x for x in rows if a in x.preds and (x.price is not None if b is None else b in x.preds)
    ]
    if len(both) < MIN_PAIRED:
        return None
    pa = np.array([x.preds[a][0] for x in both])
    pb = np.array([x.price if b is None else x.preds[b][0] for x in both])
    y = np.array([x.y for x in both])
    cl = [x.cluster for x in both]
    d = MX.paired_diff(pa, pb, y, cl)
    return {"n": len(both), "conglomerados": len(set(cl)), "log_loss_diff": d}


def evaluate_part(
    rows: list[Instance], train: list[Instance], reference: dict[str, str]
) -> dict[str, Any]:
    base_rate = {
        v: float(np.mean([x.y for x in train if x.variant == v]))
        for v in {x.variant for x in train}
    }
    out: dict[str, Any] = {}
    by_variant: dict[str, list[Instance]] = defaultdict(list)
    for x in rows:
        by_variant[x.variant].append(x)
    for v, sub_all in sorted(by_variant.items()):
        ref_key = f"cripto-{reference.get(v) or 'rv'}"
        sub = [x for x in sub_all if V2_KEY in x.preds]
        res: dict[str, Any] = {"n_instancias": len(sub_all), "referencia_v1": ref_key}
        if sub:
            p = np.array([x.preds[V2_KEY][0] for x in sub])
            y = np.array([x.y for x in sub])
            summ = MX.summarize(p, y, [x.cluster for x in sub])
            br = base_rate.get(v, float("nan"))
            base_brier = float(np.mean((br - y) ** 2)) if not math.isnan(br) else float("nan")
            fails = _criteria_failures(summ, base_brier)
            summ["fallas"] = fails
            summ["estado"] = CALIB_VALIDATED if not fails else CALIB_NOT_VALIDATED
            summ.pop("bins", None)
            res["v2"] = summ
        res["v2_vs_mercado"] = _paired(sub_all, V2_KEY, None)
        res["v2_vs_v1"] = _paired(sub_all, V2_KEY, ref_key)
        res["v1_vs_mercado"] = _paired(sub_all, ref_key, None)
        vs_m = res["v2_vs_mercado"]
        vs_1 = res["v2_vs_v1"]
        res["supera_mercado"] = bool(vs_m and vs_m["log_loss_diff"]["hi"] < 0)
        res["supera_v1"] = bool(vs_1 and vs_1["log_loss_diff"]["hi"] < 0)
        res["peor_que_v1"] = bool(vs_1 and vs_1["log_loss_diff"]["lo"] > 0)
        out[v] = res
    return out


def run_backtest_v2(
    records: list[dict[str, Any]],
    evidence: CryptoEvidence,
    params: CryptoParams,
    reference: dict[str, str],
    *,
    evaluate_test: bool,
) -> tuple[dict[str, Any], CryptoV2Params]:
    """Ajusta v2 con entrenamiento/validación y, solo si se pide, mide la prueba (una vez)."""
    started = utcnow()
    instances, info = build_instances(records, evidence.candles)
    train = [x for x in instances if x.split == "train"]
    valid = [x for x in instances if x.split == "valid"]
    test = [x for x in instances if x.split == "test"]
    v2, trace = fit_v2(train, valid, evidence, params)
    abst: Counter[str] = Counter()
    for part in [valid, test] if evaluate_test else [valid]:
        abst.update(_predict(part, VolV2Predictor(params, v2), V2_KEY, evidence))
        for m in sorted({reference.get(v) or "rv" for v in {x.variant for x in part}}):
            abst.update(_predict(part, CryptoPredictor(m, params), f"cripto-{m}", evidence))
    report: dict[str, Any] = {
        "version": EVAL_V2_VERSION,
        "started_at": started.isoformat(),
        "finished_at": utcnow().isoformat(),
        "counts": {"train": len(train), "valid": len(valid), "test": len(test)},
        "build": info,
        "params_v1_sha256": params.sha256(),
        "params_v2": v2.to_dict(),
        "params_v2_sha256": v2.sha256(),
        "fit_trace": trace,
        "abstenciones": dict(abst.most_common(20)),
        "criterios": CRITERIA,
        "validacion_en_muestra": evaluate_part(valid, train, reference),
        "prueba": evaluate_part(test, train, reference) if evaluate_test else None,
    }
    return report, v2


def _fmt_diff(d: dict[str, Any] | None) -> str:
    if not d:
        return "—"
    x = d["log_loss_diff"]
    return f"{x['value']:+.4f} [{x['lo']:+.4f}; {x['hi']:+.4f}] (n={d['n']})"


def _table(part: dict[str, Any]) -> list[str]:
    lines = [
        "| Variante | n | Log loss v2 | ECE | Estado | v2 − mercado | v2 − v1 (ref.) |",
        "|---|---|---|---|---|---|---|",
    ]
    for v, r in part.items():
        s = r.get("v2") or {}
        ll = s.get("log_loss", {}).get("value")
        ece = s.get("ece", {}).get("value")
        lines.append(
            f"| {v} | {s.get('n', 0)} | {'' if ll is None else f'{ll:.4f}'} | "
            f"{'' if ece is None else f'{ece:.3f}'} | {s.get('estado', '—')} | "
            f"{_fmt_diff(r.get('v2_vs_mercado'))} | {_fmt_diff(r.get('v2_vs_v1'))} "
            f"{r.get('referencia_v1', '')} |"
        )
    return lines


def markdown(report: dict[str, Any]) -> str:
    p = report["params_v2"]
    lines = [
        "# Backtest de `cripto2-vol` (`crypto-eval-v2`)",
        "",
        f"Preregistro: `{report['preregistro']['path']}` "
        f"(SHA-256 `{report['preregistro']['sha256'][:12]}…`). "
        f"Parámetros v2: `{report['params_v2_sha256'][:12]}…`.",
        "",
        "Diferencias de log loss: negativo = v2 mejor. IC del 95 % por conglomerados.",
        "",
        "## Parámetros ajustados",
        "",
        f"- k_evento: {p['k_event']:.3f}",
        f"- ν por tramo (None = normal): {p['nu']}",
        f"- recalibración (a, b) por tramo: {p['recal']}",
        "",
        "## Validación (en muestra para la recalibración: solo control)",
        "",
        *_table(report["validacion_en_muestra"]),
        "",
    ]
    if report.get("prueba") is not None:
        lines += ["## Prueba (una sola vez)", "", *_table(report["prueba"]), ""]
    else:
        lines += ["## Prueba", "", "No medida en esta corrida.", ""]
    return "\n".join(lines)
