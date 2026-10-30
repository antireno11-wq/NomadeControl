"""Eventos macroeconómicos programados que mueven el precio cripto (``crypto-models-v2``).

Fechas oficiales, leídas el 30-oct-2026:

- IPC (Consumer Price Index) y empleo (Employment Situation) de BLS, 08:30 de Nueva York.
  Publicadas: nombres de archivo de los archivos históricos
  (``bls.gov/bls/news-release/cpi.htm`` y ``.../empsit.htm``, p. ej. ``cpi_10142026.htm``).
  Futuras: ``bls.gov/schedule/news_release/cpi.htm`` y ``.../empsit.htm``.
- Decisión de la Reserva Federal (segundo día de cada reunión), 14:00 de Nueva York:
  ``federalreserve.gov/monetarypolicy/fomccalendars.htm`` (las de 2027 son tentativas).

Si una fecha cambia, se agrega una enmienda al preregistro y una nueva versión de la tabla.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

EVENTS_VERSION = "crypto-events-v1"
NY = ZoneInfo("America/New_York")
EVENT_MINUTES = 60  # se considera la hora que sigue al anuncio

_CPI = (
    "2026-01-13 2026-02-13 2026-03-11 2026-04-10 2026-05-12 2026-06-10 2026-07-14 2026-08-12 "
    "2026-09-11 2026-10-14 2026-11-10 2026-12-10 2027-01-13 2027-02-11 2027-03-10 2027-04-13 "
    "2027-05-12 2027-06-10 2027-07-14 2027-08-11 2027-09-14 2027-10-14 2027-11-10 2027-12-10"
)
_EMPLEO = (
    "2026-01-09 2026-02-11 2026-03-06 2026-04-03 2026-05-08 2026-06-05 2026-07-02 2026-08-07 "
    "2026-09-04 2026-10-02 2026-11-06 2026-12-04 2027-01-08 2027-02-05 2027-03-05 2027-04-02 "
    "2027-05-07 2027-06-04 2027-07-02 2027-08-06 2027-09-03 2027-10-08 2027-11-05 2027-12-03"
)
_FED = (
    "2026-01-28 2026-03-18 2026-04-29 2026-06-17 2026-07-29 2026-09-16 2026-10-28 2026-12-09 "
    "2027-01-27 2027-03-17 2027-04-28 2027-06-09 2027-07-28 2027-09-15 2027-10-27 2027-12-08"
)


def _at(days: str, hour: int, minute: int) -> list[datetime]:
    return [
        datetime.combine(date.fromisoformat(d), time(hour, minute), NY).astimezone(UTC)
        for d in days.split()
    ]


EVENTS: dict[str, list[datetime]] = {
    "ipc": _at(_CPI, 8, 30),
    "empleo": _at(_EMPLEO, 8, 30),
    "fed": _at(_FED, 14, 0),
}
ALL_EVENTS: list[tuple[datetime, str]] = sorted(
    (t, kind) for kind, ts in EVENTS.items() for t in ts
)
COVERS_UNTIL = max(t for t, _ in ALL_EVENTS)


def events_overlapping(start: datetime, end: datetime) -> list[tuple[datetime, str]]:
    """Eventos cuya hora [t, t + 60 min] se cruza con [start, end)."""
    span = timedelta(minutes=EVENT_MINUTES)
    return [(t, k) for t, k in ALL_EVENTS if t < end and t + span > start]
