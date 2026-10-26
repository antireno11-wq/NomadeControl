"""Momentos de predicción preregistrados para el backtest (``crypto-schedule-v1``).

Para cada variante de contrato se predice a distancias fijas antes del instante de
resolución R (cierre de la vela observada o fin de la ventana de toque). Se fijan
antes de ver resultados y no dependen de precios ni de desenlaces.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from radar.predict.crypto.terms import CryptoTerms

SCHEDULE_VERSION = "crypto-schedule-v1"
H = timedelta(hours=1)
M = timedelta(minutes=1)
D = timedelta(days=1)

OFFSETS: dict[str, tuple[timedelta, ...]] = {
    "daily_above": (24 * H, 12 * H, 6 * H, 3 * H, 1 * H, 15 * M),
    "daily_below": (24 * H, 12 * H, 6 * H, 3 * H, 1 * H, 15 * M),
    "daily_range": (24 * H, 12 * H, 6 * H, 3 * H, 1 * H, 15 * M),
    "hourly_above": (60 * M, 45 * M, 30 * M, 15 * M, 5 * M),
    "hourly_updown": (70 * M, 45 * M, 30 * M, 15 * M, 5 * M),
    "daily_updown": (24 * H, 18 * H, 12 * H, 6 * H, 1 * H),
    "touch_day": (24 * H, 18 * H, 12 * H, 6 * H, 2 * H),
    "touch_range": (7 * D, 5 * D, 3 * D, 1 * D, 6 * H),
    "touch_month": (28 * D, 21 * D, 14 * D, 7 * D, 3 * D, 1 * D),
    "touch_until": (30 * D, 14 * D, 7 * D, 1 * D),
    "touch_explicit": (30 * D, 14 * D, 7 * D, 1 * D),
}

# Tramos de horizonte para ajustar parámetros (lookback de volatilidad, cocientes).
HORIZON_BUCKETS: tuple[tuple[str, timedelta], ...] = (
    ("<=2h", 2 * H),
    ("<=1d", 1 * D),
    ("<=7d", 7 * D),
    (">7d", timedelta(days=10_000)),
)


def horizon_bucket(tau: timedelta) -> str:
    for name, limit in HORIZON_BUCKETS:
        if tau <= limit:
            return name
    return HORIZON_BUCKETS[-1][0]


def prediction_times(terms: CryptoTerms, created_at: datetime | None) -> list[datetime]:
    """Instantes ``as_of`` (UTC) previstos para un contrato, en orden cronológico."""
    r = terms.resolution_time
    out = []
    for off in OFFSETS.get(terms.variant, ()):
        t = r - off
        if created_at is not None and t < created_at:
            continue
        out.append(t)
    return sorted(out)
