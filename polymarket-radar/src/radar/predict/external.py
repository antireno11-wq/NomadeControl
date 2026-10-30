"""Referencia externa (``ref-kalshi-v1``): deportes y decisiones de la Fed.

Para estas familias no hay un modelo propio. La "predicción" es el precio sin margen de un
mercado equivalente en Kalshi (API pública de solo lectura). Las reglas de emparejamiento,
abstención y evaluación están en ``docs/PREREGISTRO_VIVO.md``; mientras la evaluación en vivo
no demuestre que la referencia le gana al libro de Polymarket, no hay señales.

La lógica de emparejamiento es pura (sin E/S) y se prueba con datos sintéticos.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Any
from zoneinfo import ZoneInfo

from radar.predict.base import CALIB_NOT_EVALUATED, DataRef, MarketView, Prediction, abstain

EXTERNAL_VERSION = "ref-kalshi-v1"
MODEL = "ref-kalshi"
SOURCE = "kalshi_trade_api"
ET = ZoneInfo("America/New_York")
MAX_SPREAD = 0.10
SUM_RANGE = (0.90, 1.15)
MAX_QUOTE_AGE = timedelta(minutes=10)
MIN_NAME_SCORE = 0.6

# Ligas de EE.UU. dentro del alcance del radar (alcance-v1): solo la NBA.
US_LEAGUES = {"nba": "KXNBAGAME"}
SOCCER_LEAGUES = {
    "epl": "KXEPLGAME",
    "sea": "KXSERIEAGAME",
    "lal": "KXLALIGAGAME",
    "bun": "KXBUNDESLIGAGAME",
    "fl1": "KXLIGUE1GAME",
    "ucl": "KXUCLGAME",
}
FED_SERIES = "KXFEDDECISION"
ALL_SERIES = (*US_LEAGUES.values(), *SOCCER_LEAGUES.values(), FED_SERIES)

# Códigos de equipo que difieren entre el slug de Polymarket y el ticker de Kalshi.
CODE_ALIASES: dict[str, dict[str, str]] = {"nba": {}}

OFFSETS_EXTERNAL: dict[str, tuple[timedelta, ...]] = {
    **{
        f"{lg}_partido": (
            timedelta(hours=24),
            timedelta(hours=6),
            timedelta(hours=2),
            timedelta(minutes=30),
        )
        for lg in (*US_LEAGUES, "futbol")
    },
    "fed_decision": (
        timedelta(days=14),
        timedelta(days=7),
        timedelta(days=3),
        timedelta(days=1),
        timedelta(hours=2),
    ),
}
FAMILY_BY_VARIANT = {"fed_decision": "economia"}
MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
MONTH_NAMES = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)  # fmt: skip


@dataclass(frozen=True)
class Quote:
    """Un mercado de Kalshi tal como se leyó (precios en dólares, 0 a 1)."""

    ticker: str
    event: str
    suffix: str
    title: str
    bid: float | None
    ask: float | None
    close_time: datetime | None
    received_at: datetime
    url: str


@dataclass(frozen=True)
class Match:
    variant: str
    league: str
    outcome: str  # resultado de Polymarket al que se refiere la probabilidad
    yes_ticker: str
    event_tickers: tuple[str, ...]  # todos los resultados excluyentes del evento de Kalshi
    reference_time: datetime  # inicio del partido u hora de la decisión
    cluster: str

    @property
    def family(self) -> str:
        return FAMILY_BY_VARIANT.get(self.variant, "deportes")


# --------------------------------------------------------------------- Kalshi


def parse_quote(m: dict[str, Any], received_at: datetime, url: str) -> Quote:
    def price(key: str) -> float | None:
        v = m.get(f"{key}_dollars")
        if v is None and m.get(key) is not None:
            return float(m[key]) / 100  # formato anterior en centavos
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    close = m.get("close_time")
    return Quote(
        ticker=m["ticker"],
        event=m.get("event_ticker") or m["ticker"].rsplit("-", 1)[0],
        suffix=m["ticker"].rsplit("-", 1)[1],
        title=m.get("yes_sub_title") or m.get("title") or "",
        bid=price("yes_bid"),
        ask=price("yes_ask"),
        close_time=datetime.fromisoformat(close.replace("Z", "+00:00")) if close else None,
        received_at=received_at,
        url=url,
    )


def fetch_quotes(api: Any, series: tuple[str, ...] = ALL_SERIES) -> dict[str, Quote]:
    """Mercados abiertos de las series indicadas, por ticker. ``api`` es un ``ApiClient``."""
    out: dict[str, Quote] = {}
    for s in series:
        cursor = ""
        for _ in range(20):
            params = {"series_ticker": s, "status": "open", "limit": "1000"}
            if cursor:
                params["cursor"] = cursor
            resp = api.request_json("GET", "/markets", params=params)
            for m in resp.data.get("markets") or []:
                q = parse_quote(m, resp.received_at, resp.url)
                out[q.ticker] = q
            cursor = resp.data.get("cursor") or ""
            if not cursor:
                break
    return out


def parse_event_ticker(event: str) -> tuple[date, str] | None:
    """``KXNBAGAME-26OCT27DETNYK`` → (2026-10-27, "DETNYK"); la hora opcional se ignora."""
    m = re.match(r"^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})(\d{4})?([A-Z0-9]+)$", event)
    if not m or m.group(2) not in MONTHS:
        return None
    yy, mon, dd, _hhmm, codes = m.groups()
    try:
        return date(2000 + int(yy), MONTHS.index(mon) + 1, int(dd)), codes
    except ValueError:
        return None


@dataclass
class QuoteIndex:
    by_ticker: dict[str, Quote]
    games: dict[tuple[str, date, str], list[Quote]]  # (serie, fecha, códigos) → resultados
    by_series_date: dict[tuple[str, date], list[list[Quote]]]

    @classmethod
    def build(cls, quotes: dict[str, Quote]) -> QuoteIndex:
        events: dict[str, list[Quote]] = {}
        for q in quotes.values():
            events.setdefault(q.event, []).append(q)
        games: dict[tuple[str, date, str], list[Quote]] = {}
        by_day: dict[tuple[str, date], list[list[Quote]]] = {}
        for ev, qs in events.items():
            parsed = parse_event_ticker(ev)
            if parsed is None:
                continue
            series = ev.split("-", 1)[0]
            games[(series, parsed[0], parsed[1])] = qs
            by_day.setdefault((series, parsed[0]), []).append(qs)
        return cls(quotes, games, by_day)


# ------------------------------------------------------------- emparejamiento


SLUG_RE = re.compile(r"^([a-z0-9]+)-([a-z0-9]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})(?:-([a-z0-9]+))?$")
STOP = {
    "fc", "cf", "ac", "afc", "sc", "ssc", "as", "us", "rcd", "cd", "ud", "sd", "rc", "club",
    "calcio", "de", "the", "and", "1", "sv", "vfb", "vfl", "tsg", "bv", "fsv", "09", "04", "05",
    "1899", "1907", "1909", "1913", "olympique", "stade", "real", "sporting", "athletic",
}  # fmt: skip


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    toks = [t for t in re.split(r"[^a-z0-9]+", s) if t and t not in STOP]
    return " ".join(toks)


def name_score(a: str, b: str) -> float:
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return 0.0
    if na in nb or nb in na:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def _et_date(t: datetime | None, fallback: str) -> date:
    return t.astimezone(ET).date() if t else date.fromisoformat(fallback)


def match_market(
    mv: MarketView,
    game_start: datetime | None,
    sports_type: str | None,
    idx: QuoteIndex,
) -> Match | str:
    """Mercado de Polymarket → par en Kalshi, o el motivo por el que no hay par."""
    if (fed := _match_fed(mv, idx)) is not None:
        return fed
    slug = mv.slug or ""
    m = SLUG_RE.match(slug)
    if not m:
        return "sin par en Kalshi: no es un partido ni una decisión de la Fed reconocible"
    league, a, b, day, side = m.groups()
    if sports_type and sports_type != "moneyline":
        return f"sin par en Kalshi: tipo de mercado {sports_type} no cubierto"
    if league in US_LEAGUES:
        return _match_us(mv, league, a, b, day, game_start, idx)
    if league in SOCCER_LEAGUES:
        return _match_soccer(mv, league, side, day, game_start, idx)
    return f"sin par en Kalshi: liga {league} no cubierta"


def _match_us(
    mv: MarketView, league: str, a: str, b: str, day: str, start: datetime | None,
    idx: QuoteIndex,
) -> Match | str:  # fmt: skip
    if len(mv.outcomes) != 2:
        return "sin par en Kalshi: el partido no tiene dos resultados"
    alias = CODE_ALIASES.get(league, {})
    ca, cb = alias.get(a, a.upper()), alias.get(b, b.upper())
    series = US_LEAGUES[league]
    d = _et_date(start, day)
    qs = idx.games.get((series, d, ca + cb))
    if not qs:
        return "sin par en Kalshi: partido no listado (todavía)"
    sufs = {q.suffix: q for q in qs}
    if set(sufs) != {ca, cb}:
        return "sin par en Kalshi: resultados del evento no coinciden"
    if start is None:
        return "sin par en Kalshi: falta la hora de inicio del partido"
    return Match(
        variant=f"{league}_partido",
        league=league,
        outcome=mv.outcomes[0],
        yes_ticker=sufs[ca].ticker,
        event_tickers=tuple(sorted(q.ticker for q in qs)),
        reference_time=start,
        cluster=f"{league}|{d.isoformat()}",
    )


def _match_soccer(
    mv: MarketView, league: str, side: str | None, day: str, start: datetime | None,
    idx: QuoteIndex,
) -> Match | str:  # fmt: skip
    if side is None or tuple(mv.outcomes) != ("Yes", "No"):
        return "sin par en Kalshi: formato de mercado de fútbol no reconocido"
    teams = re.split(r"\s+vs\.?\s+", (mv.event_title or "").split(" - ")[0])
    if len(teams) != 2 or start is None:
        return "sin par en Kalshi: no se identifican los dos equipos o la hora de inicio"
    d = _et_date(start, day)
    series = SOCCER_LEAGUES[league]
    found: list[tuple[list[Quote], dict[str, Quote]]] = []
    for qs in idx.by_series_date.get((series, d), []):
        clubs = [q for q in qs if q.suffix != "TIE"]
        if len(clubs) != 2 or len(qs) != 3:
            continue
        pairing: dict[str, Quote] = {}
        for team in teams:
            best = max(clubs, key=lambda q: name_score(team, q.title))
            if name_score(team, best.title) < MIN_NAME_SCORE:
                break
            pairing[team] = best
        if len(pairing) == 2 and pairing[teams[0]] is not pairing[teams[1]]:
            found.append((qs, pairing))
    if len(found) != 1:
        return (
            "sin par en Kalshi: partido no listado (todavía)"
            if not found
            else "sin par en Kalshi: emparejamiento ambiguo"
        )
    qs, pairing = found[0]
    if side == "draw":
        yes = next(q for q in qs if q.suffix == "TIE")
    else:
        title = mv.group_item_title or ""
        team = max(teams, key=lambda t: name_score(t, title))
        if name_score(team, title) < MIN_NAME_SCORE:
            return "sin par en Kalshi: no se identifica el equipo del mercado"
        yes = pairing[team]
    return Match(
        variant="futbol_partido",
        league=league,
        outcome="Yes",
        yes_ticker=yes.ticker,
        event_tickers=tuple(sorted(q.ticker for q in qs)),
        reference_time=start,
        cluster=f"{league}|{d.isoformat()}",
    )


FED_RE = re.compile(
    r"(no change|(increase|decrease|raise|cut|hike|lower)\w*[^0-9]*(\d+)(\+)?\s*bps)"
    r".*?\b(" + "|".join(MONTH_NAMES) + r")\s+(\d{4})\s+meeting",
    re.IGNORECASE,
)


def _match_fed(mv: MarketView, idx: QuoteIndex) -> Match | None:
    q = mv.question or ""
    if "fed" not in q.lower() or tuple(mv.outcomes) != ("Yes", "No"):
        return None
    m = FED_RE.search(q)
    if not m:
        return None
    whole, verb, bps, plus, month, year = m.groups()
    if whole.lower() == "no change":
        suffix = "H0"
    else:
        up = verb.lower().startswith(("increase", "raise", "hike"))
        n = int(bps)
        if n == 25 and not plus:
            suffix = "H25" if up else "C25"
        elif n == 50 and plus:  # "50+ bps" = Kalshi "más de 25 bps" (los pasos son de 25)
            suffix = "H26" if up else "C26"
        else:
            return None  # p. ej. "25+ bps" mezcla dos resultados de Kalshi: sin equivalente
    event = f"{FED_SERIES}-{int(year) % 100:02d}{MONTHS[MONTH_NAMES.index(month.lower())]}"
    qs = [x for x in idx.by_ticker.values() if x.event == event]
    yes = next((x for x in qs if x.suffix == suffix), None)
    if yes is None or yes.close_time is None:
        return None
    return Match(
        variant="fed_decision",
        league="fed",
        outcome="Yes",
        yes_ticker=yes.ticker,
        event_tickers=tuple(sorted(x.ticker for x in qs)),
        reference_time=yes.close_time,
        cluster=f"fed|{event}",
    )


# ------------------------------------------------------------------ predicción


def predict(mv: MarketView, match: Match, quotes: dict[str, Quote], as_of: datetime) -> Prediction:
    """Probabilidad sin margen del resultado emparejado (o abstención con motivo)."""
    qs = [quotes[t] for t in match.event_tickers if t in quotes]
    tau = (match.reference_time - as_of).total_seconds() / 60
    details: dict[str, Any] = {
        "terms": {"variant": match.variant, "asset": match.cluster.split("|")[0]},
        "cluster": match.cluster,
        "tau_min": round(tau, 3),
        "kalshi": {q.ticker: {"bid": q.bid, "ask": q.ask, "titulo": q.title} for q in qs},
        "yes_ticker": match.yes_ticker,
    }
    refs = [
        DataRef(
            source=SOURCE,
            kind="cotizacion",
            url=q.url,
            sha256=hashlib.sha256(
                json.dumps([q.ticker, q.bid, q.ask], default=str).encode()
            ).hexdigest(),
            retrieved_at=q.received_at.isoformat(),
            observed_until=q.received_at.isoformat(),
        )
        for q in qs
    ]

    def no(reason: str) -> Prediction:
        return abstain(mv, model=MODEL, version=EXTERNAL_VERSION, family=match.family,
                       as_of=as_of, reason=reason, outcome=match.outcome, details=details,
                       data_used=refs)  # fmt: skip

    if tau <= 0:
        return no("el partido o la decisión ya empezó: no se compara en vivo")
    if len(qs) != len(match.event_tickers):
        return no("Kalshi no devolvió todos los resultados del evento")
    if any(q.received_at > as_of for q in qs):
        return no("cotización de Kalshi posterior al as_of")
    if any(as_of - q.received_at > MAX_QUOTE_AGE for q in qs):
        return no("cotización de Kalshi con más de 10 min")
    if any(q.bid is None or q.ask is None or q.ask < q.bid for q in qs):
        return no("Kalshi sin bid o ask en algún resultado")
    yes = quotes[match.yes_ticker]
    assert yes.bid is not None and yes.ask is not None
    if yes.ask - yes.bid > MAX_SPREAD:
        details["spread_kalshi"] = round(yes.ask - yes.bid, 4)
        return no(f"spread de Kalshi > {MAX_SPREAD}")
    total = sum(((q.bid or 0) + (q.ask or 0)) / 2 for q in qs)
    if not SUM_RANGE[0] <= total <= SUM_RANGE[1]:
        details["suma_kalshi"] = round(total, 4)
        return no("suma de precios de Kalshi fuera de rango")
    p = (yes.bid + yes.ask) / 2 / total
    details["suma_kalshi"] = round(total, 4)
    return Prediction(
        market_id=mv.market_id,
        outcome=match.outcome,
        probability=min(max(p, 0.0), 1.0),
        interval=(max(0.0, yes.bid / total), min(1.0, yes.ask / total)),
        model=MODEL,
        model_version=EXTERNAL_VERSION,
        family=match.family,
        as_of=as_of,
        calibration_status=CALIB_NOT_EVALUATED,
        data_used=refs,
        details=details,
    )
