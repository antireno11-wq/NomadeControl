"""Explicaciones simples de la pantalla Resumen (datos SINTÉTICOS)."""

from __future__ import annotations

from radar.predict import explain as E
from radar.predict.valuation import SUSPENDED_REASON


def val(**kw: object) -> dict:
    base = {
        "recommendation": "alerta_investigacion", "category": "crypto", "reasons": [],
        "p_model": 0.48, "ask_vwap": 0.36, "edge_pp": 12.0, "ev_net_per_share": 0.10,
        "ev_conservative_per_share": 0.02, "fill_complete": True, "spread": 0.01,
        "book_age_s": 0.5, "calibration_status": "validado", "supera_mercado": True,
    }  # fmt: skip
    return base | kw


def test_headline_uses_the_main_reason_in_plain_words() -> None:
    assert E.headline(val(recommendation="señal_operable")).startswith("Apostó")
    assert "precio ya era justo" in E.headline(val(recommendation="sin_ventaja"))
    alert = val(reasons=["el modelo no superó al mercado fuera de muestra"])
    assert "no le ganó al precio" in E.headline(alert)
    sports = val(category="sports", reasons=["modelo no validado para este tipo (sin_evaluar)"])
    assert "observación" in E.headline(sports)
    assert "Kalshi" in E.friendly_reason("spread de Kalshi > 0.1")  # no lo confunde con Polymarket
    assert E.friendly_reason("motivo nuevo sin traducir") == "motivo nuevo sin traducir"


def test_checklist_mirrors_the_valuation_gates() -> None:
    ok = E.checklist(val())
    assert len(ok) == 8 and all(r["ok"] for r in ok)
    bad = E.checklist(val(supera_mercado=False, fill_complete=False, reasons=[SUSPENDED_REASON]))
    failed = {r["condición"] for r in bad if not r["ok"]}
    assert failed == {"En las pruebas le ganó al precio de Polymarket",
                      "Se pueden comprar US$25 a ese precio"}  # fmt: skip
    assert E.checklist(val(p_model=None)) == []


def test_trade_story_and_formats() -> None:
    t = {"outcome": "No", "entry_price": 0.36, "p_model": 0.48, "cost_usd": 26.12,
         "shares": 69.44, "status": "ganada", "pnl_usd": 43.32}  # fmt: skip
    story = E.trade_story(t)
    assert "Compró **No** a **36¢**" in story and "**48 %** de probabilidad" in story
    assert E.pct(0.997) == "99,7 %" and E.pct(0.5) == "50 %"
    assert "Acertó: +US$43,32" in story
    assert E.usd(1053.73) == "US$1.053,73" and E.usd(-2.5, sign=True) == "−US$2,50"
    assert "Sigue abierta" in E.trade_story(t | {"status": "abierta"})
