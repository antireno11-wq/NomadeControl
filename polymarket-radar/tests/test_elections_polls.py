from datetime import date
from pathlib import Path

from radar.elections.contests import BR_2026_R2, FLAVIO, LULA
from radar.elections.polls import parse_number, parse_page, parse_period

FIXTURE = Path(__file__).parent / "fixtures" / "wiki_br2026_rev1379945237_excerpt.html"


def test_parse_period_variants():
    assert parse_period("23–24 Oct", 2026) == (date(2026, 10, 23), date(2026, 10, 24))
    assert parse_period("30 Sep–3 Oct", 2026) == (date(2026, 9, 30), date(2026, 10, 3))
    assert parse_period("3 Oct", 2026) == (date(2026, 10, 3), date(2026, 10, 3))
    assert parse_period("28 Dec–2 Jan", 2027) == (date(2026, 12, 28), date(2027, 1, 2))
    assert parse_period("28 Oct 2022", 2026) == (date(2022, 10, 28), date(2022, 10, 28))
    assert parse_period("sin fecha", 2026) == (None, None)


def test_parse_number():
    assert parse_number("47.9") == 47.9
    assert parse_number("45,1") == 45.1
    assert parse_number("4,050") == 4050
    assert parse_number("—N/a") is None
    assert parse_number("±2.2 pp") == 2.2
    assert parse_number("51.8%") == 51.8


def test_candidate_matching_handles_party_suffix():
    assert LULA.matches("Lula PT") and LULA.matches("Luiz Inácio Lula da Silva")
    assert FLAVIO.matches("F. Bolsonaro PL") and FLAVIO.matches("Flavio Bolsonaro")
    assert not FLAVIO.matches("Jair Bolsonaro")


def test_parses_real_revision_excerpt():
    parsed = parse_page(FIXTURE.read_text(encoding="utf-8"), BR_2026_R2)
    # Solo tablas de 2.ª vuelta; la de 1.ª vuelta (índice 0 del extracto) se ignora.
    assert 0 not in parsed.tables_used
    assert parsed.results == []  # revisión del 12-oct: aún sin resultado
    assert len(parsed.aggregators) == 6
    econ = next(a for a in parsed.aggregators if a.aggregator == "The Economist")
    assert econ.last_update == date(2026, 10, 3) and (econ.share_a, econ.share_b) == (44.0, 45.0)
    ipespe = next(p for p in parsed.polls if p.pollster == "Ipespe")
    assert (ipespe.fieldwork_start, ipespe.fieldwork_end) == (date(2026, 10, 6), date(2026, 10, 8))
    assert (ipespe.share_a, ipespe.share_b, ipespe.sample_size) == (44.0, 49.0, 1500)
    assert abs(ipespe.two_party_a - 44 / 93) < 1e-12
    # Los escenarios de la misma encuesta contra otros rivales no son Lula-vs-Flávio.
    futura = [p for p in parsed.polls if p.pollster == "Futura"]
    assert [(p.share_a, p.share_b) for p in futura] == [(45.1, 48.0)]
    assert len({p.key() for p in parsed.polls}) == len(parsed.polls)


def test_results_row_is_never_a_poll():
    html = """<h2>Second round</h2><table class="wikitable">
    <tr><th>Pollster</th><th>Polling period</th><th>Lula</th><th>F. Bolsonaro</th>
    <th>Sample size</th></tr>
    <tr><th>Results</th><td>25 Oct</td><td>51.8%</td><td>48.2%</td><td>Valid votes</td></tr>
    <tr><td>Datafolha</td><td>23–24 Oct</td><td>47</td><td>48</td><td>4,050</td></tr>
    <tr><td colspan="5">Debate</td></tr></table>"""
    parsed = parse_page(html, BR_2026_R2)
    assert [p.pollster for p in parsed.polls] == ["Datafolha"]
    assert len(parsed.results) == 1 and parsed.results[0].basis == "valid_votes"


def test_result_row_variants():
    from radar.elections.polls import RESULT_ROW

    for name in (
        "Results",
        "Official results",
        "Results of the second round",
        "Resultado",
        "2022 election",
        "Election results",
    ):
        assert RESULT_ROW.search(name.lower()), name
    for pollster in ("datafolha", "opinionway-kea", "ifop-fiducial", "quaest", "atlasintel"):
        assert not RESULT_ROW.search(pollster), pollster


def test_non_candidate_columns_do_not_block_head_to_head_rows():
    from radar.elections.contests import Candidate, Contest, WikiPollSource

    c = Contest(
        "x",
        "CL",
        "president",
        2,
        date(2025, 12, 14),
        BR_2026_R2.polls_close_utc,
        Candidate("Jara", (r"\bjara\b",)),
        Candidate("Kast", (r"\bkast\b",)),
        WikiPollSource("en", "x"),
        2025,
    )
    html = """<h2>Second round</h2><table class="wikitable">
    <tr><th>Polling source</th><th>Date</th><th>Jara UpCh</th><th>Kast CpCh</th>
    <th>Would not vote</th><th>DK/NR</th></tr>
    <tr><td>Panel Ciudadano</td><td>5 Dec 2025</td><td>36%</td><td>50%</td>
    <td>14%</td><td>14%</td></tr>
    </table>"""
    parsed = parse_page(html, c)
    assert [(p.pollster, p.share_a, p.share_b) for p in parsed.polls] == [
        ("Panel Ciudadano", 36, 50)
    ]
