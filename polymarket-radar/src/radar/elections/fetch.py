"""Descarga de las revisiones de Wikipedia necesarias para cada instante de evaluación.

Para cada instante T se usa la última revisión con timestamp <= T. Las
revisiones se guardan en la caché en disco (ver ``sources.wikimedia``); el
manifiesto resultante lista exactamente qué revisión respalda cada T.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from radar.elections.contests import Contest
from radar.elections.sources.wikimedia import Revision, WikiDocument, WikimediaClient
from radar.logging_setup import get_logger

log = get_logger(__name__)


def evaluation_times(contest: Contest, *, step_hours: int = 12) -> list[datetime]:
    """Instantes de evaluación entre la definición de la contienda y el cierre de urnas.

    Cada ``step_hours`` (alineado a 00:00/12:00 UTC) y, el día de la elección,
    00, 06, 12, 15, 18, 19 h y un minuto antes del cierre.
    """
    if contest.defined_from_utc is None:
        raise ValueError("la contienda no define defined_from_utc")
    close = contest.polls_close_utc
    t = contest.defined_from_utc
    times: list[datetime] = []
    while t < close - timedelta(hours=24):
        times.append(t)
        t += timedelta(hours=step_hours)
    day = datetime(close.year, close.month, close.day, tzinfo=UTC)
    for h in (0, 6, 12, 15, 18, 19):
        x = day + timedelta(hours=h)
        if x < close and x not in times and x > times[-1]:
            times.append(x)
    times.append(close - timedelta(minutes=1))
    return times


@dataclass
class PointInTimeDoc:
    t: datetime
    revision: Revision | None
    document: WikiDocument | None
    error: str | None = None


def fetch_point_in_time(
    client: WikimediaClient,
    contest: Contest,
    times: list[datetime],
    *,
    revisions: list[Revision] | None = None,
) -> list[PointInTimeDoc]:
    title = contest.poll_source.title
    if revisions is None:
        start = min(times) - timedelta(days=30)
        revisions = client.revisions(title, start, max(times))
    log.info("wiki_revisions_listed", title=title, n=len(revisions))
    out: list[PointInTimeDoc] = []
    by_revid: dict[int, WikiDocument] = {}
    for t in times:
        rev = client.revision_at(revisions, t)
        if rev is None:
            out.append(PointInTimeDoc(t, None, None, "sin revisión anterior a T"))
            continue
        try:
            doc = by_revid.get(rev.revid) or client.revision_html(title, rev)
        except Exception as exc:  # se registra y se sigue con el resto
            out.append(PointInTimeDoc(t, rev, None, f"{type(exc).__name__}: {exc}"[:300]))
            log.warning("wiki_revision_failed", revid=rev.revid, error=str(exc)[:200])
            continue
        by_revid[rev.revid] = doc
        out.append(PointInTimeDoc(t, rev, doc))
        log.info(
            "wiki_revision_ready",
            t=t.isoformat(),
            revid=rev.revid,
            revision_ts=rev.timestamp.isoformat(),
            cached=doc.from_cache,
        )
    return out


def write_manifest(path: Path, contest: Contest, docs: list[PointInTimeDoc]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "t": d.t.isoformat(),
            "revid": d.revision.revid if d.revision else None,
            "revision_ts": d.revision.timestamp.isoformat() if d.revision else None,
            "sha256": d.document.sha256 if d.document else None,
            "retrieved_at": d.document.retrieved_at.isoformat() if d.document else None,
            "url": d.document.url if d.document else None,
            "error": d.error,
        }
        for d in docs
    ]
    path.write_text(
        json.dumps(
            {"contest": contest.key, "source": contest.poll_source.title, "points": rows},
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
