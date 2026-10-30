"""Descubrimiento y clasificación determinista de mercados electorales.

Fuente: los mercados abiertos ya ingeridos (``markets`` + ``events``). Un
mercado es electoral si su evento está en la categoría ``elections`` o si el
texto contiene vocabulario electoral. Las reglas (versión ``RULES_VERSION``)
asignan tipo de mercado, cargo, país, año y vuelta, y vinculan el mercado a una
contienda registrada cuando su evento está en ``Contest.polymarket_event_slugs``.

Solo se modela lo que tiene fuente de encuestas y un modelo adecuado; el resto
queda en ``abstencion`` con el motivo explícito.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from radar.elections.contests import CONTESTS, Contest, normalize

RULES_VERSION = "elec-classify-v1"

ELECTORAL = re.compile(
    r"\belection|electoral|runoff|run-off|ballot|referendum|\bprimar(y|ies)\b|midterm|mayoral|"
    r"gubernatorial|\bvote[sd]?\b|\bseats?\b|parliament|senate race|governor race|\bnominee\b|"
    r"nomination|second round|first round|\bcaucus"
)

TYPE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("margen", re.compile(r"margin of victory|\bwin\b.*\bby \d|\bby \d+(\.\d+)?%")),
    ("participacion", re.compile(r"turnout|total votes cast")),
    (
        "porcentaje_voto",
        re.compile(r"% of the vote|vote share|percentage of (the )?vote|receive (at least )?\d+%"),
    ),
    (
        "pasa_a_segunda_vuelta",
        re.compile(r"advance to the (second round|runoff)|qualify for the runoff|make the runoff"),
    ),
    (
        "ganador_regional",
        re.compile(r"1st place in|first place in|most votes in |winner in .*(city|state)"),
    ),
    ("posicion", re.compile(r"2nd place|3rd place|second[- ]most|third[- ]most|second place")),
    (
        "escanos",
        re.compile(
            r"\d+\s*(-|–|to)?\s*\d*\+?\s*seats|most seats|# of seats|number of seats|"
            r"seats? (won|held)|(fewer|more) than \d+ .*seats|second-most seats|third most seats"
        ),
    ),
    ("nominacion", re.compile(r"nominee|nomination|\bprimary\b|primaries")),
    (
        "proximo_cargo",
        re.compile(
            r"be the next (prime minister|president|mayor|chancellor|speaker|leader|premier)"
        ),
    ),
    ("control", re.compile(r"\bcontrol\b|\bmajority\b")),
    (
        "ganador",
        re.compile(r"\bwin\b.*(election|race|seat|presidency)|wins? the (presidency|election)"),
    ),
]

OFFICE_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("presidente", re.compile(r"president(ial)?\b|presidency")),
    ("gobernador", re.compile(r"governor|gubernatorial")),
    ("senado", re.compile(r"\bsenat(e|or)")),
    ("camara", re.compile(r"\bhouse\b|congressional|\b[a-z]{2}-\d{2}\b")),
    ("alcalde", re.compile(r"\bmayor")),
    ("primer_ministro", re.compile(r"prime minister|premier|chancellor")),
    ("parlamento", re.compile(r"parliament|legislative|general election|\bseats?\b|knesset")),
    ("referendum", re.compile(r"referendum")),
]

COUNTRIES: dict[str, tuple[str, ...]] = {
    "BR": ("brazil", "brazilian"),
    "US": ("united states", "u.s.", "midterm", "us senate", "us house", "republican", "democrat",
           "democratic party", "gop"),
    "AR": ("argentina", "argentine"),
    "MX": ("mexico", "mexican", "sonora", "quintana roo", "nuevo leon", "jalisco"),
    "CO": ("colombia", "colombian"),
    "CL": ("chile", "chilean"),
    "PE": ("peru", "peruvian"),
    "FR": ("france", "french"),
    "DE": ("germany", "german"),
    "GB": ("united kingdom", "uk ", "britain", "british", "scotland", "scottish", "wales", "welsh"),
    "IT": ("italy", "italian"),
    "ES": ("spain", "spanish"),
    "PT": ("portugal", "portuguese"),
    "CA": ("canada", "canadian", "winnipeg", "ontario", "quebec", "alberta"),
    "AU": ("australia", "australian", "victoria", "victorian", "new south wales", "queensland"),
    "IL": ("israel", "israeli", "knesset"),
    "JP": ("japan", "japanese"),
    "BG": ("bulgaria", "bulgarian"),
    "SV": ("el salvador", "salvadoran"),
    "ZA": ("south africa", "johannesburg", "cape town"),
    "IN": ("india", "indian"),
    "PL": ("poland", "polish"),
    "RO": ("romania", "romanian"),
    "HU": ("hungary", "hungarian"),
    "NL": ("netherlands", "dutch"),
}  # fmt: skip


@dataclass(frozen=True)
class Classification:
    electoral: bool
    market_type: str
    office: str
    country: str
    year: int | None
    round: int | None
    candidate: str | None
    contest_key: str | None
    coverage: str  # modelado | abstencion
    abstain_reason: str | None
    rules_version: str = RULES_VERSION


def _first(rules: list[tuple[str, re.Pattern[str]]], text: str, default: str) -> str:
    for name, pat in rules:
        if pat.search(text):
            return name
    return default


def _contest_for(event_slug: str | None) -> Contest | None:
    if not event_slug:
        return None
    for c in CONTESTS.values():
        if c.historical:
            continue
        if event_slug in c.polymarket_event_slugs or any(
            event_slug.startswith(p) for p in c.polymarket_event_slug_prefixes
        ):
            return c
    return None


def classify(
    question: str,
    event_title: str | None,
    group_item_title: str | None,
    event_slug: str | None,
    category: str | None,
) -> Classification:
    text = normalize(f"{question} || {event_title or ''}")
    electoral = category == "elections" or bool(ELECTORAL.search(text))
    if not electoral:
        return Classification(False, "no_electoral", "", "", None, None, None, None,
                              "abstencion", "no es electoral")  # fmt: skip
    mtype = _first(TYPE_RULES, text, "otro")
    office = _first(OFFICE_RULES, text, "otro")
    country = "desconocido"
    for code, keys in COUNTRIES.items():
        if any(k in f" {text} " for k in keys):
            country = code
            break
    if country == "desconocido" and office == "camara" and re.search(r"\b[a-z]{2}-\d{2}\b", text):
        country = "US"
    year_m = re.search(r"\b(20\d{2})\b", text)
    rnd = 2 if re.search(r"second round|runoff|run-off|2nd round", text) else (
        1 if re.search(r"first round|1st round", text) else None
    )  # fmt: skip
    candidate = (group_item_title or "").strip() or None
    contest = _contest_for(event_slug)
    if contest is None:
        reason = "sin fuente de encuestas configurada para esta contienda"
        year = int(year_m.group(1)) if year_m else None
        return Classification(
            True, mtype, office, country, year, rnd, candidate, None, "abstencion", reason
        )
    cand_ok = candidate is not None and any(c.matches(candidate) for c in contest.candidates)
    if mtype not in ("ganador",):
        reason = f"tipo de mercado no modelado ({mtype})"
    elif not cand_ok:
        reason = "candidato fuera del par de la contienda"
    else:
        reason = None
    return Classification(
        True,
        mtype,
        office,
        country,
        int(year_m.group(1)) if year_m else None,
        rnd,
        candidate,
        contest.key,
        "modelado" if reason is None else "abstencion",
        reason,
    )


@dataclass
class DiscoverySummary:
    scanned: int = 0
    electoral: int = 0
    events: int = 0
    by_type: Counter[str] = field(default_factory=Counter)
    by_office: Counter[str] = field(default_factory=Counter)
    by_country: Counter[str] = field(default_factory=Counter)
    modeled: int = 0
    linked_to_contest: int = 0
    abstain_reasons: Counter[str] = field(default_factory=Counter)

    def to_dict(self) -> dict[str, object]:
        return {
            "rules_version": RULES_VERSION,
            "mercados_revisados": self.scanned,
            "mercados_electorales": self.electoral,
            "eventos_electorales": self.events,
            "vinculados_a_contienda": self.linked_to_contest,
            "modelados": self.modeled,
            "por_tipo": dict(self.by_type.most_common()),
            "por_cargo": dict(self.by_office.most_common()),
            "por_pais": dict(self.by_country.most_common(15)),
            "motivos_abstencion": dict(self.abstain_reasons.most_common()),
        }
