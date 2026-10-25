"""Utilidades de tiempo. Todo se almacena en UTC con zona horaria explícita."""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)


def parse_iso(value: object) -> datetime | None:
    """Convierte una fecha ISO-8601 de la API en datetime UTC; None si no es válida."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    # Gamma a veces entrega "2023-11-02 22:05:44.425+00" (sin minutos en el offset).
    if len(text) >= 3 and text[-3] in "+-" and text[-2:].isdigit() and ":" not in text[-3:]:
        text = text + ":00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def from_epoch_ms(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        return datetime.fromtimestamp(int(str(value)) / 1000, tz=UTC)
    except (TypeError, ValueError, OverflowError, OSError):
        return None
