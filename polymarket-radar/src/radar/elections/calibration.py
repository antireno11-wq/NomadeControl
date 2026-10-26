"""Construcción del conjunto de calibración a partir de páginas históricas.

Para cada contienda histórica se usa una revisión de su página de encuestas
(con procedencia: revid, timestamp, SHA-256). El resultado sale de la fila
"Results" de la misma página (votos válidos); si no está, la contienda se
descarta con su motivo: no se completa a mano.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

from radar.elections.contests import Contest
from radar.elections.models import CalibContest, PollObs
from radar.elections.polls import parse_page
from radar.elections.sources.wikimedia import WikiDocument


@dataclass
class CalibrationBuild:
    contests: list[CalibContest] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)
    provenance: list[dict[str, object]] = field(default_factory=list)


def calib_from_document(
    contest: Contest, doc: WikiDocument, *, window_days: int = 60
) -> tuple[CalibContest | None, list[str], dict[str, object]]:
    parsed = parse_page(doc.html, contest)
    issues = [f"{contest.key}: {w}" for w in parsed.warnings[:5]]
    # Fila de resultado de ESTA elección: la fechada el día de la elección; si ninguna
    # tiene fecha, la primera (preferentemente en votos válidos).
    dated = [r for r in parsed.results if r.result_date == contest.election_date]
    pool = dated or [r for r in parsed.results if r.result_date is None]
    if parsed.results and not pool:
        issues.append(
            f"{contest.key}: filas de resultado con otra fecha "
            f"({[str(r.result_date) for r in parsed.results]}); se descarta"
        )
    valid = [r for r in pool if r.basis == "valid_votes"]
    result = valid[0] if valid else (pool[0] if pool else None)
    summary: dict[str, object] = {
        "contest": contest.key,
        **doc.provenance(),
        "encuestas_parseadas": len(parsed.polls),
        "tablas": parsed.tables_used,
        "resultado": None,
    }
    if result is None:
        issues.append(f"{contest.key}: la página no tiene fila de resultado; se descarta")
        return None, issues, summary
    if result.basis != "valid_votes":
        issues.append(f"{contest.key}: el resultado no indica 'votos válidos'; se usa igual")
    start = contest.election_date - timedelta(days=window_days)
    polls = tuple(
        PollObs(p.pollster, p.fieldwork_end, p.two_party_a, p.sample_size, p.key())
        for p in parsed.polls
        if start <= p.fieldwork_end <= contest.election_date
    )
    summary["resultado"] = {
        "a": result.share_a,
        "b": result.share_b,
        "base": result.basis,
        "two_party_a": round(result.two_party_a, 6),
    }
    summary["encuestas_en_ventana"] = len(polls)
    if len(polls) < 5:
        issues.append(
            f"{contest.key}: solo {len(polls)} encuestas en {window_days} días; se descarta"
        )
        return None, issues, summary
    return (
        CalibContest(
            key=contest.key,
            close=contest.polls_close_utc,
            result_two_party_a=result.two_party_a,
            polls=polls,
            source=f"{doc.title}@{doc.revid}",
        ),
        issues,
        summary,
    )
