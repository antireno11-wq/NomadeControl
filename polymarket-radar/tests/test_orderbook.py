import pytest

from radar.market.orderbook import (
    Level,
    compute_metrics,
    normalize_book,
    simulate_buy,
    simulate_sell,
    truncate_levels,
)


def book(bids, asks):
    return normalize_book(
        [{"price": p, "size": s} for p, s in bids], [{"price": p, "size": s} for p, s in asks]
    )


def test_metrics_on_unsorted_input():
    bids, asks = book([(0.40, 100), (0.48, 50), (0.45, 10)], [(0.60, 5), (0.52, 200), (0.53, 0)])
    m = compute_metrics(bids, asks, band=0.03)
    assert m.best_bid == 0.48 and m.best_bid_size == 50
    assert m.best_ask == 0.52 and m.best_ask_size == 200
    assert m.spread == pytest.approx(0.04)
    assert m.mid == pytest.approx(0.50)
    assert m.ask_levels == 2  # el nivel de tamaño 0 se descarta
    assert m.bid_depth_usd == pytest.approx(0.40 * 100 + 0.48 * 50 + 0.45 * 10)
    # banda 0.03: bids >= 0.45, asks <= 0.55
    assert m.bid_depth_band_usd == pytest.approx(0.48 * 50 + 0.45 * 10)
    assert m.ask_depth_band_usd == pytest.approx(0.52 * 200)
    assert m.two_sided and not m.crossed


def test_one_sided_and_empty_books():
    bids, asks = book([(0.1, 10)], [])
    m = compute_metrics(bids, asks, band=0.02)
    assert not m.two_sided and m.spread is None and m.mid is None and m.best_ask is None
    e = compute_metrics([], [], band=0.02)
    assert e.bid_depth_usd == 0 and not e.two_sided


def test_crossed_book_is_flagged():
    bids, asks = book([(0.55, 10)], [(0.50, 10)])
    assert compute_metrics(bids, asks, band=0.02).crossed


def test_buy_by_notional_walks_the_book():
    _, asks = book([], [(0.52, 100), (0.50, 100)])
    f = simulate_buy(asks, notional_usd=60)
    # 100 acciones a 0.50 (US$50) + US$10 a 0.52 (19.2308 acciones)
    assert f.filled_shares == pytest.approx(100 + 10 / 0.52, abs=1e-6)
    assert f.notional_usd == pytest.approx(60)
    assert f.avg_price == pytest.approx(60 / (100 + 10 / 0.52), abs=1e-6)
    assert f.best_price == 0.50 and f.worst_price == 0.52
    assert f.slippage == pytest.approx(f.avg_price - 0.50, abs=1e-6)
    assert f.fully_filled and f.levels_consumed == 2


def test_buy_partial_fill_when_depth_is_insufficient():
    _, asks = book([], [(0.50, 10)])
    f = simulate_buy(asks, notional_usd=100)
    assert f.filled_shares == 10 and f.notional_usd == 5
    assert not f.fully_filled


def test_buy_by_shares_and_sell():
    bids, asks = book([(0.45, 30), (0.44, 100)], [(0.50, 30), (0.51, 100)])
    b = simulate_buy(asks, shares=50)
    assert b.notional_usd == pytest.approx(30 * 0.50 + 20 * 0.51)
    assert b.fully_filled
    s = simulate_sell(bids, shares=50)
    assert s.notional_usd == pytest.approx(30 * 0.45 + 20 * 0.44)
    assert s.slippage == pytest.approx(0.45 - s.avg_price)
    assert simulate_sell(bids, shares=1000).fully_filled is False


def test_buy_requires_exactly_one_target():
    with pytest.raises(ValueError):
        simulate_buy([Level(0.5, 1)])
    with pytest.raises(ValueError):
        simulate_buy([Level(0.5, 1)], notional_usd=1, shares=1)


def test_empty_book_buy_returns_no_fill():
    f = simulate_buy([], notional_usd=10)
    assert f.filled_shares == 0 and f.avg_price is None and not f.fully_filled


def test_truncate_levels():
    levels = [Level(0.5 - i / 100, 1) for i in range(10)]
    assert len(truncate_levels(levels, 3)) == 3
    assert truncate_levels(levels, 3)[0] == {"price": 0.5, "size": 1}
