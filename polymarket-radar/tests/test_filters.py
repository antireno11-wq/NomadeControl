from datetime import UTC, datetime

from radar.ingestion.gamma import GammaMarket
from radar.market.categories import categorize
from radar.market.filters import (
    LiquidityConfig,
    eligibility_reasons,
    liquidity_reasons,
    reason_family,
)
from radar.market.orderbook import compute_metrics, normalize_book
from tests.fakes import synthetic_market

NOW = datetime(2026, 10, 25, tzinfo=UTC)
CFG = LiquidityConfig(max_spread=0.05, depth_band=0.02, min_depth_usd=100)


def gm(**kw):
    return GammaMarket.model_validate(synthetic_market("1", **kw))


def metrics(bids, asks):
    b, a = normalize_book(
        [{"price": p, "size": s} for p, s in bids], [{"price": p, "size": s} for p, s in asks]
    )
    return compute_metrics(b, a, band=CFG.depth_band)


def test_eligible_market_has_no_reasons():
    assert eligibility_reasons(gm(), NOW) == []


def test_eligibility_reasons():
    assert "not_accepting_orders" in eligibility_reasons(gm(accepting_orders=False), NOW)
    assert "order_book_disabled" in eligibility_reasons(gm(enable_order_book=False), NOW)
    assert "not_active" in eligibility_reasons(gm(active=False), NOW)
    assert "closed" in eligibility_reasons(gm(closed=True), NOW)
    assert "end_date_passed" in eligibility_reasons(gm(end_date="2026-10-01T00:00:00Z"), NOW)
    assert "no_clob_tokens" in eligibility_reasons(gm(tokens=[]), NOW)
    assert "outcome_token_mismatch" in eligibility_reasons(gm(tokens=["a"]), NOW)
    assert "duplicate_token_ids" in eligibility_reasons(gm(tokens=["a", "a"]), NOW)


def test_liquid_market_passes():
    good = metrics([(0.49, 1000)], [(0.51, 1000)])
    assert liquidity_reasons([good, good], CFG) == []


def test_liquidity_rejections():
    good = metrics([(0.49, 1000)], [(0.51, 1000)])
    wide = metrics([(0.40, 1000)], [(0.60, 1000)])
    thin = metrics([(0.49, 10)], [(0.51, 1000)])
    one_sided = metrics([(0.49, 1000)], [])
    crossed = metrics([(0.55, 1000)], [(0.50, 1000)])
    assert liquidity_reasons([wide, good], CFG) == ["outcome0:spread_too_wide"]
    assert liquidity_reasons([good, thin], CFG) == ["outcome1:insufficient_bid_depth"]
    assert liquidity_reasons([one_sided, good], CFG) == ["outcome0:one_sided"]
    assert liquidity_reasons([good, crossed], CFG) == ["outcome1:crossed"]
    assert liquidity_reasons([good, None], CFG) == ["outcome1:book_missing"]
    assert liquidity_reasons([], CFG) == ["no_books"]
    assert reason_family("outcome1:crossed") == "crossed"


def test_spread_at_threshold_passes():
    edge = metrics([(0.45, 1000)], [(0.50, 1000)])
    assert edge.spread == 0.05
    assert liquidity_reasons([edge], CFG) == []


def test_categorize():
    assert categorize(["crypto", "bitcoin"]) == "crypto"
    assert categorize(["NBA"]) == "sports"
    assert categorize(["world-affairs", "geopolitics"]) == "politics"
    assert categorize(["something-new"]) == "other"
    assert categorize([]) == "unknown"
    assert categorize([None, ""]) == "unknown"
