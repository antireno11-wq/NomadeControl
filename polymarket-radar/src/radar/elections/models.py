"""Modelos de probabilidad para contiendas de dos candidatos a partir de encuestas.

Todo es determinista dada una semilla y solo usa encuestas disponibles en el
instante de evaluación (lo garantiza quien llama: ver ``backtest``).

Componentes
-----------
1. **Promedios** del voto bipartidista de A, ``s = A / (A + B)``:
   - ``weighted``: última encuesta de cada encuestadora en una ventana, con peso
     ``0.5^(edad/vida_media) · sqrt(n/1000)``.
   - ``median``: mediana de la última encuesta de cada encuestadora en 14 días.
2. **Modelo de error** del promedio frente al resultado, calibrado con
   contiendas históricas: para cada horizonte ``d`` (días antes del cierre) se
   mide ``e = promedio_d − resultado``. ``σ²(d) = σ0² + k·d`` se ajusta por
   mínimos cuadrados no negativos sobre los errores al cuadrado (sin corregir
   sesgo: el sesgo se cuenta como error, lo que es conservador).
3. **Probabilidad** ``P(A gana) = P(s + e > 0.5)`` por Monte Carlo:
   - ``t``: ``e ~ σ · t_ν · sqrt((ν−2)/ν)`` con ν = 4 (colas pesadas).
   - ``empirical``: ``e`` remuestreado de los errores históricos observados al
     horizonte más cercano, reflejados ``±|e|`` (no se asume la dirección del sesgo).
   La incertidumbre de la calibración se propaga con bootstrap de contiendas:
   el intervalo es el percentil 5–95 de ``P(A gana)`` entre réplicas.
4. **Validación** (criterios fijados antes de ver el resultado de 2026): dejar
   una contienda fuera, Brier y cobertura de intervalos del voto. Un modelo solo
   está ``validado`` si cumple todos los criterios de ``VALIDATION_CRITERIA``.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

MODEL_VERSION = "electoral-2t-v1"
HORIZONS_DAYS: tuple[float, ...] = (0, 1, 2, 3, 5, 7, 10, 14, 21)
T_NU = 4.0
DEFAULT_DRAWS = 20_000
DEFAULT_BOOT = 400

# Criterios de validación fijados de antemano (versión electoral-2t-v1).
VALIDATION_CRITERIA = {
    "min_contests": 15,
    "max_brier_vs_coin": 0.23,  # Brier medio fuera de muestra < 0.23 (moneda = 0.25)
    "coverage90_range": (0.80, 0.97),  # cobertura del intervalo 90 % del voto
    "coverage50_range": (0.35, 0.65),
}


@dataclass(frozen=True)
class PollObs:
    pollster: str
    fieldwork_end: date
    two_party_a: float
    sample_size: int | None
    key: str


@dataclass(frozen=True)
class Average:
    method: str
    value: float | None
    n_polls: int
    n_pollsters: int
    used_keys: tuple[str, ...]
    newest_fieldwork_end: date | None
    reason: str | None = None  # motivo si value es None


def _latest_per_pollster(polls: Sequence[PollObs], as_of: date, window_days: int) -> list[PollObs]:
    cutoff = as_of - timedelta(days=window_days)
    latest: dict[str, PollObs] = {}
    for p in polls:
        if p.fieldwork_end > as_of or p.fieldwork_end < cutoff:
            continue
        name = " ".join(p.pollster.lower().split())
        cur = latest.get(name)
        if cur is None or (p.fieldwork_end, p.key) > (cur.fieldwork_end, cur.key):
            latest[name] = p
    return sorted(latest.values(), key=lambda p: (p.fieldwork_end, p.key))


def weighted_average(
    polls: Sequence[PollObs], as_of: date, *, half_life_days: float = 7.0, window_days: int = 30
) -> Average:
    chosen = _latest_per_pollster(polls, as_of, window_days)
    if not chosen:
        return Average("weighted", None, 0, 0, (), None, "sin encuestas en la ventana")
    num = den = 0.0
    for p in chosen:
        age = (as_of - p.fieldwork_end).days
        n = min(p.sample_size or 1000, 5000)
        w = 0.5 ** (age / half_life_days) * math.sqrt(n / 1000)
        num += w * p.two_party_a
        den += w
    return Average(
        "weighted",
        num / den,
        len(chosen),
        len(chosen),
        tuple(p.key for p in chosen),
        max(p.fieldwork_end for p in chosen),
    )


def pollster_median(polls: Sequence[PollObs], as_of: date, *, window_days: int = 14) -> Average:
    chosen = _latest_per_pollster(polls, as_of, window_days)
    if len(chosen) < 3:
        return Average(
            "median",
            None,
            len(chosen),
            len(chosen),
            tuple(p.key for p in chosen),
            max((p.fieldwork_end for p in chosen), default=None),
            "menos de 3 encuestadoras en 14 días",
        )
    return Average(
        "median",
        statistics.median(p.two_party_a for p in chosen),
        len(chosen),
        len(chosen),
        tuple(p.key for p in chosen),
        max(p.fieldwork_end for p in chosen),
    )


AVERAGERS = {"weighted": weighted_average, "median": pollster_median}


# ---------------------------------------------------------------- calibración
@dataclass(frozen=True)
class CalibContest:
    key: str
    close: datetime
    result_two_party_a: float
    polls: tuple[PollObs, ...]
    availability_lag_days: int = 1  # encuesta disponible al día siguiente del fin de campo
    source: str = ""


def historical_errors(
    contest: CalibContest, method: str, horizons: Sequence[float] = HORIZONS_DAYS
) -> list[tuple[float, float]]:
    """(horizonte en días, error del promedio) usando solo encuestas disponibles."""
    out = []
    for d in horizons:
        cutoff = (contest.close - timedelta(days=d)).date()
        avail = [
            p
            for p in contest.polls
            if p.fieldwork_end + timedelta(days=contest.availability_lag_days) <= cutoff
        ]
        avg = AVERAGERS[method](avail, cutoff)
        if avg.value is not None:
            out.append((float(d), avg.value - contest.result_two_party_a))
    return out


@dataclass
class ErrorModel:
    method: str
    s0_sq: float
    k: float
    errors: dict[str, list[tuple[float, float]]] = field(default_factory=dict)

    @property
    def n_contests(self) -> int:
        return len([v for v in self.errors.values() if v])

    def sigma(self, d: float) -> float:
        return math.sqrt(max(self.s0_sq + self.k * max(d, 0.0), 1e-8))

    def empirical(self, d: float) -> np.ndarray:
        vals = []
        for errs in self.errors.values():
            if not errs:
                continue
            nearest = min(errs, key=lambda x: (abs(x[0] - d), x[0]))
            vals.append(abs(nearest[1]))
        arr = np.array(vals, dtype=float)
        return np.concatenate([arr, -arr]) if arr.size else arr


def _fit_variance(errors: dict[str, list[tuple[float, float]]]) -> tuple[float, float]:
    """σ²(d) = s0² + k·d por mínimos cuadrados no negativos sobre e²."""
    pts = [(d, e * e) for errs in errors.values() for d, e in errs]
    if not pts:
        return float("nan"), float("nan")
    x = np.array([p[0] for p in pts])
    y = np.array([p[1] for p in pts])
    if len(set(x.tolist())) < 2:
        return float(y.mean()), 0.0
    a = np.vstack([np.ones_like(x), x]).T
    (s0, k), *_ = np.linalg.lstsq(a, y, rcond=None)
    if k < 0:  # restricción k >= 0
        return float(y.mean()), 0.0
    if s0 < 0:
        k = float((x * y).sum() / (x * x).sum())
        return 0.0, k
    return float(s0), float(k)


def fit_error_model(
    contests: Sequence[CalibContest], method: str, horizons: Sequence[float] = HORIZONS_DAYS
) -> ErrorModel:
    errors = {c.key: historical_errors(c, method, horizons) for c in contests}
    s0, k = _fit_variance(errors)
    return ErrorModel(method, s0, k, errors)


def bootstrap_sigmas(
    model: ErrorModel, d: float, rng: np.random.Generator, n_boot: int = DEFAULT_BOOT
) -> np.ndarray:
    """σ(d) en réplicas bootstrap remuestreando contiendas completas."""
    keys = [k for k, v in model.errors.items() if v]
    if not keys:
        return np.array([])
    out = np.empty(n_boot)
    for b in range(n_boot):
        pick = rng.choice(len(keys), size=len(keys), replace=True)
        sub = {f"{i}-{keys[j]}": model.errors[keys[j]] for i, j in enumerate(pick)}
        s0, k = _fit_variance(sub)
        out[b] = math.sqrt(max(s0 + k * max(d, 0.0), 1e-8))
    return out


# ---------------------------------------------------------------- probabilidad
@dataclass(frozen=True)
class ProbResult:
    prob_a: float
    prob_a_low: float
    prob_a_high: float
    sigma: float
    draws: int
    seed: int


def prob_t(
    avg: float, sigma_boot: np.ndarray, *, seed: int, draws: int = DEFAULT_DRAWS, nu: float = T_NU
) -> ProbResult:
    rng = np.random.default_rng(seed)
    scale = math.sqrt((nu - 2) / nu)
    per_rep = max(draws // max(len(sigma_boot), 1), 50)
    probs = np.empty(len(sigma_boot))
    for i, s in enumerate(sigma_boot):
        e = s * scale * rng.standard_t(nu, size=per_rep)
        probs[i] = float(np.mean(avg + e > 0.5))
    return ProbResult(
        prob_a=float(probs.mean()),
        prob_a_low=float(np.percentile(probs, 5)),
        prob_a_high=float(np.percentile(probs, 95)),
        sigma=float(np.median(sigma_boot)),
        draws=per_rep * len(sigma_boot),
        seed=seed,
    )


def prob_empirical(
    avg: float, model: ErrorModel, d: float, *, seed: int, n_boot: int = DEFAULT_BOOT
) -> ProbResult | None:
    errs = model.empirical(d)
    if errs.size == 0:
        return None
    rng = np.random.default_rng(seed)
    base = float(np.mean(avg + errs > 0.5))
    reps = np.empty(n_boot)
    for b in range(n_boot):
        sample = rng.choice(errs, size=errs.size, replace=True)
        reps[b] = float(np.mean(avg + sample > 0.5))
    return ProbResult(
        prob_a=base,
        prob_a_low=float(np.percentile(reps, 5)),
        prob_a_high=float(np.percentile(reps, 95)),
        sigma=float(np.sqrt(np.mean(errs**2))),
        draws=int(errs.size),
        seed=seed,
    )


# ---------------------------------------------------------------- validación
@dataclass
class ValidationReport:
    method: str
    n_contests: int
    forecasts: list[dict[str, object]]
    brier: float | None
    log_loss: float | None
    coverage50: float | None
    coverage90: float | None
    status: str  # "validado" | "no_validado"
    reasons: list[str]
    criteria: dict[str, object] = field(default_factory=lambda: dict(VALIDATION_CRITERIA))


def validate_loo(
    contests: Sequence[CalibContest],
    method: str,
    horizons: Sequence[float] = (1, 7, 14),
    *,
    seed: int = 7,
) -> ValidationReport:
    """Validación dejando una contienda fuera (nunca usa la contienda evaluada)."""
    forecasts: list[dict[str, object]] = []
    for i, c in enumerate(contests):
        others = [o for j, o in enumerate(contests) if j != i]
        model = fit_error_model(others, method)
        if model.n_contests == 0:
            continue
        rng = np.random.default_rng(seed + i)
        for d in horizons:
            cutoff = (c.close - timedelta(days=d)).date()
            avail = [
                p
                for p in c.polls
                if p.fieldwork_end + timedelta(days=c.availability_lag_days) <= cutoff
            ]
            avg = AVERAGERS[method](avail, cutoff)
            if avg.value is None:
                continue
            sig = bootstrap_sigmas(model, d, rng, n_boot=100)
            pr = prob_t(avg.value, sig, seed=seed + i * 100 + int(d), draws=10_000)
            sigma = model.sigma(d)
            outcome = 1.0 if c.result_two_party_a > 0.5 else 0.0
            z50, z90 = 0.6745, 1.6449
            forecasts.append(
                {
                    "contest": c.key,
                    "horizon_days": d,
                    "avg": avg.value,
                    "result": c.result_two_party_a,
                    "prob_a": pr.prob_a,
                    "outcome_a": outcome,
                    "in50": abs(c.result_two_party_a - avg.value) <= z50 * sigma,
                    "in90": abs(c.result_two_party_a - avg.value) <= z90 * sigma,
                }
            )
    reasons: list[str] = []
    n = len({f["contest"] for f in forecasts})
    brier = log_loss = cov50 = cov90 = None
    if forecasts:
        ps = np.array([float(f["prob_a"]) for f in forecasts])
        ys = np.array([float(f["outcome_a"]) for f in forecasts])
        brier = float(np.mean((ps - ys) ** 2))
        clipped = np.clip(ps, 1e-6, 1 - 1e-6)
        log_loss = float(-np.mean(ys * np.log(clipped) + (1 - ys) * np.log(1 - clipped)))
        cov50 = float(np.mean([bool(f["in50"]) for f in forecasts]))
        cov90 = float(np.mean([bool(f["in90"]) for f in forecasts]))
    crit = VALIDATION_CRITERIA
    if n < int(crit["min_contests"]):  # type: ignore[arg-type]
        reasons.append(f"solo {n} contiendas fuera de muestra (mínimo {crit['min_contests']})")
    if brier is None or brier >= float(crit["max_brier_vs_coin"]):  # type: ignore[arg-type]
        reasons.append(f"Brier {brier} no supera el umbral {crit['max_brier_vs_coin']}")
    lo90, hi90 = crit["coverage90_range"]  # type: ignore[misc]
    if cov90 is None or not lo90 <= cov90 <= hi90:
        reasons.append(f"cobertura 90 % = {cov90} fuera de [{lo90}, {hi90}]")
    lo50, hi50 = crit["coverage50_range"]  # type: ignore[misc]
    if cov50 is None or not lo50 <= cov50 <= hi50:
        reasons.append(f"cobertura 50 % = {cov50} fuera de [{lo50}, {hi50}]")
    return ValidationReport(
        method=method,
        n_contests=n,
        forecasts=forecasts,
        brier=brier,
        log_loss=log_loss,
        coverage50=cov50,
        coverage90=cov90,
        status="validado" if not reasons else "no_validado",
        reasons=reasons,
    )
