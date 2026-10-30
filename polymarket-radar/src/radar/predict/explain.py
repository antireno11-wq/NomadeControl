"""Explicaciones en lenguaje simple de por qué el radar apostó (en papel) o no.

Traduce las recomendaciones y los motivos técnicos de ``valuation`` a frases cortas para
la pantalla Resumen. No decide nada: solo describe lo que ya decidió la valoración, con
los mismos umbrales (``ValuationConfig``).
"""

from __future__ import annotations

from typing import Any

from radar.predict.base import CALIB_VALIDATED
from radar.predict.valuation import (
    REC_ABSTAIN,
    REC_INSUFFICIENT,
    REC_NONE,
    REC_SIGNAL,
    SUSPENDED_REASON,
    ValuationConfig,
)

CFG = ValuationConfig()

# Prefijo del motivo técnico → frase simple (el orden importa: gana el primero que calce).
_REASONS: tuple[tuple[str, str], ...] = (
    ("modelo no validado", "Todavía no está probado que el radar acierte en este tipo de mercado."),
    ("el modelo no superó al mercado",
     "En las pruebas, el radar no le ganó al precio de Polymarket en este tipo de mercado."),
    ("discrepancia bruta", "La diferencia con el precio de Polymarket es chica."),
    ("ventaja neta tras costos", "Después de la comisión no queda ganancia suficiente."),
    ("ventaja conservadora",
     "Si el radar se equivoca un poco, la apuesta deja de convenir: el margen es muy justo."),
    ("liquidez insuficiente", "No hay suficientes vendedores a ese precio para comprar US$25."),
    ("spread de Kalshi", "En Kalshi, el precio de referencia está muy disperso."),
    ("suma de precios de Kalshi", "En Kalshi, los precios del partido no cuadran."),
    ("spread", "La diferencia entre el precio de compra y el de venta es muy grande."),
    ("libro con antigüedad", "El precio ya era viejo cuando se revisó."),
    (SUSPENDED_REASON[:20], "Suspendido: en vivo, el radar acertó menos que el mercado."),
    ("Información insuficiente: sin libro", "Nadie está vendiendo en este mercado ahora."),
    ("Información insuficiente: modelo de comisión", "No se sabe cuánto cobra de comisión."),
    ("Información insuficiente: el libro", "El libro no permite comprar."),
    ("el partido o la decisión ya empezó", "El partido ya empezó: no se compara en vivo."),
    ("cotización de Kalshi", "El precio de Kalshi no estaba al día."),
    ("Kalshi", "Falta el precio de referencia de Kalshi."),
    ("sin volatilidad implícita", "Falta un dato de mercado para este activo."),
)  # fmt: skip


def friendly_reason(reason: str | None, category: str | None = None) -> str:
    if not reason:
        return "Sin motivo registrado."
    for prefix, text in _REASONS:
        if reason.startswith(prefix):
            if prefix.startswith(("modelo no validado", "el modelo no superó")) and category in (
                "sports",
                "economy",
            ):
                return (
                    "Deportes y Fed están en observación: falta probar que Kalshi le gane "
                    "a Polymarket."
                )
            return text
    return reason


def headline(v: dict[str, Any]) -> str:
    """El motivo principal de una valoración, en una frase."""
    rec = v.get("recommendation")
    reasons = v.get("reasons") or []
    if rec == REC_SIGNAL:
        return "Apostó: cumplía todas las condiciones."
    if rec == REC_NONE:
        return "El precio ya era justo: la diferencia con el radar era de menos de 5 puntos."
    if rec == REC_INSUFFICIENT:
        return "Faltaban datos para poder comprar."
    if rec == REC_ABSTAIN:
        return "El radar no pudo calcular la probabilidad."
    return friendly_reason(reasons[0] if reasons else None, v.get("category"))


