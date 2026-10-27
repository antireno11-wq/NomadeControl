"""Configuración central, leída de variables de entorno con prefijo RADAR_.

El sistema es solo de investigación y simulación en papel. ``trading_mode`` no
admite otro valor que ``"paper"``: cualquier otro valor aborta el arranque, de
modo que una variable de entorno accidental no puede habilitar trading real.
Además, el código no contiene autenticación de trading ni envío de órdenes.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RealTradingForbiddenError(ValueError):
    """Se intentó configurar un modo distinto de simulación en papel."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RADAR_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Seguridad -----------------------------------------------------------
    trading_mode: Literal["paper"] = "paper"

    # --- Base de datos ---------------------------------------------------------
    database_url: str = "postgresql+psycopg://radar:radar@localhost:5432/radar"

    # --- APIs públicas de Polymarket (solo lectura) ----------------------------
    gamma_base_url: str = "https://gamma-api.polymarket.com"
    clob_base_url: str = "https://clob.polymarket.com"
    market_url_template: str = "https://polymarket.com/event/{event_slug}"
    # Cloudflare rechaza (error 1010) el User-Agent por defecto de algunas librerías.
    user_agent: str = "polymarket-ai-radar/0.1 (read-only research; no trading)"

    http_timeout_s: float = 30.0
    http_max_retries: int = Field(default=5, ge=0, le=10)
    http_backoff_base_s: float = 1.0
    http_backoff_max_s: float = 30.0
    gamma_rate_per_s: float = Field(default=8.0, gt=0)
    clob_rate_per_s: float = Field(default=8.0, gt=0)
    # Kalshi (solo lectura, datos públicos): referencia externa de deportes y de la Fed.
    kalshi_base_url: str = "https://api.elections.kalshi.com/trade-api/v2"
    kalshi_rate_per_s: float = Field(default=5.0, gt=0)

    # Gamma /markets/keyset entrega como máximo 100 mercados por página.
    gamma_page_size: int = Field(default=100, ge=1, le=100)
    # Tope de seguridad de páginas; None = recorrer todo. Si se alcanza el tope la
    # descubierta queda marcada como incompleta y no se infieren cierres.
    gamma_max_pages: int | None = None
    gamma_fetch_events: bool = True
    clob_books_batch_size: int = Field(default=200, ge=1, le=500)
    # Solicitudes concurrentes a /books (comparten el mismo rate limiter).
    clob_concurrency: int = Field(default=4, ge=1, le=16)
    closed_check_batch_size: int = Field(default=50, ge=1, le=100)

    # --- Filtros de liquidez (sobre el order book ejecutable del CLOB) --------
    liq_max_spread: float = Field(default=0.05, gt=0, le=1)
    liq_depth_band: float = Field(default=0.02, ge=0, le=1)
    liq_min_depth_usd: float = Field(default=100.0, ge=0)
    # Monto de referencia para calcular el precio promedio ejecutable de compra.
    reference_notional_usd: float = Field(default=100.0, gt=0)

    # --- Snapshots ---------------------------------------------------------------
    # Qué mercados generan filas en orderbook_snapshots en cada corrida:
    # liquid = solo los que pasan el filtro de liquidez; analyzed = todos los
    # analizados (con ~10^5 mercados abiertos son ~2·10^5 filas por corrida).
    # market_state guarda siempre el último análisis de todos los mercados.
    snapshot_scope: Literal["liquid", "analyzed"] = "liquid"
    # all = guardar niveles de todos los libros; liquid = solo de mercados que
    # pasan el filtro de liquidez; none = solo métricas agregadas.
    snapshot_store_levels: Literal["all", "liquid", "none"] = "liquid"
    snapshot_max_levels: int = Field(default=50, ge=1, le=1000)

    # --- Programación --------------------------------------------------------------
    # Una corrida completa tarda ~25-35 min con el universo actual (~2,4·10^5 mercados).
    schedule_interval_minutes: int = Field(default=60, ge=5)
    schedule_run_on_start: bool = True
    # Predicciones en vivo (cripto) con libros pedidos en el momento; 0 = desactivado
    predict_interval_minutes: int = Field(default=30, ge=0)

    # --- Retención (ver radar.retention) -------------------------------------------
    retention_live_days: int = Field(default=2, ge=1)
    retention_snapshot_days: int = Field(default=2, ge=1)

    # --- Dashboard ---------------------------------------------------------------
    api_base_url: str = "http://localhost:8000"
    # Si se define, el dashboard pide esta contraseña (necesario si queda en internet).
    dashboard_password: str | None = None

    # Directorio de datos del motor electoral (caché cruda, manifiestos, ledgers).
    data_dir: str | None = None

    log_level: str = "INFO"

    @field_validator("database_url", mode="after")
    @classmethod
    def _psycopg_driver(cls, value: str) -> str:
        """Railway y otros servicios entregan ``postgresql://``; se usa el driver psycopg 3."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @field_validator("trading_mode", mode="before")
    @classmethod
    def _only_paper(cls, value: object) -> object:
        if value is None:
            return "paper"
        if str(value).strip().lower() != "paper":
            raise RealTradingForbiddenError(
                "RADAR_TRADING_MODE solo admite 'paper'. Este sistema no ejecuta "
                "operaciones con dinero real y no contiene código para hacerlo."
            )
        return "paper"

    def redacted(self) -> dict[str, object]:
        """Configuración apta para registrar en la base de datos o en logs."""
        data = self.model_dump()
        data["database_url"] = _redact_url(self.database_url)
        data["dashboard_password"] = "***" if self.dashboard_password else None
        return data


def _redact_url(url: str) -> str:
    if "@" not in url or "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.rsplit("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
