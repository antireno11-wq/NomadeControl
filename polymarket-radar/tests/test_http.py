import httpx
import pytest

from radar.ingestion.http import ApiClient, ApiError, RateLimiter


def client(handler, *, retries=3, sleeps=None):
    rec = sleeps if sleeps is not None else []
    return ApiClient(
        "https://api.test",
        name="test",
        rate_per_s=1000,
        max_retries=retries,
        backoff_base_s=1.0,
        backoff_max_s=8.0,
        user_agent="radar-test/1",
        transport=httpx.MockTransport(handler),
        sleep=rec.append,
    )


def test_success_returns_data_and_receipt_timestamp():
    c = client(lambda req: httpx.Response(200, json={"ok": True}))
    resp = c.request_json("GET", "/x")
    assert resp.data == {"ok": True}
    assert resp.attempts == 1
    assert resp.received_at.tzinfo is not None


def test_sends_explicit_user_agent():
    seen = {}

    def handler(req):
        seen["ua"] = req.headers["user-agent"]
        return httpx.Response(200, json=[])

    client(handler).request_json("GET", "/x")
    assert seen["ua"] == "radar-test/1"


def test_retries_429_honoring_retry_after():
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(req):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"retry-after": "2"})
        return httpx.Response(200, json=[1])

    resp = client(handler, sleeps=sleeps).request_json("GET", "/x")
    assert resp.attempts == 3
    assert [s for s in sleeps if s > 0] == [2.0, 2.0]


def test_5xx_exhausts_retries_with_backoff():
    sleeps: list[float] = []
    c = client(lambda req: httpx.Response(503), retries=3, sleeps=sleeps)
    with pytest.raises(ApiError) as err:
        c.request_json("GET", "/x")
    assert err.value.status == 503
    assert err.value.attempts == 4
    backoffs = [s for s in sleeps if s > 0]
    assert len(backoffs) == 3
    # exponencial con jitter en [0.5, 1.0] × base·2^n, tope 8
    for n, s in enumerate(backoffs):
        assert 0.5 * min(8, 2**n) <= s <= min(8, 2**n)


def test_403_is_not_retried_and_explains_cloudflare_block():
    c = client(lambda req: httpx.Response(403, text="error code: 1010"))
    with pytest.raises(ApiError) as err:
        c.request_json("GET", "/x")
    assert err.value.attempts == 1
    assert "Cloudflare" in str(err.value)


def test_transport_errors_are_retried_then_reported():
    def handler(req):
        raise httpx.ConnectError("sin red", request=req)

    with pytest.raises(ApiError) as err:
        client(handler, retries=2).request_json("GET", "/x")
    assert err.value.error_type.startswith("transport:")
    assert err.value.attempts == 3


def test_invalid_json_is_an_error():
    c = client(lambda req: httpx.Response(200, text="<html>"))
    with pytest.raises(ApiError) as err:
        c.request_json("GET", "/x")
    assert err.value.error_type == "invalid_json"


def test_rate_limiter_spaces_requests():
    now = {"t": 0.0}
    slept: list[float] = []

    def sleep(s):
        slept.append(s)
        now["t"] += s

    rl = RateLimiter(2.0, burst=1, clock=lambda: now["t"], sleep=sleep)
    for _ in range(5):
        rl.acquire()
    # 1 token inicial + 4 esperas de 0.5 s
    assert sum(slept) == pytest.approx(2.0)
