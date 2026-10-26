"""Índice DVOL de Deribit (volatilidad implícita a 30 días, anualizada, en %).

Fuente pública: ``www.deribit.com/api/v2/public/get_volatility_index_data``. Solo
existe para BTC y ETH. Se usan velas horarias; en ``t`` solo se lee el cierre de la
última hora **cerrada** (timestamp de apertura + 1 h <= t).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np

from radar.ingestion.http import ApiClient
from radar.predict.base import DataRef
from radar.timeutil import utcnow

DERIBIT_BASE = "https://www.deribit.com"
SOURCE = "deribit_dvol_1h"
HOUR_MS = 3_600_000
SUPPORTED = ("BTC", "ETH")


@dataclass
class DvolSeries:
    currency: str
    ts_ms: np.ndarray  # apertura de cada hora
    close: np.ndarray
    refs: list[DataRef] = field(default_factory=list)

    def at(self, t: datetime) -> tuple[float, datetime] | None:
        """Cierre de la última hora cerrada en ``t`` y su hora de apertura."""
        cutoff = int(t.timestamp() * 1000) - HOUR_MS
        i = int(np.searchsorted(self.ts_ms, cutoff, side="right")) - 1
        if i < 0:
            return None
        opened = datetime.fromtimestamp(int(self.ts_ms[i]) / 1000, tz=UTC)
        if t - opened > timedelta(hours=3):
            return None  # dato demasiado viejo
        return float(self.close[i]), opened


class DeribitDvol:
    def __init__(self, api: ApiClient, cache_dir: Path, *, now: datetime | None = None) -> None:
        self.api = api
        self.cache_dir = cache_dir
        self.now = now

    def _month(self, currency: str, first: date) -> tuple[list[list[float]], DataRef]:
        nxt = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
        now = self.now or utcnow()
        complete = datetime(nxt.year, nxt.month, nxt.day, tzinfo=UTC) <= now
        path = self.cache_dir / currency / f"{first:%Y-%m}.json"
        if complete and path.exists():
            rec = json.loads(path.read_text())
        else:
            start_ms = int(datetime(first.year, first.month, 1, tzinfo=UTC).timestamp() * 1000)
            end_ms = int(datetime(nxt.year, nxt.month, 1, tzinfo=UTC).timestamp() * 1000) - 1
            end_ms = min(end_ms, int(now.timestamp() * 1000))
            rows: dict[int, float] = {}
            urls: list[str] = []
            cursor_end = end_ms
            received = now
            for _ in range(50):
                params = {
                    "currency": currency,
                    "start_timestamp": start_ms,
                    "end_timestamp": cursor_end,
                    "resolution": 3600,
                }
                resp = self.api.request_json(
                    "GET", "/api/v2/public/get_volatility_index_data", params=params
                )
                urls.append(resp.url)
                received = resp.received_at
                result = resp.data.get("result") or {}
                for ts, _o, _h, _l, c in result.get("data") or []:
                    rows[int(ts)] = float(c)
                cont = result.get("continuation")
                if not cont or int(cont) <= start_ms or int(cont) >= cursor_end:
                    break
                cursor_end = int(cont)
            data = [[t, rows[t]] for t in sorted(rows)]
            blob = json.dumps(data)
            rec = {
                "url": urls[0] if urls else None,
                "requests": len(urls),
                "retrieved_at": received.isoformat(),
                "sha256": hashlib.sha256(blob.encode()).hexdigest(),
                "complete_month": complete,
                "data": data,
            }
            if complete:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(rec))
        ref = DataRef(
            source=SOURCE,
            kind="serie_horaria",
            url=rec["url"],
            sha256=rec["sha256"],
            retrieved_at=rec["retrieved_at"],
            note=f"{currency} {first:%Y-%m}; {rec['requests']} solicitudes",
        )
        return rec["data"], ref

    def load(self, currency: str, start: datetime, end: datetime) -> DvolSeries | None:
        if currency not in SUPPORTED:
            return None
        d = start.date().replace(day=1)
        rows: list[list[float]] = []
        refs: list[DataRef] = []
        while d <= end.date():
            data, ref = self._month(currency, d)
            rows.extend(data)
            refs.append(ref)
            d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        if not rows:
            return DvolSeries(currency, np.array([], dtype=np.int64), np.array([]), refs)
        arr = np.array(sorted({int(t): c for t, c in rows}.items()))
        return DvolSeries(currency, arr[:, 0].astype(np.int64), arr[:, 1].astype(float), refs)


def make_deribit(cache_dir: Path, *, user_agent: str) -> DeribitDvol:
    api = ApiClient(DERIBIT_BASE, name="deribit", rate_per_s=3, user_agent=user_agent)
    return DeribitDvol(api, cache_dir)
