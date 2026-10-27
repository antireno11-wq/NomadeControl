"""Referencia externa de Kalshi (ref-kalshi-v1): emparejamiento y probabilidad.

Las cotizaciones y mercados son SINTÉTICOS, con el formato real de las dos APIs (tickers de
Kalshi como ``KXNBAGAME-26OCT27DETNYK-DET`` y slugs de Polymarket como
``nba-det-nyk-2026-10-27``)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from radar.predict import external as X
from radar.predict.base import CALIB_NOT_EVALUATED, MarketView

T = datetime(2026, 10, 27, 20, tzinfo=UTC)  # momento de la predicción
START = datetime(2026, 10, 28, 0, tzinfo=UTC)  # 20:00 ET del 27-oct


def q(ticker: str, title: str, bid: float | None, ask: float | None, **kw: object) -> X.Quote:
    return X.Quote(
        ticker=ticker,
        event=ticker.rsplit("-", 1)[0],
        suffix=ticker.rsplit("-", 1)[1],
        title=title,
        bid=bid,
        ask=ask,
        close_time=kw.get("close_time"),  # type: ignore[arg-type]
        received_at=kw.get("received_at", T - timedelta(minutes=1)),  # type: ignore[arg-type]
        url="https://kalshi.test/markets",
    )


QUOTES = {
    x.ticker: x
    for x in [
        q("KXNBAGAME-26OCT27DETNYK-DET", "Detroit", 0.40, 0.42),
        q("KXNBAGAME-26OCT27DETNYK-NYK", "New York", 0.58, 0.60),
        q("KXNHLGAME-26OCT27LACHI-LA", "Los Angeles", 0.50, 0.52),
        q("KXNHLGAME-26OCT27LACHI-CHI", "Chicago", 0.48, 0.50),
        q("KXSERIEAGAME-26OCT27ROMCAG-ROM", "Roma", 0.55, 0.57),
        q("KXSERIEAGAME-26OCT27ROMCAG-CAG", "Cagliari", 0.18, 0.20),
        q("KXSERIEAGAME-26OCT27ROMCAG-TIE", "Tie", 0.24, 0.26),
        q("KXFEDDECISION-26OCT-H0", "Fed maintains rate", 0.90, 0.92,
          close_time=datetime(2026, 10, 28, 18, tzinfo=UTC)),
        q("KXFEDDECISION-26OCT-C25", "Cut 25bps", 0.07, 0.09,
          close_time=datetime(2026, 10, 28, 18, tzinfo=UTC)),
    ]
}  # fmt: skip
IDX = X.QuoteIndex.build(QUOTES)


def mv(**kw: object) -> MarketView:
    base: dict[str, object] = {
        "market_id": "m1", "question": "", "description": "", "outcomes": ("Yes", "No"),
        "token_ids": ("t0", "t1"), "category": "sports",
    }  # fmt: skip
    base.update(kw)
    return MarketView(**base)  # type: ignore[arg-type]


def test_event_ticker_parsing() -> None:
    assert X.parse_event_ticker("KXNBAGAME-26OCT27DETNYK") == (date(2026, 10, 27), "DETNYK")
    assert X.parse_event_ticker("KXMLBGAME-26OCT272000MILTB") == (date(2026, 10, 27), "MILTB")
    assert X.parse_event_ticker("KXFEDDECISION-26OCT") is None


def test_us_game_matches_by_et_date_and_codes_with_aliases() -> None:
    game = mv(slug="nba-det-nyk-2026-10-28", outcomes=("Pistons", "Knicks"))
    m = X.match_market(game, START, "moneyline", IDX)  # slug con fecha UTC, Kalshi con ET
    assert isinstance(m, X.Match)
    assert (m.variant, m.outcome, m.yes_ticker) == ("nba_partido", "Pistons",
                                                    "KXNBAGAME-26OCT27DETNYK-DET")  # fmt: skip
    assert m.cluster == "nba|2026-10-27"
    hockey = mv(slug="nhl-lak-chi-2026-10-28", outcomes=("Kings", "Blackhawks"))
    m2 = X.match_market(hockey, START, "moneyline", IDX)
    assert isinstance(m2, X.Match) and m2.yes_ticker.endswith("-LA")


def test_soccer_matches_by_team_names_and_draw() -> None:
    kw = {"event_title": "AS Roma vs. Cagliari Calcio", "outcomes": ("Yes", "No")}
    win = mv(slug="sea-rom-cag-2026-10-27-cag", group_item_title="Cagliari Calcio", **kw)
    m = X.match_market(win, START, "moneyline", IDX)
    assert isinstance(m, X.Match) and m.yes_ticker.endswith("-CAG")
    draw = mv(slug="sea-rom-cag-2026-10-27-draw", group_item_title="Draw (AS Roma vs. ...)", **kw)
    m2 = X.match_market(draw, START, "moneyline", IDX)
    assert isinstance(m2, X.Match) and m2.yes_ticker.endswith("-TIE")
    other = mv(slug="sea-laz-nap-2026-10-27-laz", group_item_title="SS Lazio",
               event_title="SS Lazio vs. SSC Napoli")  # fmt: skip
    assert "no listado" in str(X.match_market(other, START, "moneyline", IDX))


def test_fed_decision_and_unsupported_markets() -> None:
    hold = mv(question="Will there be no change in Fed interest rates after the October 2026 "
                       "meeting?", category="politics")  # fmt: skip
    m = X.match_market(hold, None, None, IDX)
    assert isinstance(m, X.Match) and m.yes_ticker == "KXFEDDECISION-26OCT-H0"
    plus = mv(question="Will the Fed decrease interest rates by 25+ bps after the October 2026 "
                       "meeting?")  # fmt: skip
    assert not isinstance(X.match_market(plus, None, None, IDX), X.Match)
    spread = mv(slug="nba-det-nyk-2026-10-28", outcomes=("Pistons", "Knicks"))
    assert "spreads" in str(X.match_market(spread, START, "spreads", IDX))


def test_probability_removes_margin_and_abstains_with_reason() -> None:
    game = mv(slug="nba-det-nyk-2026-10-28", outcomes=("Pistons", "Knicks"))
    m = X.match_market(game, START, "moneyline", IDX)
    assert isinstance(m, X.Match)
    p = X.predict(game, m, QUOTES, T)
    assert p.probability == pytest.approx(0.41 / 1.0)
    assert p.interval == (pytest.approx(0.40), pytest.approx(0.42))
    assert p.calibration_status == CALIB_NOT_EVALUATED
    assert p.details["tau_min"] == pytest.approx(240)
    assert p.details["terms"] == {"variant": "nba_partido", "asset": "nba"}
    late = X.predict(game, m, QUOTES, START + timedelta(minutes=1))
    assert late.probability is None and "ya empezó" in (late.abstain_reason or "")
    wide = dict(QUOTES)
    wide["KXNBAGAME-26OCT27DETNYK-DET"] = q("KXNBAGAME-26OCT27DETNYK-DET", "Detroit", 0.2, 0.5)
    assert "spread" in (X.predict(game, m, wide, T).abstain_reason or "")
    stale = X.predict(game, m, QUOTES, T + timedelta(minutes=30))
    assert "10 min" in (stale.abstain_reason or "")
