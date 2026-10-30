"""Tablero del Resumen: HTML armado solo con lo que entrega el backend (SINTÉTICO)."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from radar.dashboard import theme as T

NOW = datetime(2026, 10, 30, 18, 0, tzinfo=UTC)


def trade(status: str, variant: str, cost: float, pnl: float | None, days_ago: float,
          question: str = "Will Bitcoin dip to $78,000?") -> dict:  # fmt: skip
    resolved = (NOW - timedelta(days=days_ago)).isoformat() if status != "abierta" else None
    return {"status": status, "variant": variant, "cost_usd": cost, "pnl_usd": pnl,
            "resolved_at": resolved, "question": question, "category": "crypto"}  # fmt: skip


PAPER = {
    "capital_inicial_usd": 1000.0,
    "capital_actual_usd": 1054.0,
    "exposicion_usd": 75.0,
    "exposicion_maxima_usd": 300.0,
    "abiertas": 3,
    "cerradas": 2,
    "ganadas": 1,
    "perdidas": 1,
    "resultado_usd": 54.0,
    "items": [
        trade("abierta", "touch_range", 25, None, 0),
        trade("abierta", "touch_range", 25, None, 0),
        trade("abierta", "touch_range", 25, None, 0, "Will Ethereum reach $2,600?"),
        trade("ganada", "hourly_above", 25, 80.0, 1),
        trade("perdida", "daily_above", 25, -26.0, 10),  # fuera de los 7 días
    ],
}


def test_css_survives_the_streamlit_sanitizer() -> None:
    body = T.CSS.split("<style>", 1)[1].rsplit("</style>", 1)[0]
    assert not re.search(r"<[/\w]", body)  # un <style> con "<" se descarta entero
    assert "rb-i-cartera" in body


def test_board_uses_only_backend_numbers() -> None:
    html = T.board(now=NOW, live=None, recent=[], paper=PAPER, n_markets=1722, n_signals=0,
                   n_alerts=69)  # fmt: skip
    assert "<svg" not in html
    assert "US$1.054" in html and "+US$54" in html  # capital y resultado del backend
    assert "Bitcoin" in html and "Ethereum" in html  # apuestas abiertas por moneda
    assert "1.722" in html and "69" in html
    assert "50%" in html  # acierto 1 de 2


def test_board_without_data_shows_dashes() -> None:
    html = T.board(now=NOW, live=None, recent=[], paper={}, n_markets=0, n_signals=0,
                   n_alerts=0)  # fmt: skip
    assert "Sin apuestas abiertas" in html and "Todavía sin apuestas resueltas" in html
    assert "Todavía no hay revisiones" in html


def test_daily_pnl_only_counts_the_last_seven_days() -> None:
    days = T.daily_pnl(PAPER["items"], NOW)
    assert len(days) == 7 and sum(v for _, v in days) == 80.0


def test_formats() -> None:
    assert T.usd(1054.0) == "US$1.054" and T.usd(-3.5, sign=True, dec=1) == "−US$3,5"
    assert T.usd(None) == "—" and T.pct(0.054, 1) == "5,4%"
