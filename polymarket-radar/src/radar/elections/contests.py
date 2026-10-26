"""Registro de contiendas electorales con fuente de encuestas configurada.

Cada contienda define, de forma explícita y versionada: candidatos, fecha y hora
de cierre de urnas (UTC), la página de Wikipedia con las encuestas y los alias
para reconocer a los candidatos en tablas y en mercados de Polymarket.

Las contiendas históricas (``historical=True``) solo se usan para calibrar el
error de las encuestas; su resultado se lee de la misma página fuente (fila
"Results"/"Resultado"), nunca se escribe a mano.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime


@dataclass(frozen=True)
class Candidate:
    name: str
    # Expresiones (minúsculas, sin acentos) que identifican al candidato.
    patterns: tuple[str, ...]

    def matches(self, text: str) -> bool:
        norm = normalize(text)
        return any(re.search(p, norm) for p in self.patterns)


@dataclass(frozen=True)
class WikiPollSource:
    lang: str
    title: str


@dataclass(frozen=True)
class Contest:
    key: str
    country: str
    office: str
    round: int
    election_date: date
    polls_close_utc: datetime
    candidate_a: Candidate
    candidate_b: Candidate
    poll_source: WikiPollSource
    year_for_dates: int
    historical: bool = False
    # Desde cuándo la contienda queda definida (p. ej. tras la 1.ª vuelta).
    defined_from_utc: datetime | None = None
    polymarket_event_slugs: tuple[str, ...] = field(default_factory=tuple)
    # Eventos derivados (por estado, margen, participación...) de la misma contienda.
    polymarket_event_slug_prefixes: tuple[str, ...] = field(default_factory=tuple)
    notes: str = ""

    @property
    def candidates(self) -> tuple[Candidate, Candidate]:
        return (self.candidate_a, self.candidate_b)


_ACCENTS = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüçñ", "aaaaaeeeeiiiiooooouuuucn")


def normalize(text: str) -> str:
    return " ".join(text.lower().translate(_ACCENTS).split())


LULA = Candidate("Lula", (r"\blula\b", r"luiz inacio"))
FLAVIO = Candidate("Flávio Bolsonaro", (r"\bf\.\s*bolsonaro\b", r"flavio"))

BR_2026_R2 = Contest(
    key="br-2026-presidente-2t",
    country="BR",
    office="president",
    round=2,
    election_date=date(2026, 10, 25),
    # Urnas: 8h-17h hora de Brasilia (UTC-3, sin horario de verano) en todo el país.
    polls_close_utc=datetime(2026, 10, 25, 20, 0, tzinfo=UTC),
    candidate_a=LULA,
    candidate_b=FLAVIO,
    poll_source=WikiPollSource(
        "en", "Opinion polling for the 2026 Brazilian presidential election"
    ),
    year_for_dates=2026,
    # La 1.ª vuelta fue el 4-oct; el par de la 2.ª vuelta se conoce tras el escrutinio.
    defined_from_utc=datetime(2026, 10, 5, 12, 0, tzinfo=UTC),
    polymarket_event_slugs=("brazil-presidential-election",),
    polymarket_event_slug_prefixes=("brazil-presidential-election-second-round",),
    notes="Segunda vuelta presidencial de Brasil 2026.",
)

# Segundas vueltas históricas con tabla de encuestas en en.wikipedia (calibración).
HISTORICAL_BR_RUNOFFS: tuple[Contest, ...] = (
    Contest(
        key="br-2022-presidente-2t",
        country="BR",
        office="president",
        round=2,
        election_date=date(2022, 10, 30),
        polls_close_utc=datetime(2022, 10, 30, 20, 0, tzinfo=UTC),
        candidate_a=LULA,
        candidate_b=Candidate("Jair Bolsonaro", (r"\bbolsonaro\b",)),
        poll_source=WikiPollSource(
            "en", "Opinion polling for the 2022 Brazilian presidential election"
        ),
        year_for_dates=2022,
        historical=True,
    ),
    Contest(
        key="br-2018-presidente-2t",
        country="BR",
        office="president",
        round=2,
        election_date=date(2018, 10, 28),
        # Cierre aproximado (17h de Brasilia, UTC-3). Para la calibración solo se usa
        # el horizonte en días, al que una hora de diferencia no afecta.
        polls_close_utc=datetime(2018, 10, 28, 20, 0, tzinfo=UTC),
        candidate_a=Candidate("Jair Bolsonaro", (r"\bbolsonaro\b",)),
        candidate_b=Candidate("Fernando Haddad", (r"\bhaddad\b",)),
        poll_source=WikiPollSource(
            "en", "Opinion polling for the 2018 Brazilian presidential election"
        ),
        year_for_dates=2018,
        historical=True,
    ),
    Contest(
        key="br-2010-presidente-2t",
        country="BR",
        office="president",
        round=2,
        election_date=date(2010, 10, 31),
        # 17h de Brasilia con horario de verano (UTC-2); aproximado, ver 2018.
        polls_close_utc=datetime(2010, 10, 31, 19, 0, tzinfo=UTC),
        candidate_a=Candidate("Dilma Rousseff", (r"\bdilma\b", r"rousseff")),
        candidate_b=Candidate("José Serra", (r"\bserra\b",)),
        poll_source=WikiPollSource(
            "en", "Opinion polling for the 2010 Brazilian presidential election"
        ),
        year_for_dates=2010,
        historical=True,
    ),
)


def _runoff(
    key: str,
    title: str,
    day: date,
    close_utc: datetime,
    a: Candidate,
    b: Candidate,
) -> Contest:
    country, _, _ = key.split("-", 2)
    return Contest(
        key=key,
        country=country.upper(),
        office="president",
        round=2,
        election_date=day,
        polls_close_utc=close_utc,
        candidate_a=a,
        candidate_b=b,
        poll_source=WikiPollSource("en", title),
        year_for_dates=day.year,
        historical=True,
    )


def _c(name: str, *patterns: str) -> Candidate:
    return Candidate(name, patterns)


def _t(y: int, m: int, d: int, h: int) -> datetime:
    return datetime(y, m, d, h, 0, tzinfo=UTC)


# Segundas vueltas de otros países (misma estructura de tabla en en.wikipedia).
# Hora de cierre aproximada (solo define el horizonte en días). El par de
# candidatos es configuración; si no coincide con la tabla, la contienda no
# produce encuestas y se descarta con su motivo.
HISTORICAL_WORLD_RUNOFFS: tuple[Contest, ...] = (
    _runoff("fr-2017-presidente-2t", "Opinion polling for the 2017 French presidential election",
            date(2017, 5, 7), _t(2017, 5, 7, 18), _c("Emmanuel Macron", r"\bmacron\b"),
            _c("Marine Le Pen", r"le pen")),
    _runoff("fr-2022-presidente-2t", "Opinion polling for the 2022 French presidential election",
            date(2022, 4, 24), _t(2022, 4, 24, 18), _c("Emmanuel Macron", r"\bmacron\b"),
            _c("Marine Le Pen", r"le pen")),
    _runoff("pl-2020-presidente-2t", "Opinion polling for the 2020 Polish presidential election",
            date(2020, 7, 12), _t(2020, 7, 12, 19), _c("Andrzej Duda", r"\bduda\b"),
            _c("Rafał Trzaskowski", r"trzaskowski")),
    _runoff("pl-2025-presidente-2t", "Opinion polling for the 2025 Polish presidential election",
            date(2025, 6, 1), _t(2025, 6, 1, 19), _c("Rafał Trzaskowski", r"trzaskowski"),
            _c("Karol Nawrocki", r"nawrocki")),
    _runoff("cl-2021-presidente-2t", "Opinion polling for the 2021 Chilean presidential election",
            date(2021, 12, 19), _t(2021, 12, 19, 21), _c("Gabriel Boric", r"\bboric\b"),
            _c("José Antonio Kast", r"\bkast\b")),
    _runoff("cl-2025-presidente-2t", "Opinion polling for the 2025 Chilean presidential election",
            date(2025, 12, 14), _t(2025, 12, 14, 21), _c("Jeannette Jara", r"\bjara\b"),
            _c("José Antonio Kast", r"\bkast\b")),
    _runoff("pe-2021-presidente-2t", "Opinion polling for the 2021 Peruvian general election",
            date(2021, 6, 6), _t(2021, 6, 7, 0), _c("Pedro Castillo", r"castillo"),
            _c("Keiko Fujimori", r"fujimori")),
    _runoff("co-2022-presidente-2t", "Opinion polling for the 2022 Colombian presidential election",
            date(2022, 6, 19), _t(2022, 6, 19, 21), _c("Gustavo Petro", r"\bpetro\b"),
            _c("Rodolfo Hernández", r"hernandez")),
    _runoff("ro-2025-presidente-2t", "2025 Romanian presidential election",
            date(2025, 5, 18), _t(2025, 5, 18, 18), _c("Nicușor Dan", r"\bdan\b", r"nicusor"),
            _c("George Simion", r"simion")),
    _runoff("ec-2025-presidente-2t", "Opinion polling for the 2025 Ecuadorian general election",
            date(2025, 4, 13), _t(2025, 4, 13, 22), _c("Daniel Noboa", r"noboa"),
            _c("Luisa González", r"gonzalez")),
)  # fmt: skip

CONTESTS: dict[str, Contest] = {
    c.key: c for c in (BR_2026_R2, *HISTORICAL_BR_RUNOFFS, *HISTORICAL_WORLD_RUNOFFS)
}
