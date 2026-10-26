"""Lectura de contratos cripto sobre reglas REALES de Polymarket (fixture con procedencia)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from radar.predict.base import MarketView
from radar.predict.crypto.terms import (
    CryptoTerms,
    Unsupported,
    parse_amount,
    parse_crypto_terms,
)

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "crypto_rules_real.json").read_text(encoding="utf-8")
)


def view(key: str) -> MarketView:
    m = FIX["markets"][key]
    return MarketView(
        market_id=m["id"],
        question=m["question"],
        description=m["description"],
        outcomes=tuple(m["outcomes"]),
        token_ids=("a", "b"),
        category="crypto",
        start_date=datetime.fromisoformat(m["start_date"]),
        end_date=datetime.fromisoformat(m["end_date"]),
    )


def parsed(key: str) -> CryptoTerms:
    t = parse_crypto_terms(view(key))
    assert isinstance(t, CryptoTerms), t
    return t


def utc(*a: int) -> datetime:
    return datetime(*a, tzinfo=UTC)


def test_amounts() -> None:
    assert parse_amount("72,000", None) == 72000
    assert parse_amount("0.80", None) == 0.8
    assert parse_amount("100", "k") == 100_000
    assert parse_amount("1.5", "M") == 1_500_000


def test_daily_above_uses_candle_closing_at_noon_et() -> None:
    t = parsed("daily_above")
    assert (t.kind, t.variant, t.symbol) == ("terminal", "daily_above", "BTCUSDT")
    # 12:00 ET del 26-oct (EDT, UTC-4) = 16:00 UTC; la vela que cierra a esa hora abre 15:59
    assert t.obs_open == utc(2026, 10, 26, 15, 59)
    assert t.resolution_time == utc(2026, 10, 26, 16, 0)
    assert t.lower == 72000 and not t.lower_inclusive and t.upper is None


def test_range_brackets_and_ties_go_to_upper_bracket() -> None:
    mid = parsed("daily_range")
    assert (mid.lower, mid.upper, mid.lower_inclusive, mid.upper_inclusive) == (
        72000,
        74000,
        True,
        False,
    )
    low = parsed("daily_below")
    assert (low.lower, low.upper) == (None, 72000)
    top = parsed("daily_top")
    assert (top.lower, top.upper, top.lower_inclusive) == (90000, None, True)


def test_hourly_above_uses_1h_candle_ending_at_title_time() -> None:
    t = parsed("hourly_above")
    assert t.candle == "1h"
    assert t.obs_open == utc(2026, 10, 25, 22, 0)  # 7PM ET = 23:00 UTC; abre 22:00
    assert t.resolution_time == utc(2026, 10, 25, 23, 0)


def test_hourly_updown_compares_close_with_open_of_same_candle() -> None:
    t = parsed("hourly_updown")
    assert (t.kind, t.ref_field, t.tie, t.yes_outcome) == ("updown", "open", "up", "Up")
    assert t.ref_open == t.obs_open == utc(2026, 10, 25, 22, 0)  # 6PM ET


def test_daily_updown_noon_to_noon_with_half_on_tie() -> None:
    t = parsed("daily_updown")
    assert t.ref_open == utc(2026, 10, 25, 16, 0) and t.obs_open == utc(2026, 10, 26, 16, 0)
    assert (t.ref_field, t.tie) == ("close", "half")


def test_touch_windows() -> None:
    month = parsed("touch_month")
    assert (month.direction, month.barrier) == ("high", 150000)
    assert month.window_start == utc(2026, 10, 1, 4) and month.window_end == utc(2026, 11, 1, 4)
    week = parsed("touch_range")
    assert week.direction == "low" and week.barrier == 78000
    assert week.window_start == utc(2026, 10, 19, 4) and week.window_end == utc(2026, 10, 26, 4)
    day = parsed("touch_day")
    assert day.window_start == utc(2026, 10, 25, 4) and day.window_end == utc(2026, 10, 26, 4)
    ex = parsed("touch_explicit")
    assert ex.window_start == utc(2025, 11, 24, 19, 0)  # 14:00 ET (EST)
    assert ex.window_end == utc(2027, 1, 1, 5, 0)


def test_combined_high_or_low_rule_takes_direction_from_verb() -> None:
    t = parsed("touch_either")
    assert (t.direction, t.symbol, t.variant) == ("low", "ENAUSDT", "touch_until")


def test_implicit_start_is_recorded_as_note() -> None:
    t = parsed("touch_until_implicit")
    assert t.window_start == view("touch_until_implicit").start_date
    assert any("creación" in n for n in t.notes)


@pytest.mark.parametrize(
    ("key", "fragment"),
    [
        ("chainlink_5m", "Chainlink"),
        ("futures_hype", "futuros"),
        ("bybit", "distinta de Binance"),
        ("not_modeled", "no modelado"),
    ],
)
def test_unsupported_with_reason(key: str, fragment: str) -> None:
    t = parse_crypto_terms(view(key))
    assert isinstance(t, Unsupported)
    assert fragment in t.reason


def test_asset_named_chainlink_is_not_a_chainlink_resolution() -> None:
    t = parse_crypto_terms(view("asset_chainlink"))
    assert isinstance(t, CryptoTerms) and t.symbol == "LINKUSDT"


def test_question_and_rules_must_agree_on_asset() -> None:
    m = view("daily_above")
    bad = MarketView(**{**m.__dict__, "description": m.description.replace("BTC/USDT", "ETH/USDT")})
    t = parse_crypto_terms(bad)
    assert isinstance(t, Unsupported) and "distinto del par" in t.reason
