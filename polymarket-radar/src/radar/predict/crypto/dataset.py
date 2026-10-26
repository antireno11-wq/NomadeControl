"""Conjunto de mercados cripto ya resueltos para evaluar modelos (``crypto-dataset-v1``).

Pasos (todos con caché en disco y SHA-256 de cada respuesta):

1. Listar eventos cerrados por búsqueda de título y rango de fechas
   (``/events/keyset``, sin mercados, liviano).
2. Clasificar por título y muestrear de forma **determinista** (regla fija, sin
   mirar resultados ni precios): eventos horarios, una hora por día que rota con
   el día del año; el resto, todos.
3. Pedir los mercados de los eventos elegidos (``/events/keyset?id=…``) y leer el
   resultado oficial de ``outcomePrices`` (1/0; 0,5/0,5 = empate).
4. Guardar la historia de precios de referencia del token YES/Up
   (``/prices-history``). Es un precio **no ejecutable**: solo se usa como
   referencia del mercado.

No se descartan mercados por su resultado ni por sus precios. Los que no se pueden
leer con ``crypto-terms-v1`` quedan contados con su motivo.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from radar.ingestion.http import ApiClient, ApiError
from radar.logging_setup import get_logger
from radar.predict.base import MarketView
from radar.predict.crypto.terms import MONTHS, CryptoTerms, Unsupported, parse_crypto_terms
from radar.timeutil import parse_iso, utcnow

log = get_logger(__name__)
DATASET_VERSION = "crypto-dataset-v1"
ET = ZoneInfo("America/New_York")

ASSET_NAMES = {"BTC": "Bitcoin", "ETH": "Ethereum", "SOL": "Solana", "XRP": "XRP"}

# Tipos de evento por título. ``hourly`` indica que se muestrea una hora por día.
EVENT_TYPES: dict[str, tuple[re.Pattern[str], bool]] = {
    "daily_level": (re.compile(r"^(?P<a>\w+) above ___ on (?P<m>[A-Za-z]+) (?P<d>\d+)\?$"), False),
    "hourly_level": (
        re.compile(
            r"^(?P<a>\w+) above ___ on (?P<m>[A-Za-z]+) (?P<d>\d+), (?P<h>\d+)(?P<p>AM|PM) ET\?$"
        ),
        True,
    ),
    "daily_range": (re.compile(r"^(?P<a>\w+) price on (?P<m>[A-Za-z]+) (?P<d>\d+)\?$"), False),
    "touch_day": (
        re.compile(r"^What price will (?P<a>\w+) hit on (?P<m>[A-Za-z]+) (?P<d>\d+)\?$"),
        False,
    ),
    "touch_week": (
        re.compile(
            r"^What price will (?P<a>\w+) hit (?P<m>[A-Za-z]+) (?P<d>\d+)-(?:[A-Za-z]+ )?\d+\?$"
        ),
        False,
    ),
    "touch_month": (re.compile(r"^What price will (?P<a>\w+) hit in (?P<m>[A-Za-z]+)\?$"), False),
    "hourly_updown": (
        re.compile(
            r"^(?P<a>\w+) Up or Down - (?P<m>[A-Za-z]+) (?P<d>\d+), (?P<h>\d+)(?P<p>AM|PM) ET$"
        ),
        True,
    ),
    "daily_updown": (
        re.compile(r"^(?P<a>\w+) Up or Down on (?P<m>[A-Za-z]+) (?P<d>\d+)\?$"),
        False,
    ),
}

# "Up or Down" no se busca por título: arrastraría miles de mercados de 5 minutos por día.
# Sus eventos horarios y diarios se piden por slug (ver ``updown_slugs``).
SEARCHES = ("{name} above", "{name} price on", "What price will {name} hit")
MONTH_NAMES = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
]


@dataclass(frozen=True)
class DatasetPlan:
    start: datetime  # fin del evento >= start
    end: datetime  # fin del evento < end
    assets: tuple[str, ...] = ("BTC", "ETH", "SOL", "XRP")
    # tipos permitidos por activo (None = todos)
    types_by_asset: dict[str, tuple[str, ...]] | None = None


DEFAULT_TYPES_BY_ASSET: dict[str, tuple[str, ...]] = {
    "BTC": tuple(EVENT_TYPES),
    "ETH": tuple(EVENT_TYPES),
    "SOL": ("daily_level", "touch_week", "touch_month", "hourly_updown", "daily_updown"),
    "XRP": ("daily_level", "touch_week", "touch_month", "hourly_updown", "daily_updown"),
}


@dataclass
class ResolvedMarket:
    market: MarketView
    terms: CryptoTerms
    event_id: str
    event_type: str
    yes_index: int
    outcome_yes: float  # 1, 0 o 0.5 (empate 50-50)
    closed_time: datetime | None
    created_at: datetime | None

    @property
    def yes_token(self) -> str:
        return self.market.token_ids[self.yes_index]


@dataclass
class DatasetStats:
    events_listed: Counter[str] = field(default_factory=Counter)
    events_selected: Counter[str] = field(default_factory=Counter)
    markets: Counter[str] = field(default_factory=Counter)
    unsupported: Counter[str] = field(default_factory=Counter)
    unresolved: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "events_listed": dict(self.events_listed),
            "events_selected": dict(self.events_selected),
            "markets": dict(self.markets),
            "unsupported": dict(self.unsupported),
            "unresolved": self.unresolved,
            "errors": self.errors[:50],
            "errors_total": len(self.errors),
        }


class GzCache:
    """Caché de respuestas JSON comprimidas con su URL, hora de recepción y SHA-256."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, kind: str, key: str) -> Path:
        return self.root / kind / f"{hashlib.sha256(key.encode()).hexdigest()[:24]}.json.gz"

    def get(self, kind: str, key: str) -> dict[str, Any] | None:
        p = self._path(kind, key)
        if not p.exists():
            return None
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            return json.load(fh)

    def put(
        self, kind: str, key: str, url: str, data: Any, received_at: datetime
    ) -> dict[str, Any]:
        blob = json.dumps(data, sort_keys=True, ensure_ascii=False)
        rec = {
            "key": key,
            "url": url,
            "received_at": received_at.isoformat(),
            "sha256": hashlib.sha256(blob.encode()).hexdigest(),
            "data": data,
        }
        p = self._path(kind, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(p, "wt", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False)
        return rec


def classify_event(title: str) -> tuple[str, re.Match[str]] | None:
    for name, (rx, _hourly) in EVENT_TYPES.items():
        m = rx.match(title.strip())
        if m:
            return name, m
    return None


def _asset_of(name: str) -> str | None:
    for code, full in ASSET_NAMES.items():
        if name.lower() in (full.lower(), code.lower()):
            return code
    return None


def keep_hourly(m: re.Match[str], end: datetime) -> bool:
    """Una hora por día: la hora ET que coincide con (día del año mod 24)."""
    hour = int(m.group("h")) % 12 + (12 if m.group("p") == "PM" else 0)
    month = MONTHS.get(m.group("m").lower(), 0)
    try:
        doy = datetime(end.year, month, int(m.group("d"))).timetuple().tm_yday
    except ValueError:
        return False
    return hour == doy % 24


class DatasetBuilder:
    def __init__(self, gamma: ApiClient, clob: ApiClient, cache: GzCache) -> None:
        self.gamma = gamma
        self.clob = clob
        self.cache = cache
        self.stats = DatasetStats()
        self._full: dict[str, dict[str, Any]] = {}  # eventos ya recibidos con mercados

    def _get(self, kind: str, path: str, params: Any, *, refresh: bool = False) -> dict[str, Any]:
        key = json.dumps([path, params], sort_keys=True, default=str)
        rec = None if refresh else self.cache.get(kind, key)
        if rec is None:
            resp = self.gamma.request_json("GET", path, params=params)
            rec = self.cache.put(kind, key, resp.url, resp.data, resp.received_at)
        return rec

    def list_events(self, plan: DatasetPlan) -> list[dict[str, Any]]:
        """Eventos cerrados (sin mercados) por búsqueda de título, en tramos de 15 días."""
        out: dict[str, dict[str, Any]] = {}
        for asset in plan.assets:
            name = ASSET_NAMES[asset]
            for tmpl in SEARCHES:
                q = tmpl.format(name=name)
                t0 = plan.start
                while t0 < plan.end:
                    t1 = min(t0 + timedelta(days=15), plan.end)
                    cursor = None
                    while True:
                        params: dict[str, Any] = {
                            "limit": 100,
                            "closed": "true",
                            "include_markets": "false",
                            "title_search": q,
                            "end_date_min": t0.isoformat().replace("+00:00", "Z"),
                            "end_date_max": t1.isoformat().replace("+00:00", "Z"),
                        }
                        if cursor:
                            params["after_cursor"] = cursor
                        rec = self._get("gamma_events_list", "/events/keyset", params)
                        events = rec["data"].get("events") or []
                        for e in events:
                            out[str(e["id"])] = {
                                k: e.get(k) for k in ("id", "title", "slug", "endDate", "startDate")
                            }
                        cursor = rec["data"].get("next_cursor")
                        if not cursor or not events:
                            break
                    t0 = t1
        return list(out.values())

    def select(self, plan: DatasetPlan, events: list[dict[str, Any]]) -> list[tuple[str, str, str]]:
        """(event_id, tipo, activo) elegidos con la regla de muestreo fija."""
        types = plan.types_by_asset or DEFAULT_TYPES_BY_ASSET
        chosen: list[tuple[str, str, str]] = []
        for e in events:
            c = classify_event(e.get("title") or "")
            end = parse_iso(e.get("endDate"))
            if c is None or end is None or not (plan.start <= end < plan.end):
                continue
            etype, m = c
            asset = _asset_of(m.group("a"))
            if asset is None or asset not in plan.assets:
                continue
            self.stats.events_listed[etype] += 1
            if etype not in types.get(asset, ()):
                continue
            if EVENT_TYPES[etype][1] and not keep_hourly(m, end):
                continue
            self.stats.events_selected[etype] += 1
            chosen.append((str(e["id"]), etype, asset))
        chosen.sort()
        return chosen

    def updown_events(self, plan: DatasetPlan) -> list[tuple[str, str, str]]:
        """Eventos Up or Down (horario muestreado y diario) pedidos por slug."""
        types = plan.types_by_asset or DEFAULT_TYPES_BY_ASSET
        wanted: dict[str, tuple[str, str]] = {}
        for slug, etype, asset in updown_slugs(plan):
            if etype in types.get(asset, ()):
                wanted[slug] = (etype, asset)
        chosen: list[tuple[str, str, str]] = []
        slugs = sorted(wanted)
        for i in range(0, len(slugs), 20):
            batch = slugs[i : i + 20]
            params = [("slug", x) for x in batch] + [
                ("include_markets", "true"),
                ("closed", "any"),
                ("limit", 20),
            ]
            try:
                rec = self._get("gamma_events_full", "/events/keyset", params)
            except ApiError as exc:
                self.stats.errors.append(f"slugs {batch[0]}..: {exc}")
                continue
            found = {e.get("slug"): e for e in rec["data"].get("events") or []}
            for slug in batch:
                etype, asset = wanted[slug]
                self.stats.events_listed[etype] += 1
                e = found.get(slug)
                if e is None:
                    self.stats.unsupported["evento Up or Down no encontrado por slug"] += 1
                    continue
                end = parse_iso(e.get("endDate"))
                if end is None or not (plan.start <= end < plan.end):
                    continue
                self._full[str(e["id"])] = e
                self.stats.events_selected[etype] += 1
                chosen.append((str(e["id"]), etype, asset))
        return chosen

    def event_markets(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {k: v for k, v in self._full.items() if k in set(ids)}
        pending = [x for x in ids if x not in out]
        for i in range(0, len(pending), 20):
            batch = pending[i : i + 20]
            params = [("id", x) for x in batch] + [
                ("include_markets", "true"),
                ("closed", "any"),
                ("limit", 20),
            ]
            try:
                rec = self._get("gamma_events_full", "/events/keyset", params)
            except ApiError as exc:
                self.stats.errors.append(f"eventos {batch[0]}..: {exc}")
                continue
            for e in rec["data"].get("events") or []:
                out[str(e["id"])] = e
        return out

    def resolved_markets(
        self, chosen: list[tuple[str, str, str]], full: dict[str, dict[str, Any]]
    ) -> list[ResolvedMarket]:
        out: list[ResolvedMarket] = []
        for eid, etype, _asset in chosen:
            ev = full.get(eid)
            if ev is None:
                self.stats.errors.append(f"evento {eid} sin respuesta")
                continue
            for raw in ev.get("markets") or []:
                mv = MarketView.from_gamma(raw, category="crypto", event=ev)
                terms = parse_crypto_terms(mv)
                if isinstance(terms, Unsupported):
                    self.stats.unsupported[terms.reason] += 1
                    continue
                if terms.yes_outcome not in mv.outcomes or len(mv.token_ids) != len(mv.outcomes):
                    self.stats.unsupported["resultado YES/Up no encontrado"] += 1
                    continue
                prices = raw.get("outcomePrices")
                if isinstance(prices, str):
                    try:
                        prices = json.loads(prices)
                    except ValueError:
                        prices = None
                yes_i = mv.outcomes.index(terms.yes_outcome)
                try:
                    p_yes = float(prices[yes_i]) if prices else None
                except (TypeError, ValueError, IndexError):
                    p_yes = None
                resolved = raw.get("umaResolutionStatus") == "resolved" or raw.get("closed")
                if not resolved or p_yes not in (0.0, 0.5, 1.0):
                    self.stats.unresolved += 1
                    continue
                self.stats.markets[terms.variant] += 1
                out.append(
                    ResolvedMarket(
                        market=mv,
                        terms=terms,
                        event_id=eid,
                        event_type=etype,
                        yes_index=yes_i,
                        outcome_yes=p_yes,
                        closed_time=parse_iso(raw.get("closedTime")),
                        created_at=parse_iso(raw.get("createdAt")),
                    )
                )
        return out

    def price_history(
        self, token_id: str, start: datetime, end: datetime, fidelity_min: int
    ) -> tuple[list[tuple[int, float]], list[dict[str, Any]]]:
        """Serie (epoch s, precio) del token en [start, end], en tramos de 14 días."""
        pts: dict[int, float] = {}
        refs: list[dict[str, Any]] = []
        t0 = start
        while t0 < end:
            t1 = min(t0 + timedelta(days=14), end)
            params = {
                "market": token_id,
                "startTs": int(t0.timestamp()),
                "endTs": int(t1.timestamp()),
                "fidelity": fidelity_min,
            }
            key = json.dumps(params, sort_keys=True)
            rec = self.cache.get("prices_history", key)
            if rec is None:
                resp = self.clob.request_json("GET", "/prices-history", params=params)
                rec = self.cache.put("prices_history", key, resp.url, resp.data, resp.received_at)
            refs.append(
                {"url": rec["url"], "sha256": rec["sha256"], "received_at": rec["received_at"]}
            )
            for x in rec["data"].get("history") or []:
                pts[int(x["t"])] = float(x["p"])
            t0 = t1
        return sorted(pts.items()), refs


def updown_slugs(plan: DatasetPlan) -> list[tuple[str, str, str]]:
    """Slugs de los eventos Up or Down: horario (una hora ET por día, rotando) y diario."""
    out: list[tuple[str, str, str]] = []
    d = plan.start.astimezone(ET).date()
    last = plan.end.astimezone(ET).date()
    while d <= last:
        doy = d.timetuple().tm_yday
        hour = doy % 24
        h12 = hour % 12 or 12
        ampm = "am" if hour < 12 else "pm"
        month = MONTH_NAMES[d.month - 1]
        for asset in plan.assets:
            name = ASSET_NAMES[asset].lower()
            out.append(
                (
                    f"{name}-up-or-down-{month}-{d.day}-{d.year}-{h12}{ampm}-et",
                    "hourly_updown",
                    asset,
                )
            )
            out.append((f"{name}-up-or-down-on-{month}-{d.day}-{d.year}", "daily_updown", asset))
        d += timedelta(days=1)
    return out


def history_window(rm: ResolvedMarket, first_as_of: datetime) -> tuple[datetime, datetime, int]:
    """Rango y resolución (minutos) de la historia de precios a pedir para un mercado."""
    end = rm.terms.resolution_time
    start = max(first_as_of - timedelta(hours=2), rm.market.start_date or first_as_of)
    span = end - start
    fidelity = 1 if span <= timedelta(days=2) else (10 if span <= timedelta(days=15) else 60)
    return start, end, fidelity


def dataset_record(rm: ResolvedMarket) -> dict[str, Any]:
    m = rm.market
    return {
        "market_id": m.market_id,
        "event_id": rm.event_id,
        "event_type": rm.event_type,
        "question": m.question,
        "rules_sha256": m.rules_sha256,
        "outcomes": list(m.outcomes),
        "yes_index": rm.yes_index,
        "yes_token": rm.yes_token,
        "outcome_yes": rm.outcome_yes,
        "closed_time": rm.closed_time.isoformat() if rm.closed_time else None,
        "created_at": rm.created_at.isoformat() if rm.created_at else None,
        "start_date": m.start_date.isoformat() if m.start_date else None,
        "end_date": m.end_date.isoformat() if m.end_date else None,
        "fee_rate": m.fee_rate,
        "fee_exponent": m.fee_exponent,
        "terms": rm.terms.to_dict(),
    }


def save_dataset(path: Path, records: list[dict[str, Any]], meta: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps({"meta": meta, "markets": records}, ensure_ascii=False, sort_keys=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        fh.write(blob)
    return hashlib.sha256(blob.encode()).hexdigest()


def now_iso() -> str:
    return utcnow().astimezone(UTC).isoformat()


def build_dataset(
    gamma: ApiClient,
    clob: ApiClient,
    cache: GzCache,
    plan: DatasetPlan,
    out_path: Path,
    *,
    with_prices: bool = True,
) -> dict[str, Any]:
    """Arma el conjunto completo y lo guarda comprimido. Devuelve el resumen."""
    from radar.predict.crypto.schedule import SCHEDULE_VERSION, prediction_times

    b = DatasetBuilder(gamma, clob, cache)
    started = utcnow()
    events = b.list_events(plan)
    chosen = b.select(plan, events) + b.updown_events(plan)
    log.info("dataset_events", listed=len(events), chosen=len(chosen))
    full = b.event_markets([eid for eid, _, _ in chosen])
    rms = b.resolved_markets(chosen, full)
    log.info("dataset_markets", markets=len(rms))
    records = []
    missing_prices = 0
    for i, rm in enumerate(rms):
        rec = dataset_record(rm)
        times = prediction_times(rm.terms, rm.created_at)
        rec["as_of"] = [t.isoformat() for t in times]
        if with_prices and times:
            start, end, fid = history_window(rm, times[0])
            try:
                pts, refs = b.price_history(rm.yes_token, start, end, fid)
            except ApiError as exc:
                b.stats.errors.append(f"precios {rm.market.market_id}: {exc}")
                pts, refs = [], []
            if not pts:
                missing_prices += 1
            rec["price_history"] = pts
            rec["price_fidelity_min"] = fid
            rec["price_refs"] = refs
        records.append(rec)
        if (i + 1) % 500 == 0:
            log.info("dataset_progress", done=i + 1, total=len(rms))
    meta = {
        "version": DATASET_VERSION,
        "schedule_version": SCHEDULE_VERSION,
        "plan": {
            "start": plan.start.isoformat(),
            "end": plan.end.isoformat(),
            "assets": list(plan.assets),
            "types_by_asset": plan.types_by_asset or DEFAULT_TYPES_BY_ASSET,
            "hourly_sampling": "una hora ET por día: hora = día del año mod 24",
        },
        "started_at": started.isoformat(),
        "finished_at": utcnow().isoformat(),
        "stats": b.stats.to_dict(),
        "markets": len(records),
        "markets_without_prices": missing_prices,
        "price_basis": "precio_referencia_no_ejecutable (CLOB /prices-history)",
    }
    sha = save_dataset(out_path, records, meta)
    meta["sha256"] = sha
    return meta


def load_dataset(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)
