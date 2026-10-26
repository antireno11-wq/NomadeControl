"""Cliente de solo lectura para Wikipedia (MediaWiki Action API + REST).

Se usa para obtener tablas de encuestas **tal como estaban publicadas en un
instante dado**: cada revisión de una página tiene un id y un timestamp, de modo
que el backtest puede leer exactamente lo que era público en el momento T, sin
información futura.

- ``revisions()``: lista de revisiones (id, timestamp) entre dos fechas
  (``action=query&prop=revisions``, hasta 500 por solicitud).
- ``revision_html()``: HTML de una revisión concreta (REST
  ``/api/rest_v1/page/html/{título}/{revid}``), guardado en una caché en disco
  (gzip) con un manifiesto: revid, timestamp de la revisión, momento de
  descarga y SHA-256 del contenido.

Wikimedia exige un User-Agent con contacto y limita la tasa por IP; el cliente
va lento a propósito y respeta ``Retry-After``.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from radar.ingestion.http import ApiClient, ApiError
from radar.timeutil import parse_iso, utcnow

SOURCE = "wikimedia"
DEFAULT_USER_AGENT = (
    "PolymarketAIRadar/0.1 (https://github.com/antireno11-wq/NomadeControl; "
    "research, read-only, low volume)"
)


@dataclass(frozen=True)
class Revision:
    revid: int
    timestamp: datetime
    size: int | None = None


@dataclass(frozen=True)
class WikiDocument:
    lang: str
    title: str
    revid: int
    revision_ts: datetime
    retrieved_at: datetime
    sha256: str
    url: str
    html: str
    from_cache: bool

    def provenance(self) -> dict[str, object]:
        return {
            "source": SOURCE,
            "lang": self.lang,
            "title": self.title,
            "revid": self.revid,
            "revision_ts": self.revision_ts.isoformat(),
            "retrieved_at": self.retrieved_at.isoformat(),
            "sha256": self.sha256,
            "url": self.url,
        }


def _slug(title: str) -> str:
    return title.replace(" ", "_")


def make_wikimedia_api(
    lang: str = "en",
    *,
    user_agent: str = DEFAULT_USER_AGENT,
    rate_per_s: float = 0.2,
    max_retries: int = 8,
    backoff_base_s: float = 10.0,
    backoff_max_s: float = 120.0,
    timeout_s: float = 90.0,
) -> ApiClient:
    return ApiClient(
        f"https://{lang}.wikipedia.org",
        name=f"wikimedia-{lang}",
        rate_per_s=rate_per_s,
        timeout_s=timeout_s,
        max_retries=max_retries,
        backoff_base_s=backoff_base_s,
        backoff_max_s=backoff_max_s,
        user_agent=user_agent,
    )


class WikimediaClient:
    def __init__(self, api: ApiClient, cache_dir: Path, *, lang: str = "en") -> None:
        self.api = api
        self.cache_dir = cache_dir
        self.lang = lang

    # ------------------------------------------------------------------ revisiones
    def revisions(self, title: str, start: datetime, end: datetime) -> list[Revision]:
        """Revisiones con ``start <= timestamp <= end``, en orden cronológico."""
        out: list[Revision] = []
        params: dict[str, str] = {
            "action": "query",
            "prop": "revisions",
            "titles": title,
            "rvprop": "ids|timestamp|size",
            "rvlimit": "500",
            "rvdir": "newer",
            "rvstart": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "rvend": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "format": "json",
            "formatversion": "2",
        }
        while True:
            resp = self.api.request_json("GET", "/w/api.php", params=params)
            data = resp.data
            pages = (data.get("query") or {}).get("pages") or []
            if not pages or pages[0].get("missing"):
                raise ApiError(
                    f"wikimedia: la página {title!r} no existe",
                    url=resp.url,
                    status=resp.status,
                    error_type="missing_page",
                )
            for rev in pages[0].get("revisions") or []:
                ts = parse_iso(rev.get("timestamp"))
                if ts is None:
                    continue
                out.append(Revision(int(rev["revid"]), ts, rev.get("size")))
            cont = data.get("continue")
            if not cont:
                break
            params = {**params, **{k: str(v) for k, v in cont.items()}}
        return out

    @staticmethod
    def revision_at(revisions: list[Revision], t: datetime) -> Revision | None:
        """Última revisión publicada en o antes de ``t`` (sin mirar al futuro)."""
        best = None
        for rev in revisions:
            if rev.timestamp <= t and (best is None or rev.timestamp > best.timestamp):
                best = rev
        return best

    # ------------------------------------------------------------------ HTML
    def _paths(self, title: str, revid: int) -> tuple[Path, Path]:
        base = self.cache_dir / self.lang / _slug(title)
        return base / f"{revid}.html.gz", base / f"{revid}.json"

    def revision_html(self, title: str, revision: Revision) -> WikiDocument:
        html_path, meta_path = self._paths(title, revision.revid)
        url = (
            f"https://{self.lang}.wikipedia.org/api/rest_v1/page/html/"
            f"{quote(_slug(title), safe='')}/{revision.revid}"
        )
        if html_path.exists() and meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            html = gzip.decompress(html_path.read_bytes()).decode("utf-8")
            if hashlib.sha256(html.encode("utf-8")).hexdigest() != meta["sha256"]:
                raise ValueError(f"caché corrupta para la revisión {revision.revid}")
            return WikiDocument(
                lang=self.lang,
                title=title,
                revid=revision.revid,
                revision_ts=revision.timestamp,
                retrieved_at=datetime.fromisoformat(meta["retrieved_at"]),
                sha256=meta["sha256"],
                url=meta.get("url", url),
                html=html,
                from_cache=True,
            )
        resp = self.api.request_text(
            "GET", f"/api/rest_v1/page/html/{quote(_slug(title), safe='')}/{revision.revid}"
        )
        html = resp.data
        digest = hashlib.sha256(html.encode("utf-8")).hexdigest()
        html_path.parent.mkdir(parents=True, exist_ok=True)
        html_path.write_bytes(gzip.compress(html.encode("utf-8")))
        meta_path.write_text(
            json.dumps(
                {
                    "lang": self.lang,
                    "title": title,
                    "revid": revision.revid,
                    "revision_ts": revision.timestamp.isoformat(),
                    "retrieved_at": resp.received_at.isoformat(),
                    "sha256": digest,
                    "bytes": len(html.encode("utf-8")),
                    "url": url,
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        return WikiDocument(
            lang=self.lang,
            title=title,
            revid=revision.revid,
            revision_ts=revision.timestamp,
            retrieved_at=resp.received_at,
            sha256=digest,
            url=url,
            html=html,
            from_cache=False,
        )

    def latest_revision(self, title: str) -> Revision:
        now = utcnow()
        params = {
            "action": "query",
            "prop": "revisions",
            "titles": title,
            "rvprop": "ids|timestamp|size",
            "rvlimit": "1",
            "format": "json",
            "formatversion": "2",
        }
        resp = self.api.request_json("GET", "/w/api.php", params=params)
        pages = (resp.data.get("query") or {}).get("pages") or []
        if not pages or pages[0].get("missing") or not pages[0].get("revisions"):
            raise ApiError(
                f"wikimedia: la página {title!r} no existe",
                url=resp.url,
                status=resp.status,
                error_type="missing_page",
            )
        rev = pages[0]["revisions"][0]
        return Revision(int(rev["revid"]), parse_iso(rev["timestamp"]) or now, rev.get("size"))