def checklist(v: dict[str, Any]) -> list[dict[str, Any]]:
    """Las condiciones de una apuesta, una por una, con ✓ o ✗ (mismos umbrales que la
    valoración). Vacía si el radar no calculó probabilidad o no había libro."""
    if v.get("p_model") is None or v.get("ask_vwap") is None:
        return []
    edge = v.get("edge_pp")
    net = v.get("ev_net_per_share")
    cons = v.get("ev_conservative_per_share")
    spread = v.get("spread")
    age = v.get("book_age_s")
    suspended = SUSPENDED_REASON in (v.get("reasons") or [])
    return [
        {"condición": "El radar está probado en este tipo de mercado",
         "ok": v.get("calibration_status") == CALIB_VALIDATED},
        {"condición": "En las pruebas le ganó al precio de Polymarket",
         "ok": v.get("supera_mercado") is True and not suspended},
        {"condición": f"Diferencia de al menos {CFG.alert_threshold_pp:.0f} puntos",
         "ok": edge is not None and edge >= CFG.alert_threshold_pp,
         "detalle": _dec(f"{edge:+.1f} puntos") if edge is not None else "—"},
        {"condición": "Queda ganancia después de la comisión",
         "ok": net is not None and net * 100 >= CFG.min_net_edge_pp,
         "detalle": _dec(f"{net * 100:+.1f} centavos por acción") if net is not None else "—"},
        {"condición": "Conviene aunque el radar se equivoque un poco",
         "ok": cons is not None and cons > 0},
        {"condición": f"Se pueden comprar US${CFG.order_size_usd:.0f} a ese precio",
         "ok": bool(v.get("fill_complete"))},
        {"condición": "Compra y venta con precios cercanos",
         "ok": spread is not None and spread <= CFG.max_spread,
         "detalle": f"{spread * 100:.0f} centavos de diferencia" if spread is not None else "—"},
        {"condición": "Precio recién revisado",
         "ok": age is not None and age <= CFG.max_book_age_s,
         "detalle": f"{age:.0f} s" if age is not None else "—"},
    ]  # fmt: skip


def _dec(text: str) -> str:
    return text.replace(".", ",")


def cents(p: float | None) -> str:
    return "—" if p is None else f"{p * 100:.0f}¢"


def pct(p: float | None) -> str:
    if p is None:
        return "—"
    if 0.99 < p < 1 or 0 < p < 0.01:  # que 99,7 % no aparezca como 100 %
        return f"{p * 100:.1f} %".replace(".", ",")
    return f"{p * 100:.0f} %"


def usd(x: float | None, sign: bool = False) -> str:
    if x is None:
        return "—"
    s = f"{abs(x):,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    pre = ("+" if x > 0 else "−" if x < 0 else "") if sign else ("−" if x < 0 else "")
    return f"{pre}US${s}"


def trade_story(t: dict[str, Any]) -> str:
    """Una posición de papel contada en dos o tres frases."""
    price, p = t.get("entry_price"), t.get("p_model")
    why = (
        f"Compró **{t['outcome']}** a **{cents(price)}** porque el radar calculaba "
        f"**{pct(p)}** de probabilidad de que el resultado sea {t['outcome']}: pagó "
        f"{cents(price)} por algo que valía {cents(p)}."
    )
    money = f"Puso {usd(t.get('cost_usd'))}; si acierta cobra {usd(t.get('shares'))}."
    status = t.get("status")
    if status == "abierta":
        text = f"{why} {money} Sigue abierta."
    else:
        result = usd(t.get("pnl_usd"), sign=True)
        verb = {"ganada": "Acertó", "perdida": "No acertó", "empate": "Empate"}.get(status, status)
        text = f"{why} {money} **{verb}: {result}.**"
    v2 = t.get("v2_status")
    if v2 == "vendida":
        text += (
            f"\n\n*Vendiendo antes:* se vendió a {cents(t.get('v2_exit_price'))}, porque ya "
            f"pagaban lo que el radar creía que valía → **{usd(t.get('v2_pnl_usd'), sign=True)}**."
        )
    elif v2 == "abierta":
        text += (
            "\n\n*Vendiendo antes:* todavía no conviene vender; el radar cree que vale más de lo "
            "que pagan hoy."
        )
    return text
