"""Enrutamiento de mercados a modelos y abstenciones por familia."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from radar.predict.base import MarketView
from radar.predict.registry import ABSTAIN_REASONS, default_registry

FIX = json.loads(
    (Path(__file__).parent / "fixtures" / "crypto_rules_real.json").read_text(encoding="utf-8")
)
NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)


def mv(question: str, category: str, **kw: object) -> MarketView:
    base = {
        "market_id": "x",
        "question": question,
        "description": "",
        "outcomes": ("Yes", "No"),
        "token_ids": ("a", "b"),
        "category": category,
    }
    return MarketView(**(base | kw))  # type: ignore[arg-type]


def test_crypto_markets_get_four_models() -> None:
    reg = default_registry()
    m = FIX["markets"]["daily_above"]
    market = mv(m["question"], "crypto", description=m["description"])
    names = [p.name for p in reg.route(market)]
    assert names == ["cripto-rv", "cripto-ewma", "cripto-dvol", "cripto-bootstrap"]


def test_families_without_data_abstain_with_specific_reason() -> None:
    reg = default_registry()
    cases = {
        "sports": "deportes",
        "weather": "clima",
        "economy": "macro",
        "tech": "corporativo",
        "culture": "otros",
    }
    for category, family in cases.items():
        market = mv("¿Algo ocurrirá?", category)
        assert reg.family_of(market) == family
        out = reg.predict_market(market, {}, NOW)
        assert len(out) == 1 and out[0].probability is None
        assert out[0].abstain_reason == ABSTAIN_REASONS[family]
        assert out[0].calibration_status == "abstencion"


def test_unconfigured_election_abstains_with_discovery_reason() -> None:
    reg = default_registry()
    market = mv("Will Jane Doe win the 2027 Freedonia presidential election?", "elections")
    out = reg.predict_market(market, {}, NOW)
    assert out[0].model == "elecciones-2t" and out[0].probability is None
    assert "encuestas" in (out[0].abstain_reason or "")
