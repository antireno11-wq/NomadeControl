"""Pruebas contra las APIs públicas REALES (opt-in: RADAR_LIVE_TESTS=1).

Verifican que el contrato de las APIs sigue siendo el que el código espera.
"""

import os

import pytest

from radar.config import Settings
from radar.ingestion.gamma import parse_markets
from radar.ingestion.pipeline import build_clients

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.environ.get("RADAR_LIVE_TESTS") != "1", reason="RADAR_LIVE_TESTS!=1"),
]


@pytest.fixture(scope="module")
def clients():
    gamma, clob, close = build_clients(Settings(_env_file=None))
    yield gamma, clob
    close()


def test_gamma_first_page_is_valid(clients):
    gamma, _ = clients
    page = next(gamma.iter_market_pages(max_pages=1))
    assert page.markets and page.next_cursor
    parsed = parse_markets(page.markets)
    assert not parsed.invalid
    assert all(m.clob_token_ids for m, _ in parsed.valid if m.enable_order_book)


def test_clob_books_for_real_tokens(clients):
    gamma, clob = clients
    page = next(gamma.iter_market_pages(max_pages=1))
    parsed = parse_markets(page.markets)
    tokens = [t for m, _ in parsed.valid[:5] if m.accepting_orders for t in m.clob_token_ids]
    res = clob.fetch_books(tokens)
    assert not res.failed
    assert len(res.books) + len(res.missing) == len(tokens)
    assert len(res.books) > 0
