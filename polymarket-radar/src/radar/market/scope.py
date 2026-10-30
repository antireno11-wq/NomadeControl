"""Alcance del radar (``alcance-v1``): qué mercados de Polymarket se descargan y analizan.

Elegido el 28-oct-2026: cripto, economía, política, elecciones, NBA, tenis ATP y fútbol.
En fútbol entran solo los mercados de ganador o empate y los que no son de un partido
(campeón, ascenso, etc.); quedan fuera marcador exacto, totales, hándicap, mitades,
córners y "ambos marcan", que son la gran mayoría y ninguna fuente sirve para compararlos.

Todo lo demás (otros deportes, clima, cultura, tecnología) no se descarga.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from radar.market.categories import tags_of

SCOPE_VERSION = "alcance-v1"
CATEGORIES = ("crypto", "economy", "politics", "elections")
SOCCER_TYPES = (None, "", "moneyline")

# Etiquetas que se piden a Gamma (/events/keyset?tag_slug=...): todas las que asignan
# una de las categorías del alcance, más las de los deportes elegidos.
GAMMA_TAGS: tuple[str, ...] = (
    *sorted(frozenset().union(*(tags_of(c) for c in CATEGORIES))),
    "nba",
    "tennis",
    "soccer",
)


def in_scope(
    category: str, event_slug: str | None, tags: Iterable[str | None], sports_type: str | None
) -> bool:
    """¿El mercado entra en el alcance? Regla pura, igual a ``sql_clause``."""
    if category in CATEGORIES:
        return True
    if category != "sports":
        return False
    slugs = {t for t in tags if t}
    if "nba" in slugs:
        return True
    if (event_slug or "").startswith("atp-") or "atp" in slugs:
        return True
    return "soccer" in slugs and sports_type in SOCCER_TYPES


def sql_clause(event: Any, market: Any) -> Any:
    """La misma regla como condición SQL sobre ``events`` y ``markets`` (PostgreSQL)."""
    from sqlalchemy import and_, cast, or_
    from sqlalchemy.dialects.postgresql import JSONB

    tags = cast(event.tags, JSONB)
    stype = market.raw["sportsMarketType"].as_string()
    return or_(
        event.category.in_(CATEGORIES),
        and_(
            event.category == "sports",
            or_(
                tags.contains([{"slug": "nba"}]),
                event.slug.like("atp-%"),
                tags.contains([{"slug": "atp"}]),
                and_(
                    tags.contains([{"slug": "soccer"}]),
                    or_(stype.is_(None), stype == "", stype == "moneyline"),
                ),
            ),
        ),
    )
