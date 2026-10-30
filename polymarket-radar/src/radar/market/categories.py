"""Categoría gruesa a partir de las etiquetas (tags) del evento en Gamma.

Regla determinista y versionada: se recorre la tabla en orden y gana la primera
categoría cuyo conjunto de slugs intersecta las etiquetas del evento. Sin
etiquetas o sin coincidencias, la categoría es ``unknown`` u ``other``.
"""

from __future__ import annotations

from collections.abc import Iterable

CATEGORY_RULES_VERSION = "tags-v1"

_RULES: list[tuple[str, frozenset[str]]] = [
    ("crypto", frozenset({"crypto", "bitcoin", "ethereum", "solana", "crypto-prices", "xrp"})),
    (
        "sports",
        frozenset(
            {
                "sports",
                "nba",
                "nfl",
                "mlb",
                "nhl",
                "soccer",
                "tennis",
                "ufc",
                "golf",
                "f1",
                "cricket",
                "esports",
                "boxing",
                "mma",
                "epl",
                "champions-league",
                "ncaa",
                "cbb",
                "cfb",
                "baseball",
                "basketball",
                "football",
                "hockey",
            }
        ),
    ),
    (
        "elections",
        frozenset(
            {
                "elections",
                "us-election",
                "global-elections",
                "primaries",
                "midterms",
                "us-elections",
                "world-elections",
            }
        ),
    ),
    (
        "politics",
        frozenset(
            {
                "politics",
                "us-politics",
                "trump",
                "congress",
                "geopolitics",
                "world-affairs",
                "middle-east",
                "ukraine",
                "china",
                "foreign-policy",
            }
        ),
    ),
    (
        "economy",
        frozenset(
            {
                "economy",
                "fed",
                "fed-rates",
                "inflation",
                "macro",
                "finance",
                "stocks",
                "business",
                "earnings",
                "ipos",
                "commodities",
                "gdp",
                "interest-rates",
            }
        ),
    ),
    ("tech", frozenset({"tech", "ai", "openai", "science", "space", "big-tech"})),
    (
        "culture",
        frozenset(
            {
                "culture",
                "pop-culture",
                "movies",
                "music",
                "awards",
                "celebrities",
                "tv",
                "entertainment",
                "oscars",
                "gaming",
            }
        ),
    ),
    ("weather", frozenset({"weather", "climate", "temperature", "hurricanes"})),
]


def categorize(tag_slugs: Iterable[str | None]) -> str:
    slugs = {s.strip().lower() for s in tag_slugs if s}
    if not slugs:
        return "unknown"
    for category, keys in _RULES:
        if slugs & keys:
            return category
    return "other"


def tags_of(category: str) -> frozenset[str]:
    """Etiquetas que asignan ``category`` (si no la gana antes otra regla)."""
    return frozenset().union(*(tags for cat, tags in _RULES if cat == category))
