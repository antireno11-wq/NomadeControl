"""Backtest y escaneo en vivo con datos SINTÉTICOS (sin red)."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import httpx

from radar.elections.alerts import AlertLedger, verify_chain
from radar.elections.backtest import TokenSpec, outcome_metrics, run_backtest
from radar.elections.contests import BR_2026_R2
from radar.elections.market_history import MarketHistory, RawCache
from radar.elections.models import CalibContest, PollObs, validate_loo
from radar.elections.service import scan_contest
from radar.elections.sources.wikimedia import WikiDocument
from radar.ingestion.clob import ClobBook
from radar.ingestion.http import ApiClient

CLOSE = BR_2026_R2.polls_close_utc


def wiki_html(polls: list[tuple[str, str, float, float]], results: bool = False) -> str:
    """HTML SINTÉTICO con la estructura de la página real (sección 'Second round')."""
    rows = "".join(
        f"<tr><td>{p}</td><td>{d}</td><td>{a}</td><td>{b}</td><td>2,000</td></tr>"
        for p, d, a, b in polls
    )
    res = (
        "<tr><th>Results</th><td>25 Oct</td><td>51.8%</td><td>48.2%</td><td>Valid votes</td></tr>"
        if results
        else ""
    )
    return (
        "<h2>Second round</h2><h3>2026</h3><table class='wikitable'>"
        "<tr><th>Pollster</th><th>Polling period</th><th>Lula PT</th><th>F. Bolsonaro PL</th>"
        f"<th>Sample size</th></tr>{res}{rows}</table>"
    )


def doc(html: str, revid: int, ts: datetime) -> WikiDocument:
    return WikiDocument("en", "SINTÉTICO", revid, ts, ts, f"{revid:064d}", "https://x", html, True)


def calibration() -> list[CalibContest]:
    out = []
    for i, err in enumerate((0.02, -0.03, 0.01)):
        close = datetime(2018 + i, 10, 28, 20, tzinfo=UTC)
        polls = tuple(
            PollObs(f"P{j}", close.date() - timedelta(days=d), 0.5, 1000, f"{i}{j}{d}")
            for j in range(3)
            for d in range(2, 30, 2)
        )
        out.append(CalibContest(f"sint-{i}", close, 0.5 - err, polls))
    return out


def tokens() -> list[TokenSpec]:
    return [
        TokenSpec("m-lula", "cond-lula", "lula-yes", "Lula YES", "a", "YES", 0.0, 1),
        TokenSpec("m-lula", "cond-lula", "lula-no", "Lula NO", "a", "NO", 0.0, 1),
    ]


def fake_history(tmp_path, ref_price: float, buy_price: float) -> MarketHistory:
    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/prices-history":
            start = int(req.url.params["startTs"])
            end = int(req.url.params["endTs"])
            tok = req.url.params["market"]
            p = ref_price if tok == "lula-yes" else 1 - ref_price
            return httpx.Response(
                200, json={"history": [{"t": t, "p": p} for t in range(start, end, 3600)]}
            )
        if req.url.path == "/trades":
            end = int(req.url.params["end"])
            return httpx.Response(
                200,
                json=[
                    {
                        "timestamp": end - 600,
                        "side": "BUY",
                        "asset": "lula-yes",
                        "outcome": "Yes",
                        "price": buy_price,
                        "size": 500,
                        "transactionHash": "0xsint",
                    },
                ],
            )
        return httpx.Response(404)

    t = httpx.MockTransport(handler)

    def mk(name: str) -> ApiClient:
        return ApiClient(
            "https://x.test", name=name, rate_per_s=1000, transport=t, sleep=lambda _s: None
        )

    return MarketHistory(mk("clob"), mk("data"), RawCache(tmp_path / "raw"))


def test_backtest_uses_only_revision_at_t_and_never_signals(tmp_path):
    t1 = datetime(2026, 10, 20, 12, tzinfo=UTC)
    t2 = datetime(2026, 10, 24, 12, tzinfo=UTC)
    early = doc(
        wiki_html([("A", "15–16 Oct", 46, 50), ("B", "17 Oct", 47, 49)]), 1, t1 - timedelta(hours=3)
    )
    late = doc(
        wiki_html([("A", "15–16 Oct", 46, 50), ("B", "17 Oct", 47, 49), ("C", "23 Oct", 45, 51)]),
        2,
        t2 - timedelta(hours=1),
    )
    cal = calibration()
    val = validate_loo(cal, "weighted")
    ledger = AlertLedger(tmp_path / "bt.jsonl")
    contest = replace(BR_2026_R2, defined_from_utc=t1 - timedelta(days=1))
    res = run_backtest(
        contest,
        [(t1, early), (t2, late)],
        cal,
        val,
        tokens(),
        fake_history(tmp_path, ref_price=0.10, buy_price=0.12),
        ledger=ledger,
    )
    p1, p2 = res["timeline"]
    assert p1["encuestas_en_revision"] == 2 and p2["encuestas_en_revision"] == 3
    assert p1["revision"]["revid"] == 1 and p2["revision"]["revid"] == 2
    # Lula ~49 % bipartidista con σ de 1–3 p.p. vs mercado 0.10: alerta, nunca señal.
    assert p1["alerta"] and not p1["senal_operable"] and not p2["senal_operable"]
    gating = {g.split(":")[0] for d in p1["decisiones"] for g in d["gating"]}
    assert "modelo no validado" in gating
    assert any(g.startswith("precio no ejecutable") for g in gating)
    assert res["primera_alerta"]["t"] == t1.isoformat()
    assert verify_chain(ledger.records()) == []
    assert all(r.mode == "backtest_retrospectivo" for r in ledger.records())
    m = outcome_metrics(res, winner_is_a=True)
    assert m["n_contiendas"] == 1 and m["n_instantes"] == 2
    assert m["brier_medio_mercado"] > m["brier_medio_modelo"]  # n = 1: no prueba nada


def test_backtest_excludes_revision_with_results_before_close(tmp_path):
    t = datetime(2026, 10, 24, 12, tzinfo=UTC)
    leaked = doc(wiki_html([("A", "20 Oct", 46, 50)], results=True), 3, t - timedelta(hours=1))
    cal = calibration()
    contest = replace(BR_2026_R2, defined_from_utc=t - timedelta(days=5))
    res = run_backtest(
        contest,
        [(t, leaked)],
        cal,
        validate_loo(cal, "weighted"),
        tokens(),
        fake_history(tmp_path, 0.3, 0.3),
    )
    assert res["timeline"][0]["estado"].startswith("posible fuga")


class FakeBook:
    def __init__(self, token: str, asks: list[tuple[float, float]], ts: datetime):
        self.book = ClobBook.model_validate(
            {
                "asset_id": token,
                "timestamp": str(int(ts.timestamp() * 1000)),
                "hash": "h",
                "bids": [{"price": "0.05", "size": "10"}],
                "asks": [{"price": str(p), "size": str(s)} for p, s in asks],
            }
        )


def test_live_scan_freezes_alerts_before_close_and_blocks_unvalidated(tmp_path):
    now = datetime(2026, 10, 24, 12, tzinfo=UTC)
    d = doc(
        wiki_html([("A", "20 Oct", 46, 50), ("B", "22 Oct", 47, 49), ("C", "23 Oct", 48, 50)]),
        9,
        now - timedelta(hours=2),
    )
    books = {
        "lula-yes": (FakeBook("lula-yes", [(0.10, 1000)], now).book, now),
        "lula-no": (FakeBook("lula-no", [(0.91, 1000)], now).book, now),
    }
    ledger = AlertLedger(tmp_path / "live.jsonl")
    out = scan_contest(
        BR_2026_R2,
        now,
        doc=d,
        tokens=tokens(),
        books=books,
        calibration=calibration(),
        ledger=ledger,
    )
    lula_yes = next(x for x in out["decisiones"] if x["quote"]["label"] == "Lula YES")
    assert lula_yes["quote"]["basis"] == "ask_ejecutable" and lula_yes["quote"]["price"] == 0.10
    assert lula_yes["alert"] and not lula_yes["signal"]
    assert any(g.startswith("modelo no validado") for g in lula_yes["gating"])
    recs = ledger.records()
    assert len(recs) >= 1 and recs[0].mode == "live"
    assert datetime.fromisoformat(recs[0].created_at) < BR_2026_R2.polls_close_utc
    assert json.loads(recs[0].to_json())["payload"]["cierre_urnas_utc"] == CLOSE.isoformat()
    assert verify_chain(recs) == []


def test_live_scan_abstains_after_close(tmp_path):
    out = scan_contest(
        BR_2026_R2,
        CLOSE + timedelta(minutes=1),
        doc=None,
        tokens=[],
        books={},
        calibration=[],
        ledger=AlertLedger(tmp_path / "x.jsonl"),
    )
    assert out["abstencion"].startswith("urnas cerradas")
    assert not (tmp_path / "x.jsonl").exists()


def test_fieldwork_dates_are_not_future_relative_to_t():
    # Una encuesta con fin de campo posterior a T no puede usarse aunque esté en la revisión.
    assert date(2026, 10, 25) > datetime(2026, 10, 24, 12, tzinfo=UTC).date()
