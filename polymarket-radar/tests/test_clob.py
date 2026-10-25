from radar.ingestion.clob import ClobBook
from radar.market.orderbook import compute_metrics, normalize_book
from tests.conftest import make_clients, make_settings
from tests.fakes import FakePolymarket, liquid_book


def test_parses_real_books_and_normalizes_level_order(real_sample):
    for raw in real_sample["books"]:
        book = ClobBook.model_validate(raw)
        assert book.source_ts is not None and book.source_ts.tzinfo is not None
        bids, asks = normalize_book(book.bids, book.asks)
        # La API entrega bids ascendentes y asks descendentes: tras normalizar,
        # el mejor nivel queda primero.
        assert bids == sorted(bids, key=lambda lv: -lv.price)
        assert asks == sorted(asks, key=lambda lv: lv.price)
        if bids:
            assert bids[0].price == max(float(b["price"]) for b in raw["bids"])
        if asks:
            assert asks[0].price == min(float(a["price"]) for a in raw["asks"])
        m = compute_metrics(bids, asks, band=0.02)
        if m.two_sided:
            assert m.spread == round(m.best_ask - m.best_bid, 6)
            assert not m.crossed


def test_batches_requests():
    toks = [f"t{i}" for i in range(5)]
    fake = FakePolymarket(books={t: liquid_book(t) for t in toks})
    _, clob = make_clients(fake, make_settings(clob_books_batch_size=2))
    res = clob.fetch_books(toks)
    assert res.requests == 3
    assert sorted(res.books) == toks
    assert not res.missing and not res.failed


def test_missing_and_invalid_books_are_reported():
    bad = liquid_book("t2")
    bad["bids"] = [{"price": "1.5", "size": "10"}]
    fake = FakePolymarket(books={"t1": liquid_book("t1"), "t2": bad})
    _, clob = make_clients(fake, make_settings())
    res = clob.fetch_books(["t1", "t2", "t3"])
    assert list(res.books) == ["t1"]
    assert res.missing == ["t3"]
    assert [t for t, _ in res.invalid] == ["t2"]


def test_client_error_bisects_to_isolate_bad_token():
    toks = ["a", "b", "c", "d"]
    fake = FakePolymarket(books={t: liquid_book(t) for t in toks}, bad_tokens={"c"})
    _, clob = make_clients(fake, make_settings())
    res = clob.fetch_books(toks)
    assert sorted(res.books) == ["a", "b", "d"]
    assert [batch for batch, _ in res.failed] == [["c"]]
    assert res.failed[0][1].status == 400


def test_server_error_fails_batch_without_bisecting():
    fake = FakePolymarket(books={"a": liquid_book("a")}, books_status=503)
    _, clob = make_clients(fake, make_settings(http_max_retries=1))
    res = clob.fetch_books(["a", "b"])
    assert not res.books
    assert [batch for batch, _ in res.failed] == [["a", "b"]]
    assert len([r for r in fake.requests if r.url.path == "/books"]) == 2  # 1 + 1 reintento
