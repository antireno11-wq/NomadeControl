"""Métricas de evaluación probabilística con incertidumbre por conglomerados.

Las predicciones de un mismo día y activo comparten la misma trayectoria de precio:
no son independientes. Los intervalos de confianza se calculan con bootstrap por
conglomerados (se remuestrean días completos), no por predicción individual.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np

P_CLIP = 1e-4


def brier(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2)) if p.size else float("nan")


def log_loss(p: np.ndarray, y: np.ndarray) -> float:
    if not p.size:
        return float("nan")
    q = np.clip(p, P_CLIP, 1 - P_CLIP)
    return float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q)))


def calibration_bins(p: np.ndarray, y: np.ndarray, n_bins: int = 10) -> list[dict[str, float]]:
    edges = np.linspace(0, 1, n_bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, n_bins - 1)
    out = []
    for b in range(n_bins):
        m = idx == b
        out.append(
            {
                "lo": float(edges[b]),
                "hi": float(edges[b + 1]),
                "n": int(m.sum()),
                "mean_p": float(p[m].mean()) if m.any() else float("nan"),
                "mean_y": float(y[m].mean()) if m.any() else float("nan"),
            }
        )
    return out


def ece(p: np.ndarray, y: np.ndarray, n_bins: int = 10) -> float:
    """Error de calibración esperado: promedio ponderado de |frecuencia − probabilidad|."""
    if not p.size:
        return float("nan")
    total = 0.0
    for b in calibration_bins(p, y, n_bins):
        if b["n"]:
            total += b["n"] * abs(b["mean_y"] - b["mean_p"])
    return total / p.size


@dataclass(frozen=True)
class CI:
    value: float
    lo: float
    hi: float

    def to_dict(self) -> dict[str, float]:
        return {"value": self.value, "lo": self.lo, "hi": self.hi}


def cluster_bootstrap(
    stat: Callable[[np.ndarray], float],
    clusters: Sequence[str],
    *,
    n_boot: int = 1000,
    seed: int = 12345,
    alpha: float = 0.05,
) -> CI:
    """IC de ``stat(indices)`` remuestreando conglomerados completos con reemplazo."""
    labels = np.asarray(clusters)
    uniq, inv = np.unique(labels, return_inverse=True)
    groups = [np.flatnonzero(inv == g) for g in range(uniq.size)]
    full = np.arange(labels.size)
    value = stat(full)
    if uniq.size < 2:
        return CI(value, float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(n_boot):
        pick = rng.integers(0, uniq.size, uniq.size)
        idx = np.concatenate([groups[g] for g in pick])
        vals.append(stat(idx))
    arr = np.array(vals)
    return CI(
        value, float(np.nanquantile(arr, alpha / 2)), float(np.nanquantile(arr, 1 - alpha / 2))
    )


def summarize(
    p: np.ndarray, y: np.ndarray, clusters: Sequence[str], *, n_boot: int = 500, seed: int = 1
) -> dict[str, object]:
    """Métricas puntuales y con IC por conglomerados para un conjunto de predicciones."""
    if not p.size:
        return {"n": 0}
    out: dict[str, object] = {
        "n": int(p.size),
        "n_clusters": int(np.unique(np.asarray(clusters)).size),
        "base_rate": float(y.mean()),
        "mean_p": float(p.mean()),
        "brier": cluster_bootstrap(
            lambda i: brier(p[i], y[i]), clusters, n_boot=n_boot, seed=seed
        ).to_dict(),
        "log_loss": cluster_bootstrap(
            lambda i: log_loss(p[i], y[i]), clusters, n_boot=n_boot, seed=seed
        ).to_dict(),
        "ece": cluster_bootstrap(
            lambda i: ece(p[i], y[i]), clusters, n_boot=n_boot, seed=seed
        ).to_dict(),
        "calib_in_large": cluster_bootstrap(
            lambda i: float(np.mean(p[i] - y[i])), clusters, n_boot=n_boot, seed=seed
        ).to_dict(),
        "bins": calibration_bins(p, y),
    }
    return out


def paired_diff(
    a: np.ndarray,
    b: np.ndarray,
    y: np.ndarray,
    clusters: Sequence[str],
    metric: Callable[[np.ndarray, np.ndarray], float] = log_loss,
    *,
    n_boot: int = 500,
    seed: int = 2,
) -> dict[str, float]:
    """metric(a) − metric(b) sobre las mismas predicciones, con IC por conglomerados."""
    ci = cluster_bootstrap(
        lambda i: metric(a[i], y[i]) - metric(b[i], y[i]), clusters, n_boot=n_boot, seed=seed
    )
    return ci.to_dict()
