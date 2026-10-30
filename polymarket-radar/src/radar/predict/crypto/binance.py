"""Velas de 1 minuto de Binance spot, con procedencia verificable y corte temporal.

Fuentes (ambas públicas y oficiales de Binance, solo datos de mercado):

- ``data.binance.vision``: archivos ZIP mensuales y diarios de velas, cada uno
  con su ``.CHECKSUM`` (SHA-256) publicado por Binance. Se descargan una vez, se
  verifica el hash y se guardan en ``data/raw/binance`` (no versionado).
- ``data-api.binance.vision/api/v3/klines``: el mismo dato por REST, para el día en
  curso (los archivos diarios se publican al día siguiente).

``api.binance.com`` responde 451 (ubicación restringida) desde este entorno; por eso
se usan los dominios ``binance.vision``, que Binance publica para datos de mercado.

Corte temporal: ``Candles.until(t)`` deja solo velas **cerradas** en ``t``
(apertura + 1 minuto <= t). Una vela de Binance es pública en cuanto cierra, así
que usarla en ``t`` no filtra información futura.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np

from radar.ingestion.http import ApiClient, ApiError
from radar.predict.base import DataRef
from radar.timeutil import utcnow

BULK_BASE = "https://data.binance.vision"
REST_BASE = "https://data-api.binance.vision"
MINUTE_MS = 60_000
SOURCE = "binance_spot_klines_1m"


def to_ms(t: datetime) -> int:
    return int(t.timestamp() * 1000)


def from_ms(ms: int | np.integer) -> datetime:
    return datetime.fromtimestamp(int(ms) / 1000, tz=UTC)


@dataclass
class Candles:
    """Velas de 1 minuto ordenadas por apertura (ms UTC)."""

    symbol: str
    open_ms: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    refs: list[DataRef] = field(default_factory=list)

    def __len__(self) -> int:
        return int(self.open_ms.size)

    @classmethod
    def empty(cls, symbol: str) -> Candles:
        z = np.array([], dtype=np.float64)
        return cls(symbol, np.array([], dtype=np.int64), z, z, z, z)

    def _slice(self, i: int, j: int) -> Candles:
        return Candles(
            self.symbol,
            self.open_ms[i:j],
            self.open[i:j],
            self.high[i:j],
            self.low[i:j],
            self.close[i:j],
            self.refs,
        )

    def until(self, t: datetime) -> Candles:
        """Solo velas cerradas en ``t``."""
        j = int(np.searchsorted(self.open_ms, to_ms(t) - MINUTE_MS, side="right"))
        return self._slice(0, j)

    def between(self, start: datetime, end: datetime) -> Candles:
        """Velas con apertura en [start, end)."""
        return self.between_ms(to_ms(start), to_ms(end))

    def between_ms(self, start_ms: int, end_ms: int) -> Candles:
        i = int(np.searchsorted(self.open_ms, start_ms, side="left"))
        j = int(np.searchsorted(self.open_ms, end_ms, side="left"))
        return self._slice(i, j)

    @property
    def last_open(self) -> datetime | None:
        return from_ms(self.open_ms[-1]) if len(self) else None

    def bar(self, open_t: datetime, minutes: int) -> tuple[float, float, float, float] | None:
        """(open, high, low, close) de la vela de ``minutes`` minutos que abre en ``open_t``.

        Se agrega desde velas de 1 minuto; devuelve None si falta alguna.
        """
        sub = self.between(open_t, open_t + timedelta(minutes=minutes))
        if len(sub) != minutes:
            return None
        if minutes > 1 and int(sub.open_ms[-1] - sub.open_ms[0]) != (minutes - 1) * MINUTE_MS:
            return None
        return (
            float(sub.open[0]),
            float(sub.high.max()),
            float(sub.low.min()),
            float(sub.close[-1]),
        )

    def coverage_gaps(self) -> int:
        """Número de minutos faltantes entre la primera y la última vela."""
        if len(self) < 2:
            return 0
        span = int((self.open_ms[-1] - self.open_ms[0]) // MINUTE_MS) + 1
        return span - len(self)


def _parse_csv(raw: bytes) -> np.ndarray:
    """CSV de Binance → matriz (n, 5): open_ms, open, high, low, close.

    Desde 2025 los archivos spot usan microsegundos; se normaliza a milisegundos.
    """
    text = raw.decode()
    rows = [ln for ln in text.splitlines() if ln and ln[0].isdigit()]
    if not rows:
        return np.zeros((0, 5))
    arr = np.loadtxt(io.StringIO("\n".join(rows)), delimiter=",", usecols=(0, 1, 2, 3, 4))
    arr = np.atleast_2d(arr)
    ts = arr[:, 0]
    arr[:, 0] = np.where(ts > 1e14, ts // 1000, ts)
    return arr


class BinanceKlines:
    """Descarga y cachea velas de 1 minuto; cada archivo queda con su hash verificado."""

    def __init__(
        self, cache_dir: Path, bulk: ApiClient, rest: ApiClient, *, now: datetime | None = None
    ) -> None:
        self.cache_dir = cache_dir
        self.bulk = bulk
        self.rest = rest
        self.now = now  # para pruebas; por defecto la hora actual

    # --- archivos ------------------------------------------------------------------------

    def _bulk_path(self, symbol: str, period: str, label: str) -> tuple[str, Path]:
        name = f"{symbol}-1m-{label}.zip"
        rel = f"data/spot/{period}/klines/{symbol}/1m/{name}"
        return rel, self.cache_dir / "spot" / period / symbol / name

    def _fetch_bulk(self, symbol: str, period: str, label: str) -> tuple[np.ndarray, DataRef]:
        rel, path = self._bulk_path(symbol, period, label)
        meta_path = path.with_suffix(".json")
        npz_path = path.with_suffix(".npz")
        url = f"{BULK_BASE}/{rel}"
        if meta_path.exists() and npz_path.exists():
            meta = json.loads(meta_path.read_text())
            arr = np.load(npz_path)["a"]
        else:
            ck = self.bulk.request_text("GET", f"/{rel}.CHECKSUM").data.split()
            expected = ck[0].lower() if ck else ""
            resp = self.bulk.request_bytes("GET", f"/{rel}")
            digest = hashlib.sha256(resp.data).hexdigest()
            if digest != expected:
                raise ApiError(
                    f"binance: SHA-256 de {rel} no coincide con CHECKSUM",
                    url=url,
                    error_type="checksum_mismatch",
                )
            with zipfile.ZipFile(io.BytesIO(resp.data)) as zf:
                names = zf.namelist()
                if len(names) != 1:
                    raise ApiError(f"binance: ZIP inesperado {names}", url=url)
                arr = _parse_csv(zf.read(names[0]))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(resp.data)
            np.savez_compressed(npz_path, a=arr)
            meta = {
                "url": url,
                "sha256": digest,
                "checksum_verified": True,
                "retrieved_at": resp.received_at.isoformat(),
                "rows": int(arr.shape[0]),
            }
            meta_path.write_text(json.dumps(meta, indent=1))
        ref = DataRef(
            source=SOURCE,
            kind=f"zip_{period}",
            url=meta["url"],
            sha256=meta["sha256"],
            retrieved_at=meta["retrieved_at"],
            observed_from=from_ms(arr[0, 0]).isoformat() if arr.shape[0] else None,
            observed_until=from_ms(arr[-1, 0]).isoformat() if arr.shape[0] else None,
            note="SHA-256 verificado contra el .CHECKSUM de Binance",
        )
        return arr, ref

    def _fetch_rest(
        self, symbol: str, start: datetime, end: datetime
    ) -> tuple[np.ndarray, DataRef]:
        rows: list[list[float]] = []
        cursor = to_ms(start)
        end_ms = to_ms(end)
        urls: list[str] = []
        received = utcnow()
        while cursor < end_ms:
            params = {
                "symbol": symbol,
                "interval": "1m",
                "startTime": cursor,
                "endTime": end_ms - 1,
                "limit": 1000,
            }
            resp = self.rest.request_json("GET", "/api/v3/klines", params=params)
            urls.append(resp.url)
            received = resp.received_at
            batch = resp.data or []
            if not batch:
                break
            closed_before = to_ms(resp.received_at)
            for k in batch:
                if int(k[0]) + MINUTE_MS > closed_before:
                    continue  # vela aún abierta al recibir la respuesta: no se usa
                rows.append([float(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4])])
            nxt = int(batch[-1][0]) + MINUTE_MS
            if nxt <= cursor:
                break
            cursor = nxt
        arr = np.array(rows) if rows else np.zeros((0, 5))
        blob = json.dumps(rows).encode()
        ref = DataRef(
            source=SOURCE,
            kind="rest",
            url=urls[0] if urls else None,
            sha256=hashlib.sha256(blob).hexdigest(),
            retrieved_at=received.isoformat(),
            observed_from=from_ms(arr[0, 0]).isoformat() if len(rows) else None,
            observed_until=from_ms(arr[-1, 0]).isoformat() if len(rows) else None,
            note=f"{len(urls)} solicitudes REST a data-api.binance.vision",
        )
        return arr, ref

    # --- API pública ---------------------------------------------------------------------

    def extend(self, c: Candles, end: datetime) -> Candles:
        """``c`` más las velas cerradas después de su última y antes de ``end`` (por REST).

        Para corridas largas: el historial se carga una vez con ``load`` y antes de cada
        tanda solo se pide la cola (una solicitud por activo si son menos de 1.000 min).
        """
        end = min(end, self.now or utcnow())
        if not len(c) or int(c.open_ms[-1]) + 2 * MINUTE_MS > to_ms(end):
            return c  # sin historial, o ninguna vela nueva pudo cerrar todavía
        arr, ref = self._fetch_rest(c.symbol, from_ms(int(c.open_ms[-1]) + MINUTE_MS), end)
        if arr.shape[0]:  # solo velas nuevas y ya cerradas en ``end``
            arr = arr[(arr[:, 0] > c.open_ms[-1]) & (arr[:, 0] + MINUTE_MS <= to_ms(end))]
        if not arr.shape[0]:
            return c
        return Candles(
            c.symbol,
            np.concatenate([c.open_ms, arr[:, 0].astype(np.int64)]),
            np.concatenate([c.open, arr[:, 1]]),
            np.concatenate([c.high, arr[:, 2]]),
            np.concatenate([c.low, arr[:, 3]]),
            np.concatenate([c.close, arr[:, 4]]),
            [*c.refs, ref],
        )

    def load(self, symbol: str, start: datetime, end: datetime) -> Candles:
        """Velas con apertura en [start, end), de archivos (pasado) o REST (hoy)."""
        now = self.now or utcnow()
        end = min(end, now)
        today = now.date()
        parts: list[np.ndarray] = []
        refs: list[DataRef] = []
        d = start.date().replace(day=1)
        while d <= end.date():
            nxt_month = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
            month_done = nxt_month <= today
            got_month = False
            if month_done:
                try:
                    arr, ref = self._fetch_bulk(symbol, "monthly", f"{d:%Y-%m}")
                    parts.append(arr)
                    refs.append(ref)
                    got_month = True
                except ApiError as exc:
                    if exc.status != 404:
                        raise
            if not got_month:
                day = max(d, start.date())
                last = min(nxt_month - timedelta(days=1), end.date())
                while day <= last:
                    arr_ref = None
                    if day < today:
                        try:
                            arr_ref = self._fetch_bulk(symbol, "daily", f"{day:%Y-%m-%d}")
                        except ApiError as exc:
                            if exc.status != 404:
                                raise
                    if arr_ref is None:
                        t0 = datetime(day.year, day.month, day.day, tzinfo=UTC)
                        arr_ref = self._fetch_rest(
                            symbol, max(t0, start), min(t0 + timedelta(days=1), end)
                        )
                    parts.append(arr_ref[0])
                    refs.append(arr_ref[1])
                    day += timedelta(days=1)
            d = nxt_month
        if not parts:
            return Candles.empty(symbol)
        arr = np.concatenate(parts)
        arr = arr[np.argsort(arr[:, 0], kind="stable")]
        keep = np.ones(arr.shape[0], dtype=bool)
        keep[1:] = arr[1:, 0] != arr[:-1, 0]
        arr = arr[keep]
        mask = (arr[:, 0] >= to_ms(start)) & (arr[:, 0] < to_ms(end))
        arr = arr[mask]
        return Candles(
            symbol,
            arr[:, 0].astype(np.int64),
            arr[:, 1].copy(),
            arr[:, 2].copy(),
            arr[:, 3].copy(),
            arr[:, 4].copy(),
            refs,
        )


def make_binance(cache_dir: Path, *, user_agent: str) -> BinanceKlines:
    bulk = ApiClient(BULK_BASE, name="binance-vision", rate_per_s=5, user_agent=user_agent)
    rest = ApiClient(REST_BASE, name="binance-data-api", rate_per_s=5, user_agent=user_agent)
    return BinanceKlines(cache_dir, bulk, rest)
