import json

from radar.ingestion.gamma import GammaEvent, GammaMarket, parse_markets
from tests.conftest import make_clients, make_settings
from tests.fakes import FakePolymarket, synthetic_market


def test_parses_real_markets_sample(real_sample):
    raws = real_sample["markets_page"]["markets"]
    out = parse_markets(raws)
    assert not out.invalid
    assert len(out.valid) == len(raws)
    for m, raw in out.valid:
        assert m.id == str(raw["id"])
        assert len(m.clob_token_ids) == len(m.outcomes) == 2
        assert all(isinstance(t, str) and t.isdigit() for t in m.clob_token_ids)
        assert all(0 <= p <= 1 for p in m.outcome_prices)
        assert m.end_date is None or m.end_date.tzinfo is not None
        assert m.event is not None and m.event.id


def test_parses_real_events_sample(real_sample):
    for raw in real_sample["events"]:
        ev = GammaEvent.model_validate(raw)
        assert ev.id and ev.tags
        assert all(t.slug for t in ev.tags)


def test_invalid_records_are_reported_not_raised():
    good = synthetic_market("1")
    no_id = {**synthetic_market("2"), "id": None}
    no_question = {**synthetic_market("3"), "question": "  "}
    bad_tokens = {**synthetic_market("4"), "clobTokenIds": "[not json"}
    out = parse_markets([good, no_id, no_question, bad_tokens, "texto"])
    assert [m.id for m, _ in out.valid] == ["1"]
    assert len(out.invalid) == 4
    assert {e for e, _ in out.invalid} == {None, "3", "4"}


def test_rules_hash_tracks_contract_fields_only():
    base = GammaMarket.model_validate(synthetic_market("1"))
    vol = GammaMarket.model_validate({**synthetic_market("1"), "volume24hr": 999999})
    rules = GammaMarket.model_validate({**synthetic_market("1"), "description": "otra regla"})
    assert base.rules_hash() == vol.rules_hash()
    assert base.rules_hash() != rules.rules_hash()


def test_keyset_pagination_follows_cursor_until_exhausted():
    fake = FakePolymarket(markets=[synthetic_market(str(i)) for i in range(250)])
    gamma, _ = make_clients(fake, make_settings())
    pages = list(gamma.iter_market_pages())
    assert [len(p.markets) for p in pages] == [100, 100, 50]
    assert pages[-1].next_cursor is None
    assert [r.url.params.get("after_cursor") for r in fake.requests] == [None, "100", "200"]
    assert all(r.url.params["closed"] == "false" for r in fake.requests)


def test_max_pages_stops_early_and_keeps_cursor():
    fake = FakePolymarket(markets=[synthetic_market(str(i)) for i in range(250)])
    gamma, _ = make_clients(fake, make_settings())
    pages = list(gamma.iter_market_pages(max_pages=2))
    assert len(pages) == 2
    assert pages[-1].next_cursor == "200"


def test_fetch_by_ids_uses_repeated_params_and_closed_any():
    closed = synthetic_market("9", closed=True)
    fake = FakePolymarket(markets=[synthetic_market("1")], by_id_extra={"9": closed})
    gamma, _ = make_clients(fake, make_settings())
    raws, received = gamma.fetch_markets_by_ids(["1", "9", "404"])
    assert sorted(r["id"] for r in raws) == ["1", "9"]
    req = fake.requests[-1]
    assert req.url.params["closed"] == "any"
    assert req.url.params.get_list("id") == ["1", "9", "404"]
    assert received.tzinfo is not None


def test_json_string_fields_are_decoded():
    m = GammaMarket.model_validate(
        {**synthetic_market("1"), "outcomes": json.dumps(["A", "B"]), "outcomePrices": "[]"}
    )
    assert m.outcomes == ["A", "B"]
    assert m.outcome_prices == []
