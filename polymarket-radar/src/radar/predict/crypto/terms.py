"""Lectura determinista de contratos cripto de Polymarket (versión ``crypto-terms-v1``).

Convierte pregunta + reglas en un contrato preciso o devuelve el motivo por el
que no se puede modelar. No usa IA ni heurísticas difusas: cada variante tiene
un patrón explícito tomado de reglas reales (ver ``tests/test_predict_terms.py``).

Variantes soportadas (todas resueltas con velas de Binance spot ``XXX/USDT``):

- ``terminal``: precio de cierre de una vela concreta por encima/debajo de un
  nivel o dentro de un rango (diarios a las 12:00 ET con vela de 1 minuto;
  horarios con vela de 1 hora).
- ``updown``: cierre de una vela frente a la apertura de la misma vela (horarios)
  o frente al cierre de una vela anterior (diarios de mediodía a mediodía).
- ``touch``: algún máximo (o mínimo) de vela de 1 minuto alcanza el nivel dentro
  de una ventana (día, rango de días, mes, hasta una fecha).

Todo lo demás (Chainlink, dominancia, FDV, días verdes, "mejor rendimiento",
máximos históricos, otras fuentes) se devuelve como no soportado con su motivo.

Interpretación de velas: Binance etiqueta cada vela por su hora de apertura.
"vela de 1 minuto que cierra a las 12:00" = vela que abre a las 11:59. "la vela
de las 12:00" = vela que abre a las 12:00. Ambas lecturas se contrastan contra los
resultados reales de Polymarket en el backtest (tasa de coincidencia).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from radar.predict.base import MarketView

TERMS_VERSION = "crypto-terms-v1"
ET = ZoneInfo("America/New_York")

ASSETS: dict[str, str] = {
    "bitcoin": "BTC",
    "btc": "BTC",
    "ethereum": "ETH",
    "eth": "ETH",
    "solana": "SOL",
    "sol": "SOL",
    "xrp": "XRP",
    "dogecoin": "DOGE",
    "doge": "DOGE",
    "bnb": "BNB",
    "hyperliquid": "HYPE",
    "hype": "HYPE",
    "zcash": "ZEC",
    "zec": "ZEC",
    "ethena": "ENA",
    "chainlink": "LINK",
    "sui": "SUI",
    "avax": "AVAX",
    "avalanche": "AVAX",
    "uni": "UNI",
    "uniswap": "UNI",
    "aster": "ASTER",
    "plasma": "XPL",
    "monero": "XMR",
    "litecoin": "LTC",
    "cardano": "ADA",
    "pepe": "PEPE",
    "tron": "TRX",
    "near": "NEAR",
    "aave": "AAVE",
}

_QUOTES = str.maketrans({"\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'"})

MONTHS = {
    m: i + 1
    for i, m in enumerate(
        [
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
    )
}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})


def _num(name: str) -> str:
    return rf"\$?(?P<{name}>[0-9][0-9,]*(?:\.[0-9]+)?)\s*(?P<{name}_s>[kKmMbB])?"


CHAINLINK = "resolución por Chainlink Data Streams: sin historial público verificable"
_CHAINLINK_SOURCE = re.compile(
    r"chain\.link|information from Chainlink|Chainlink data stream", re.I
)
_PAIR = re.compile(r"\b([A-Z0-9]{2,10})\s*/\s*USDT\b")


@dataclass(frozen=True)
class CryptoTerms:
    kind: str  # terminal | updown | touch
    asset: str
    symbol: str  # par de Binance, p. ej. BTCUSDT
    yes_outcome: str  # resultado que paga si se cumple la condición ("Yes" / "Up")
    variant: str  # p. ej. daily_above, hourly_above, daily_range, hourly_updown, touch_month
    # terminal / updown (objetivo): vela observada
    candle: str | None = None  # 1m | 1h
    obs_open: datetime | None = None
    lower: float | None = None
    upper: float | None = None
    lower_inclusive: bool = False
    upper_inclusive: bool = False
    # updown: referencia
    ref_open: datetime | None = None
    ref_candle: str | None = None
    ref_field: str | None = None  # open | close
    tie: str | None = None  # up | half
    # touch
    direction: str | None = None  # high | low
    barrier: float | None = None
    window_start: datetime | None = None
    window_end: datetime | None = None  # exclusivo: la última vela abre a window_end - 1m
    notes: tuple[str, ...] = field(default_factory=tuple)

    @property
    def resolution_time(self) -> datetime:
        """Instante en que el dato que decide el resultado queda cerrado."""
        if self.kind == "touch":
            assert self.window_end is not None
            return self.window_end
        assert self.obs_open is not None and self.candle is not None
        return self.obs_open + candle_delta(self.candle)

    @classmethod
    def from_dict(cls, d: dict[str, object]) -> CryptoTerms:
        kw: dict[str, object] = {}
        for k in cls.__dataclass_fields__:
            v = d.get(k)
            if k in ("obs_open", "ref_open", "window_start", "window_end") and isinstance(v, str):
                v = datetime.fromisoformat(v)
            if k == "notes":
                v = tuple(v or ())  # type: ignore[arg-type]
            kw[k] = v
        return cls(**kw)  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, object]:
        out: dict[str, object] = {}
        for k, v in self.__dict__.items():
            out[k] = v.isoformat() if isinstance(v, datetime) else v
        out["notes"] = list(self.notes)
        out["version"] = TERMS_VERSION
        return out


@dataclass(frozen=True)
class Unsupported:
    reason: str


def candle_delta(candle: str) -> timedelta:
    return {"1m": timedelta(minutes=1), "1h": timedelta(hours=1)}[candle]


def parse_amount(num: str, suffix: str | None) -> float:
    value = float(num.replace(",", ""))
    mult = {"k": 1e3, "m": 1e6, "b": 1e9}.get((suffix or "").lower(), 1.0)
    return value * mult


def et_to_utc(d: date, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=ET).astimezone(UTC)


def _infer_date(month: int, day: int, ref: datetime | None) -> date | None:
    """Fecha sin año: el año que deja la fecha más cerca de ``ref`` (fin del mercado)."""
    if ref is None:
        return None
    best: date | None = None
    for y in (ref.year - 1, ref.year, ref.year + 1):
        try:
            cand = date(y, month, day)
        except ValueError:
            continue
        if best is None or abs((cand - ref.date()).days) < abs((best - ref.date()).days):
            best = cand
    return best


def _hour24(hour: str, ampm: str) -> int:
    h = int(hour) % 12
    return h + 12 if ampm.upper() == "PM" else h


def _asset(name: str) -> str | None:
    return ASSETS.get(name.strip().lower())


def _pair(description: str) -> str | None:
    m = _PAIR.search(description)
    return m.group(1) if m else None


def _check_source(market: MarketView, asset: str) -> tuple[str, str] | Unsupported:
    desc = market.description.translate(_QUOTES)
    low = desc.lower()
    if _CHAINLINK_SOURCE.search(desc):
        return Unsupported(CHAINLINK)
    if "binance" not in low:
        return Unsupported("fuente de resolución distinta de Binance: no soportada")
    if "binance.com/en/futures" in low:
        return Unsupported(
            "resolución con futuros de Binance: datos en vivo no accesibles desde este entorno"
        )
    pair = _pair(desc)
    if pair is None:
        return Unsupported("no se encontró el par XXX/USDT en las reglas")
    if pair != asset:
        return Unsupported(f"activo de la pregunta ({asset}) distinto del par ({pair})")
    return asset, f"{pair}USDT"


def _near_end(obs: datetime, market: MarketView, tol: timedelta = timedelta(days=3)) -> bool:
    return market.end_date is None or abs(obs - market.end_date) <= tol


# --- patrones (pregunta) ----------------------------------------------------------------

RE_DAILY_LEVEL = re.compile(
    rf"^Will the price of (?P<asset>[A-Za-z]+) be (?P<op>above|below|greater than|less than) "
    rf"{_num('k')} on (?P<month>[A-Za-z]+) (?P<day>\d{{1,2}})\?$"
)
RE_DAILY_RANGE = re.compile(
    rf"^Will the price of (?P<asset>[A-Za-z]+) be between {_num('l')} and "
    rf"{_num('u')} on (?P<month>[A-Za-z]+) "
    rf"(?P<day>\d{{1,2}})\?$"
)
RE_HOURLY_LEVEL = re.compile(
    rf"^(?P<asset>[A-Za-z]+) (?P<op>above|below) {_num('k')} on (?P<month>[A-Za-z]+) "
    rf"(?P<day>\d{{1,2}}), (?P<hour>\d{{1,2}})(?P<ampm>AM|PM) ET\?$"
)
RE_HOURLY_UPDOWN = re.compile(
    r"^(?P<asset>[A-Za-z]+) Up or Down - (?P<month>[A-Za-z]+) (?P<day>\d{1,2}), "
    r"(?P<hour>\d{1,2})(?P<ampm>AM|PM) ET$"
)
RE_DAILY_UPDOWN = re.compile(
    r"^(?P<asset>[A-Za-z]+) Up or Down on (?P<month>[A-Za-z]+) (?P<day>\d{1,2})\?$"
)
RE_TOUCH = re.compile(
    rf"^Will (?P<asset>[A-Za-z]+) (?P<verb>reach|hit|dip to) {_num('k')} (?P<when>.+)\?$"
)

# --- patrones (reglas) ----------------------------------------------------------------

D_DAILY_NOON_CLOSE = re.compile(
    r"1[ -]minute candle for [A-Z0-9]+/USDT closing at 12:00 in the ET timezone", re.I
)
D_HOURLY_ENDS = re.compile(r"1 hour candle that ends on the time and date", re.I)
D_HOURLY_BEGINS = re.compile(
    r"close price is greater than or equal to the open price for the [A-Z0-9]+/USDT "
    r"1 hour candle that begins on the time and date",
    re.I,
)
D_DAILY_UPDOWN = re.compile(
    r"1 minute candle for [A-Z0-9]+/USDT (?P<m1>[A-Za-z]{3}) (?P<d1>\d{1,2}) '(?P<y1>\d{2}) "
    r"12:00 in the ET timezone \(noon\) is lower than the final \"Close\" price for the "
    r"(?P<m2>[A-Za-z]{3}) (?P<d2>\d{1,2}) '(?P<y2>\d{2}) 12:00 ET candle",
    re.I,
)
D_TOUCH_HIGH = re.compile(r"final \"?High\"? price equal to or greater than", re.I)
D_TOUCH_LOW = re.compile(r"final \"?Low\"? price equal to or (?:lower|less) than", re.I)
D_TOUCH_EITHER = re.compile(
    r"final \"?High\"? or \"?Low\"? price equal to or beyond \(above for .{0,3}High Prices, "
    r"below for .{0,3}Low Prices\)",
    re.I,
)
D_UNTIL_DATE = re.compile(
    r"\"?High\"? price equal to or greater than the price specified in the title by "
    r"11:59 ?PM ET on the date specified in the title",
    re.I,
)
D_EXPLICIT_WINDOW = re.compile(
    r"between (?P<m1>[A-Za-z]+) (?P<d1>\d{1,2}), (?P<y1>\d{4}),? (?P<h1>\d{1,2}):(?P<mi1>\d{2}) "
    r"and (?P<m2>[A-Za-z]+) (?P<d2>\d{1,2}), (?P<y2>\d{4}),? (?P<h2>\d{1,2}):(?P<mi2>\d{2}) "
    r"in the ET timezone",
    re.I,
)
D_FROM_CREATION = re.compile(
    r"from the creation of this market (?:until|through) 11:59 PM ET on "
    r"(?:the date specified|the last day of the year specified)",
    re.I,
)
D_CREATION_AND = re.compile(
    r"between the creation of this market and (?P<m>[A-Za-z]+) (?P<d>\d{1,2}), (?P<y>\d{4}),? "
    r"23:59 ET",
    re.I,
)
D_MONTH = re.compile(r"during the month specified in the title", re.I)
D_DATE_RANGE = re.compile(r"during the date range specified in the title", re.I)
D_ON_DATE = re.compile(
    r"on the date specified in the title, between 12:00 AM ET and 11:59 PM ET", re.I
)


def parse_crypto_terms(market: MarketView) -> CryptoTerms | Unsupported:
    q = market.question.strip()
    desc = market.description.translate(_QUOTES)

    for rx, handler in (
        (RE_DAILY_RANGE, _daily_range),
        (RE_DAILY_LEVEL, _daily_level),
        (RE_HOURLY_LEVEL, _hourly_level),
        (RE_HOURLY_UPDOWN, _hourly_updown),
        (RE_DAILY_UPDOWN, _daily_updown),
        (RE_TOUCH, _touch),
    ):
        m = rx.match(q)
        if m is None:
            continue
        asset = _asset(m.group("asset"))
        if asset is None:
            return Unsupported(f"activo no soportado: {m.group('asset')}")
        src = _check_source(market, asset)
        if isinstance(src, Unsupported):
            return src
        return handler(market, m, src[0], src[1], desc)

    low = q.lower()
    if "up or down" in low and re.search(r"\d:\d\d[AP]M-", q):
        if _CHAINLINK_SOURCE.search(desc):
            return Unsupported(CHAINLINK)
        return Unsupported("variante Up or Down por intervalo no reconocida")
    return Unsupported("tipo de contrato cripto no modelado")


def _daily_level(
    market: MarketView, m: re.Match[str], asset: str, symbol: str, desc: str
) -> CryptoTerms | Unsupported:
    if not D_DAILY_NOON_CLOSE.search(desc):
        return Unsupported("reglas diarias sin la vela de 1 minuto de las 12:00 ET")
    d = _infer_date(MONTHS.get(m.group("month").lower(), 0), int(m.group("day")), market.end_date)
    if d is None:
        return Unsupported("fecha no interpretable")
    k = parse_amount(m.group("k"), m.group("k_s"))
    obs_open = et_to_utc(d, 12) - timedelta(minutes=1)  # vela que cierra a las 12:00 ET
    if not _near_end(obs_open, market):
        return Unsupported("fecha de observación lejos del fin del mercado: ambigua")
    op = m.group("op")
    above = op in ("above", "greater than")
    if op == "above" and "higher than" not in desc:
        return Unsupported("comparación 'above' sin 'higher than' en las reglas")
    return CryptoTerms(
        kind="terminal",
        asset=asset,
        symbol=symbol,
        yes_outcome="Yes",
        variant="daily_above" if above else "daily_below",
        candle="1m",
        obs_open=obs_open,
        lower=k if above else None,
        upper=None if above else k,
        # "greater than" es el tramo superior de un rango: el empate va al tramo superior
        lower_inclusive=(op == "greater than"),
        upper_inclusive=False,
        notes=("año inferido del fin del mercado",),
    )


def _daily_range(
    market: MarketView, m: re.Match[str], asset: str, symbol: str, desc: str
) -> CryptoTerms | Unsupported:
    if not D_DAILY_NOON_CLOSE.search(desc):
        return Unsupported("reglas de rango sin la vela de 1 minuto de las 12:00 ET")
    if "higher range bracket" not in desc:
        return Unsupported("regla de empate entre tramos no encontrada")
    d = _infer_date(MONTHS.get(m.group("month").lower(), 0), int(m.group("day")), market.end_date)
    if d is None:
        return Unsupported("fecha no interpretable")
    lo = parse_amount(m.group("l"), m.group("l_s"))
    hi = parse_amount(m.group("u"), m.group("u_s"))
    if not hi > lo:
        return Unsupported("rango inválido")
    obs_open = et_to_utc(d, 12) - timedelta(minutes=1)
    if not _near_end(obs_open, market):
        return Unsupported("fecha de observación lejos del fin del mercado: ambigua")
    return CryptoTerms(
        kind="terminal",
        asset=asset,
        symbol=symbol,
        yes_outcome="Yes",
        variant="daily_range",
        candle="1m",
        obs_open=obs_open,
        lower=lo,
        upper=hi,
        lower_inclusive=True,  # el valor exacto en un borde va al tramo superior
        upper_inclusive=False,
        notes=("año inferido del fin del mercado",),
    )


def _hourly_level(
    market: MarketView, m: re.Match[str], asset: str, symbol: str, desc: str
) -> CryptoTerms | Unsupported:
    if not D_HOURLY_ENDS.search(desc) or "higher than" not in desc:
        return Unsupported("reglas horarias sin 'vela de 1 hora que termina' / 'higher than'")
    d = _infer_date(MONTHS.get(m.group("month").lower(), 0), int(m.group("day")), market.end_date)
    if d is None:
        return Unsupported("fecha no interpretable")
    close = et_to_utc(d, _hour24(m.group("hour"), m.group("ampm")))
    obs_open = close - timedelta(hours=1)
    if not _near_end(close, market):
        return Unsupported("hora de observación lejos del fin del mercado: ambigua")
    k = parse_amount(m.group("k"), m.group("k_s"))
    above = m.group("op") == "above"
    if not above:
        return Unsupported("variante horaria 'below' no verificada")
    return CryptoTerms(
        kind="terminal",
        asset=asset,
        symbol=symbol,
        yes_outcome="Yes",
        variant="hourly_above",
        candle="1h",
        obs_open=obs_open,
        lower=k,
        lower_inclusive=False,
        notes=("año inferido del fin del mercado",),
    )


def _hourly_updown(
    market: MarketView, m: re.Match[str], asset: str, symbol: str, desc: str
) -> CryptoTerms | Unsupported:
    if not D_HOURLY_BEGINS.search(desc):
        return Unsupported("reglas Up or Down horarias no reconocidas")
    d = _infer_date(MONTHS.get(m.group("month").lower(), 0), int(m.group("day")), market.end_date)
    if d is None:
        return Unsupported("fecha no interpretable")
    open_t = et_to_utc(d, _hour24(m.group("hour"), m.group("ampm")))
    if not _near_end(open_t, market):
        return Unsupported("hora de la vela lejos del fin del mercado: ambigua")
    return CryptoTerms(
        kind="updown",
        asset=asset,
        symbol=symbol,
        yes_outcome="Up",
        variant="hourly_updown",
        candle="1h",
        obs_open=open_t,
        ref_open=open_t,
        ref_candle="1h",
        ref_field="open",
        tie="up",
        notes=("año inferido del fin del mercado",),
    )


def _daily_updown(
    market: MarketView, m: re.Match[str], asset: str, symbol: str, desc: str
) -> CryptoTerms | Unsupported:
    dm = D_DAILY_UPDOWN.search(desc)
    if dm is None or "50-50" not in desc:
        return Unsupported("reglas Up or Down diarias no reconocidas")
    try:
        d1 = date(2000 + int(dm.group("y1")), MONTHS[dm.group("m1").lower()], int(dm.group("d1")))
        d2 = date(2000 + int(dm.group("y2")), MONTHS[dm.group("m2").lower()], int(dm.group("d2")))
    except (KeyError, ValueError):
        return Unsupported("fechas de las reglas no interpretables")
    title_d = _infer_date(
        MONTHS.get(m.group("month").lower(), 0), int(m.group("day")), market.end_date
    )
    if title_d != d2 or (d2 - d1).days != 1:
        return Unsupported("fechas del título y de las reglas no coinciden")
    # "la vela de las 12:00 ET" = vela que abre a las 12:00 (etiqueta de Binance)
    return CryptoTerms(
        kind="updown",
        asset=asset,
        symbol=symbol,
        yes_outcome="Up",
        variant="daily_updown",
        candle="1m",
        obs_open=et_to_utc(d2, 12),
        ref_open=et_to_utc(d1, 12),
        ref_candle="1m",
        ref_field="close",
        tie="half",
    )


def _touch(
    market: MarketView, m: re.Match[str], asset: str, symbol: str, desc: str
) -> CryptoTerms | Unsupported:
    verb = m.group("verb")
    high = bool(D_TOUCH_HIGH.search(desc))
    low = bool(D_TOUCH_LOW.search(desc))
    if D_TOUCH_EITHER.search(desc) and not (high or low):
        # regla combinada "High o Low más allá del nivel": la dirección la da el verbo
        high, low = verb != "dip to", verb == "dip to"
    if high == low:
        return Unsupported("dirección del toque (máximo/mínimo) no determinada en las reglas")
    if (verb == "dip to") != low:
        return Unsupported("verbo de la pregunta y dirección de las reglas no coinciden")
    if "1 minute candle" not in desc and "1-minute candle" not in desc:
        return Unsupported("toque sin velas de 1 minuto en las reglas")
    barrier = parse_amount(m.group("k"), m.group("k_s"))
    when = m.group("when").strip()
    window = _touch_window(market, when, desc)
    if isinstance(window, Unsupported):
        return window
    start, end, variant = window
    if not end > start:
        return Unsupported("ventana de toque vacía")
    if not _near_end(end, market, tol=timedelta(days=3)):
        return Unsupported("fin de la ventana lejos del fin del mercado: ambiguo")
    return CryptoTerms(
        kind="touch",
        asset=asset,
        symbol=symbol,
        yes_outcome="Yes",
        variant=variant,
        direction="high" if high else "low",
        barrier=barrier,
        window_start=start,
        window_end=end,
        notes=("inicio de la ventana = creación del mercado",) if variant == "touch_until" else (),
    )


def _touch_window(
    market: MarketView, when: str, desc: str
) -> tuple[datetime, datetime, str] | Unsupported:
    ref = market.end_date
    ex = D_EXPLICIT_WINDOW.search(desc)
    if ex:
        try:
            d1 = date(int(ex.group("y1")), MONTHS[ex.group("m1").lower()], int(ex.group("d1")))
            d2 = date(int(ex.group("y2")), MONTHS[ex.group("m2").lower()], int(ex.group("d2")))
        except (KeyError, ValueError):
            return Unsupported("ventana explícita no interpretable")
        start = et_to_utc(d1, int(ex.group("h1")), int(ex.group("mi1")))
        end = et_to_utc(d2, int(ex.group("h2")), int(ex.group("mi2"))) + timedelta(minutes=1)
        return start, end, "touch_explicit"
    ca = D_CREATION_AND.search(desc)
    if ca:
        if market.start_date is None:
            return Unsupported("ventana desde la creación sin fecha de creación")
        try:
            d2 = date(int(ca.group("y")), MONTHS[ca.group("m").lower()], int(ca.group("d")))
        except (KeyError, ValueError):
            return Unsupported("fecha final no interpretable")
        return market.start_date, et_to_utc(d2 + timedelta(days=1)), "touch_until"
    if D_FROM_CREATION.search(desc) or D_UNTIL_DATE.search(desc):
        mm = re.match(r"^by ([A-Za-z]+) (\d{1,2}), (\d{4})$", when)
        if not mm or market.start_date is None:
            return Unsupported("ventana 'desde la creación' sin fecha final o de creación")
        try:
            d2 = date(int(mm.group(3)), MONTHS[mm.group(1).lower()], int(mm.group(2)))
        except (KeyError, ValueError):
            return Unsupported("fecha final no interpretable")
        return market.start_date, et_to_utc(d2 + timedelta(days=1)), "touch_until"
    if D_MONTH.search(desc):
        mm = re.match(r"^in ([A-Za-z]+)$", when)
        if not mm or ref is None or mm.group(1).lower() not in MONTHS:
            return Unsupported("mes de la ventana no interpretable")
        month = MONTHS[mm.group(1).lower()]
        probe = ref - timedelta(days=2)
        year = probe.year if probe.month >= month else probe.year - 1
        first = date(year, month, 1)
        nxt = date(year + (month == 12), month % 12 + 1, 1)
        return et_to_utc(first), et_to_utc(nxt), "touch_month"
    if D_DATE_RANGE.search(desc):
        mm = re.match(r"^([A-Za-z]+) (\d{1,2})-(?:([A-Za-z]+) )?(\d{1,2})$", when)
        if not mm:
            return Unsupported("rango de fechas no interpretable")
        m1 = MONTHS.get(mm.group(1).lower(), 0)
        m2 = MONTHS.get((mm.group(3) or mm.group(1)).lower(), 0)
        d1 = _infer_date(m1, int(mm.group(2)), ref)
        d2 = _infer_date(m2, int(mm.group(4)), ref)
        if d1 is None or d2 is None or d2 < d1:
            return Unsupported("rango de fechas no interpretable")
        return et_to_utc(d1), et_to_utc(d2 + timedelta(days=1)), "touch_range"
    if D_ON_DATE.search(desc):
        mm = re.match(r"^on ([A-Za-z]+) (\d{1,2})$", when)
        if not mm:
            return Unsupported("fecha del toque diario no interpretable")
        d = _infer_date(MONTHS.get(mm.group(1).lower(), 0), int(mm.group(2)), ref)
        if d is None:
            return Unsupported("fecha del toque diario no interpretable")
        return et_to_utc(d), et_to_utc(d + timedelta(days=1)), "touch_day"
    return Unsupported("ventana del toque no reconocida en las reglas")
