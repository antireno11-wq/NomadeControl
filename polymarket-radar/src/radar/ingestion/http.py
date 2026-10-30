"""Cliente HTTP de solo lectura con rate limiting, reintentos y backoff.

- Token bucket por cliente (una instancia por API).
- Reintenta errores de transporte, 408, 429 y 5xx con backoff exponencial y jitter,
  respetando ``Retry-After`` cuando la API lo envía.
- No reintenta otros 4xx: son errores de la solicitud o bloqueos de política.
- Cada respuesta incluye el timestamp de recepción, separado de los timestamps
  propios de los datos.
"""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from radar.logging_setup import get_logger
from radar.timeutil import utcnow

log = get_logger(__name__)

RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524})


class ApiError(Exception):
    """Fallo definitivo de una llamada a una API externa."""

    def __init__(
        self,
        message: str,
        *,
        url: str,
        status: int | None = None,
        attempts: int = 1,
        error_type: str = "http_error",
        body: str | None = None,
    ) -> None:
        super().__init__(message)
        self.url = url
        self.status = status
        self.attempts = attempts
        self.error_type = error_type
        self.body = body


@dataclass(frozen=True)
class ApiResponse:
    data: Any
    url: str
    status: int
    received_at: datetime
    elapsed_s: float
    attempts: int


class RateLimiter:
    """Token bucket thread-safe: ``rate`` solicitudes por segundo, ráfaga ``burst``."""

    def __init__(
        self,
        rate_per_s: float,
        burst: int | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if rate_per_s <= 0:
            raise ValueError("rate_per_s debe ser positivo")
        self.rate = rate_per_s
        self.capacity = float(burst if burst is not None else max(1, int(rate_per_s)))
        self._tokens = self.capacity
        self._clock = clock
        self._sleep = sleep
        self._last = clock()
        self._lock = threading.Lock()

    def acquire(self) -> float:
        """Bloquea hasta disponer de un token. Devuelve los segundos esperados."""
        waited = 0.0
        while True:
            with self._lock:
                now = self._clock()
                self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
                self._last = now
                if self._tokens >= 1:
                    self._tokens -= 1
                    return waited
                wait = (1 - self._tokens) / self.rate
            self._sleep(wait)
            waited += wait


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


class ApiClient:
    def __init__(
        self,
        base_url: str,
        *,
        name: str,
        rate_per_s: float,
        timeout_s: float = 30.0,
        max_retries: int = 5,
        backoff_base_s: float = 1.0,
        backoff_max_s: float = 30.0,
        user_agent: str = "polymarket-ai-radar/0.1",
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        rng: random.Random | None = None,
    ) -> None:
        self.name = name
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        self.backoff_max_s = backoff_max_s
        self._sleep = sleep
        self._rng = rng or random.Random()  # noqa: S311 - jitter, no criptografía
        self.limiter = RateLimiter(rate_per_s, sleep=sleep)
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout_s,
            headers={"user-agent": user_agent, "accept": "application/json"},
            transport=transport,
            follow_redirects=False,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> ApiClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _backoff(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return min(self.backoff_max_s, retry_after)
        base = min(self.backoff_max_s, self.backoff_base_s * (2**attempt))
        return base * (0.5 + self._rng.random() / 2)

    def _send(
        self,
        method: str,
        path: str,
        *,
        params: Any = None,
        json: Any = None,
    ) -> tuple[httpx.Response, str, float, int]:
        """Envía con rate limit y reintentos. Devuelve (respuesta, url, segundos, intentos)."""
        url = str(self._client.build_request(method, path, params=params).url)
        attempt = 0
        while True:
            attempt += 1
            self.limiter.acquire()
            started = time.monotonic()
            try:
                response = self._client.request(method, path, params=params, json=json)
            except httpx.TransportError as exc:
                if attempt > self.max_retries:
                    raise ApiError(
                        f"{self.name}: error de conexión tras {attempt} intentos: {exc!r}",
                        url=url,
                        attempts=attempt,
                        error_type=f"transport:{type(exc).__name__}",
                    ) from exc
                delay = self._backoff(attempt - 1, None)
                log.warning(
                    "http_transport_error_retry",
                    api=self.name,
                    url=url,
                    attempt=attempt,
                    delay_s=round(delay, 2),
                    error=repr(exc),
                )
                self._sleep(delay)
                continue

            elapsed = time.monotonic() - started
            if response.status_code in RETRYABLE_STATUS:
                if attempt > self.max_retries:
                    raise ApiError(
                        f"{self.name}: HTTP {response.status_code} tras {attempt} intentos",
                        url=url,
                        status=response.status_code,
                        attempts=attempt,
                        body=response.text[:500],
                    )
                delay = self._backoff(attempt - 1, _retry_after_seconds(response))
                log.warning(
                    "http_retryable_status",
                    api=self.name,
                    url=url,
                    status=response.status_code,
                    attempt=attempt,
                    delay_s=round(delay, 2),
                )
                self._sleep(delay)
                continue

            if response.status_code >= 400:
                body = response.text[:500]
                hint = ""
                if response.status_code == 403 and "1010" in body:
                    hint = " (bloqueo de Cloudflare por User-Agent/firma de cliente)"
                raise ApiError(
                    f"{self.name}: HTTP {response.status_code}{hint}",
                    url=url,
                    status=response.status_code,
                    attempts=attempt,
                    body=body,
                )
            return response, url, elapsed, attempt

    def request_json(
        self,
        method: str,
        path: str,
        *,
        params: Any = None,
        json: Any = None,
    ) -> ApiResponse:
        response, url, elapsed, attempt = self._send(method, path, params=params, json=json)
        try:
            data = response.json()
        except ValueError as exc:
            raise ApiError(
                f"{self.name}: respuesta no es JSON válido",
                url=url,
                status=response.status_code,
                attempts=attempt,
                error_type="invalid_json",
                body=response.text[:500],
            ) from exc
        return ApiResponse(
            data=data,
            url=url,
            status=response.status_code,
            received_at=utcnow(),
            elapsed_s=elapsed,
            attempts=attempt,
        )

    def request_text(self, method: str, path: str, *, params: Any = None) -> ApiResponse:
        """Como ``request_json`` pero devuelve el cuerpo como texto (p. ej. HTML)."""
        response, url, elapsed, attempt = self._send(method, path, params=params)
        return ApiResponse(
            data=response.text,
            url=url,
            status=response.status_code,
            received_at=utcnow(),
            elapsed_s=elapsed,
            attempts=attempt,
        )

    def request_bytes(self, method: str, path: str, *, params: Any = None) -> ApiResponse:
        """Como ``request_json`` pero devuelve el cuerpo binario (p. ej. un ZIP)."""
        response, url, elapsed, attempt = self._send(method, path, params=params)
        return ApiResponse(
            data=response.content,
            url=url,
            status=response.status_code,
            received_at=utcnow(),
            elapsed_s=elapsed,
            attempts=attempt,
        )
