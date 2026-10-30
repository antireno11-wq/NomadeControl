"""Comprobación en vivo de base de datos y APIs (estado de conexiones)."""

from __future__ import annotations

import time
from typing import Any

from radar.config import Settings
from radar.db.session import check_db, get_engine
from radar.ingestion.http import ApiClient, ApiError
from radar.timeutil import utcnow


def _probe(
    settings: Settings,
    base_url: str,
    name: str,
    method: str,
    path: str,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    t0 = time.monotonic()
    api = ApiClient(
        base_url,
        name=name,
        rate_per_s=5,
        timeout_s=min(settings.http_timeout_s, 10.0),
        max_retries=1,
        backoff_base_s=0.5,
        user_agent=settings.user_agent,
    )
    try:
        resp = api.request_json(method, path, params=params)
        return {
            "ok": True,
            "checked_at": resp.received_at.isoformat(),
            "latency_ms": round((time.monotonic() - t0) * 1000),
            "endpoint": resp.url,
        }
    except ApiError as exc:
        return {
            "ok": False,
            "checked_at": utcnow().isoformat(),
            "error": str(exc),
            "http_status": exc.status,
            "endpoint": exc.url,
        }
    finally:
        api.close()


def check_all(settings: Settings) -> dict[str, dict[str, Any]]:
    db_error = check_db(get_engine(settings.database_url))
    return {
        "database": {
            "ok": db_error is None,
            "checked_at": utcnow().isoformat(),
            **({"error": db_error} if db_error else {}),
        },
        "polymarket_gamma": _probe(
            settings, settings.gamma_base_url, "gamma", "GET", "/markets/keyset", {"limit": 1}
        ),
        "polymarket_clob": _probe(settings, settings.clob_base_url, "clob", "GET", "/time"),
    }
