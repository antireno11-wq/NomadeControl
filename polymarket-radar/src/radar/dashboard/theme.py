"""Tema oscuro y tablero de tarjetas del Resumen (solo presentación).

Las funciones arman HTML a partir de lo que entrega el backend; no calculan ni inventan
cifras. Sin dato se muestra "—".
"""

from __future__ import annotations

import html
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

CHILE = ZoneInfo("America/Santiago")
DIAS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")
MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

GREEN = "#6fbf73"
GREEN_2 = "#93cf7c"
LIME = "#c9d65a"
OLIVE = "#9b9a3e"
LOSS = "#d98a6c"
TRACK = "rgba(255,255,255,0.10)"
RESERVE_USD = 700.0  # reserva mínima de paper-v1

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&display=swap');
:root {
  --rb-bg: #0a0e0c; --rb-card: rgba(28, 30, 27, 0.72); --rb-card-2: rgba(40, 42, 37, 0.62);
  --rb-line: rgba(255, 255, 255, 0.09); --rb-text: #f1f1ec; --rb-muted: #a9aaa2;
  --rb-green: #6fbf73; --rb-lime: #c9d65a; --rb-loss: #d98a6c;
}
html, body, [data-testid="stAppViewContainer"], .stApp {
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
}
.stApp {
  background-color: var(--rb-bg);
  background-image:
    radial-gradient(circle at 74% 9%, rgba(255, 196, 110, 0.30) 0, transparent 2.6%),
    radial-gradient(circle at 81% 16%, rgba(255, 170, 80, 0.26) 0, transparent 3.2%),
    radial-gradient(circle at 87% 6%, rgba(120, 190, 255, 0.24) 0, transparent 2.4%),
    radial-gradient(circle at 92% 21%, rgba(255, 110, 90, 0.22) 0, transparent 2.8%),
    radial-gradient(circle at 69% 22%, rgba(255, 220, 160, 0.18) 0, transparent 2.2%),
    radial-gradient(circle at 96% 33%, rgba(110, 200, 240, 0.18) 0, transparent 3.5%),
    radial-gradient(circle at 84% 28%, rgba(255, 200, 120, 0.14) 0, transparent 6%),
    radial-gradient(circle at 63% 13%, rgba(140, 200, 255, 0.12) 0, transparent 4%),
    radial-gradient(circle at 18% 22%, rgba(255, 190, 110, 0.10) 0, transparent 7%),
    radial-gradient(circle at 30% 8%, rgba(255, 210, 150, 0.08) 0, transparent 5%),
    radial-gradient(ellipse 60% 45% at 82% 14%, rgba(255, 160, 80, 0.13) 0, transparent 100%),
    radial-gradient(ellipse 70% 50% at 45% -5%, rgba(111, 191, 115, 0.12) 0, transparent 100%),
    linear-gradient(180deg, rgba(10, 14, 12, 0) 35%, rgba(10, 14, 12, 0.85) 75%);
  background-attachment: fixed;
  color: var(--rb-text);
}
[data-testid="stHeader"] { background: transparent; }
[data-testid="stToolbar"] { visibility: hidden; }
.block-container { padding: 1.6rem 2.2rem 3rem !important; max-width: 1360px; }
.rb-wrap { container-type: inline-size; }
[data-testid="stSidebar"] {
  background: rgba(14, 16, 14, 0.78); backdrop-filter: blur(20px);
  border-right: 1px solid var(--rb-line);
}
[data-testid="stSidebar"] [data-testid="stRadioGroup"] { gap: 8px; width: 100%; }
[data-testid="stSidebar"] [data-testid="stRadioOption"] {
  width: 100%; padding: 11px 14px; border-radius: 16px; margin: 0 0 6px;
  background: rgba(255, 255, 255, .05); border: 1px solid var(--rb-line);
  transition: background .15s ease; }
[data-testid="stSidebar"] [data-testid="stRadioOption"]:hover { background: rgba(255,255,255,.1); }
[data-testid="stSidebar"] [data-testid="stRadioOption"] > div > div:first-child { display: none; }
[data-testid="stSidebar"] [data-testid="stRadioOption"][data-selected="true"] {
  background: #f3f3ee; border-color: #f3f3ee; }
[data-testid="stSidebar"] [data-testid="stRadioOption"][data-selected="true"] p {
  color: #111 !important; font-weight: 500; }
[data-testid="stSidebar"] [data-testid="stWidgetLabel"] p {
  color: var(--rb-muted); font-size: 12px; }
h1, h2, h3 { font-weight: 400 !important; letter-spacing: -0.01em; }
h2, h3 { margin-top: 1.6rem !important; }
[data-testid="stExpander"], [data-testid="stDataFrame"], [data-testid="stMetric"],
[data-testid="stAlert"] {
  background: var(--rb-card); border: 1px solid var(--rb-line) !important;
  border-radius: 18px !important; backdrop-filter: blur(14px);
}
[data-testid="stMetric"] { padding: 14px 18px; }
[data-testid="stExpander"] details { border: none !important; }

.rb-top { display: flex; align-items: center; justify-content: space-between; gap: 16px;
  margin: 4px 0 6px; }
.rb-brand { display: flex; align-items: center; gap: 12px; }
.rb-logo { width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
  background: linear-gradient(145deg, #7fcf83, #3e8a52); color: #fff; font-weight: 600;
  font-size: 20px; box-shadow: 0 6px 18px rgba(80, 160, 100, .35); }
.rb-brand b { display: block; font-weight: 600; font-size: 15px; }
.rb-brand span { color: var(--rb-muted); font-size: 12px; }
.rb-chip { border: 1px solid var(--rb-line); background: var(--rb-card-2); border-radius: 999px;
  padding: 8px 14px; font-size: 12.5px; color: var(--rb-text); white-space: nowrap;
  backdrop-filter: blur(10px); }
.rb-chip i { font-style: normal; color: var(--rb-green); margin-right: 6px; }
.rb-user { display: flex; align-items: center; gap: 10px; }
.rb-avatar { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
  background: linear-gradient(145deg, #3a3f38, #23261f); border: 1px solid var(--rb-line);
  font-weight: 500; font-size: 14px; }
.rb-user b { display: block; font-size: 14px; font-weight: 500; }
.rb-user span { color: var(--rb-muted); font-size: 11.5px; }
.rb-circles { display: flex; gap: 7px; justify-content: center; margin-bottom: 22px; }
.rb-circles span { width: 32px; height: 32px; border-radius: 50%; display: grid;
  place-items: center; font-size: 15px; background: rgba(255, 255, 255, .08);
  border: 1px solid var(--rb-line); }
.rb-circles span.on { background: rgba(255, 255, 255, .18); }
.rb-bars .rb-val { font-size: 10.5px; color: var(--rb-text); }
.rb-reasons { margin: 6px 0 4px; }
.rb-reasons .rb-line { grid-template-columns: minmax(0, 1fr) minmax(90px, 28%) 64px;
  font-size: 13.5px; }
.rb-reasons .rb-line span:first-child { color: var(--rb-text); }
.rb-stackline { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px;
  font-size: 13px; }
.rb-stackline .rb-track { grid-column: 1 / -1; }
.rb-stackline span:nth-child(2) { color: var(--rb-muted); font-size: 12px; }
.rb-section { font-size: 21px; font-weight: 400; margin: 26px 0 12px; }
.rb-hero { text-align: center; margin: 6px 0 34px; }
.rb-hero p { margin: 0; font-size: 21px; font-weight: 500; }
.rb-hero h1 { margin: 6px 0 0 !important; font-size: clamp(30px, 4.2vw, 46px) !important;
  font-weight: 200 !important; color: #e9eae4; padding: 0 !important; }
.rb-tools { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px;
  margin-bottom: 12px; }

.rb-grid { display: grid; gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 0.95fr); }
.rb-card { background: var(--rb-card); border: 1px solid var(--rb-line); border-radius: 22px;
  padding: 18px 18px 16px; backdrop-filter: blur(16px); min-height: 230px;
  display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0, 0, 0, .25); }
.rb-tall { grid-row: span 2; align-items: center; text-align: center; }
.rb-wide { grid-column: span 3; }
.rb-row2 { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; grid-column: span 3; }
.rb-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.rb-icon { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center;
  background: linear-gradient(150deg, #78c47c, #3f7d55); color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .25); }
.rb-icon svg { width: 22px; height: 22px; }
.rb-title { font-size: 18px; font-weight: 400; line-height: 1.2; }
.rb-note { margin-left: auto; color: var(--rb-muted); font-size: 12px; align-self: flex-start; }
.rb-big { font-size: 30px; font-weight: 300; margin-top: auto; letter-spacing: -0.01em; }
.rb-sub { color: var(--rb-muted); font-size: 12.5px; margin-top: 2px; }
.rb-up { color: var(--rb-green); } .rb-down { color: var(--rb-loss); }
.rb-rows { display: grid; gap: 10px; margin-bottom: 14px; }
.rb-line { display: grid; grid-template-columns: minmax(70px, 96px) 1fr 38px;
  align-items: center; gap: 10px;
  font-size: 13px; }
.rb-line span:last-child { color: var(--rb-muted); text-align: right; font-size: 12px; }
.rb-track { height: 8px; border-radius: 99px; background: rgba(255, 255, 255, .10);
  overflow: hidden; }
.rb-fill { height: 100%; border-radius: 99px; }
.rb-bars { display: flex; align-items: flex-end; justify-content: center; gap: 8px;
  height: 104px; margin: 4px 0 10px; }
.rb-bar { width: 22px; border-radius: 9px; position: relative; }
.rb-barcol { display: flex; flex-direction: column; align-items: center; gap: 6px;
  font-size: 11px; color: var(--rb-muted); }
.rb-stack { display: flex; height: 22px; border-radius: 8px; overflow: hidden; margin: 6px 0 12px; }
.rb-legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px;
  color: var(--rb-muted); white-space: nowrap; }
.rb-legend b { display: block; color: var(--rb-text); font-weight: 400; font-size: 13.5px;
  margin-top: 2px; }
.rb-chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;
  margin-bottom: 18px; }
.rb-chips span { font-size: 11px; padding: 6px 10px; border-radius: 999px;
  background: rgba(255, 255, 255, .07); border: 1px solid var(--rb-line); }
.rb-donut { position: relative; width: 190px; height: 190px; margin: 6px auto 14px; }
.rb-ring { position: absolute; inset: 0; border-radius: 50%;
  --rb-hole: radial-gradient(farthest-side, transparent calc(100% - 19px),
    #000 calc(100% - 18px));
  -webkit-mask: var(--rb-hole); mask: var(--rb-hole); }
.rb-donut b { position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 44px; font-weight: 300; }
.rb-dots { display: flex; gap: 18px; justify-content: center; font-size: 12.5px; }
.rb-dots i { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
  margin-right: 6px; vertical-align: -1px; }
.rb-score { display: grid; grid-template-columns: repeat(12, 1fr); gap: 7px; margin: 16px 0; }
.rb-score i { height: 34px; border-radius: 9px; }
.rb-score-num { text-align: center; margin-top: -6px; }
.rb-score-num b { display: block; font-size: 28px; font-weight: 300; color: var(--rb-green); }
.rb-score-num span { font-size: 14px; }
.rb-foot { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: auto;
  font-size: 12px; color: var(--rb-muted); }
.rb-foot b { display: block; font-size: 18px; color: var(--rb-text); font-weight: 300; }
.rb-line-wide { grid-template-columns: minmax(110px, 140px) 1fr 48px; }
.rb-rows-gap { margin: 16px 0; }
.rb-head-score { margin-bottom: 0; }
.rb-head-score .rb-score-num { margin: 0 auto; }
.rb-tall-foot { margin-top: auto; }
.rb-tall-foot .rb-title { font-size: 17px; }
.rb-foot div:nth-child(2) { text-align: center; } .rb-foot div:nth-child(3) { text-align: right; }
@container (max-width: 840px) {
  .rb-grid { grid-template-columns: 1fr 1fr; }
  .rb-tall { grid-row: auto; } .rb-row2 { grid-column: span 2; }
}
@container (max-width: 560px) {
  .rb-grid, .rb-row2 { grid-template-columns: 1fr; } .rb-row2 { grid-column: auto; }
}
@media (max-width: 680px) {
  .rb-top { flex-wrap: wrap; } .rb-hero h1 { font-size: 28px !important; }
  .block-container { padding: 1.2rem 1rem 2rem !important; }
}
/*ICONOS*/
</style>
"""

# Iconos como máscaras CSS: st.html quita las etiquetas <svg> del contenido.
_ICON_SVG = {
    "cartera": "<rect x='3' y='6' width='18' height='13' rx='3'/><path d='M16 12h5M3 9h13'/>",
    "resultado": "<path d='M4 19h16M7 16V10M12 16V6M17 16v-4'/>",
    "plata": "<path d='M12 3a9 9 0 1 0 9 9h-9z'/><path d='M14 3v7h7a8 8 0 0 0-7-7z'/>",
}


def _icon_css() -> str:
    out = []
    for name, body in _ICON_SVG.items():
        svg = (
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' "
            f"stroke='black' stroke-width='1.8' stroke-linecap='round'>{body}</svg>"
        )
        # Sin "<" ni ">" literales: el saneador de st.html descarta un <style> que los tenga.
        enc = svg.replace("<", "%3C").replace(">", "%3E")
        url = f'url("data:image/svg+xml;utf8,{enc}")'
        out.append(
            f".rb-i-{name}::before {{ content: ''; width: 22px; height: 22px; background: #fff; "
            f"-webkit-mask: {url} center / contain no-repeat; mask: {url} center / contain "
            "no-repeat; }"
        )
    return "\n".join(out)


CSS = CSS.replace("/*ICONOS*/", _icon_css())


# --- formatos ----------------------------------------------------------------------------------


def esc(x: Any) -> str:
    return html.escape(str(x))


def usd(x: float | None, *, sign: bool = False, dec: int = 0) -> str:
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    s = f"{abs(x):,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    pre = ("+" if x > 0 else "−" if x < 0 else "") if sign else ("−" if x < 0 else "")
    return f"{pre}US${s}"


def pct(x: float | None, dec: int = 0) -> str:
    return "—" if x is None else f"{x * 100:.{dec}f}%".replace(".", ",")


def ago(ts: str | None, now: datetime) -> str:
    if not ts:
        return "—"
    s = (now - datetime.fromisoformat(ts)).total_seconds()
    if s < 120:
        return f"hace {s:.0f} s"
    if s < 7200:
        return f"hace {s / 60:.0f} min"
    return f"hace {s / 3600:.1f} h".replace(".", ",")


def chile(ts: str | None) -> str:
    if not ts:
        return "—"
    t = datetime.fromisoformat(ts).astimezone(CHILE)
    return f"{t.day}-{MESES[t.month - 1]} {t:%H:%M}"


# --- piezas ------------------------------------------------------------------------------------


def head(icon: str, title: str, note: str = "") -> str:
    n = f'<span class="rb-note">{esc(note)}</span>' if note else ""
    return (
        f'<div class="rb-head"><div class="rb-icon rb-i-{icon}"></div>'
        f'<div class="rb-title">{esc(title)}</div>{n}</div>'
    )


def bar_line(label: str, share: float, color: str) -> str:
    w = max(0.0, min(1.0, share)) * 100
    return (f'<div class="rb-line"><span>{esc(label)}</span><div class="rb-track">'
            f'<div class="rb-fill" style="width:{w:.0f}%;background:{color}"></div></div>'
            f"<span>{w:.0f}%</span></div>")  # fmt: skip


def donut(share: float | None, colors: tuple[str, str] = (GREEN, LIME)) -> str:
    """Anillo: ``share`` en el primer color y el resto en el segundo (CSS, sin SVG)."""
    if share is None:
        fill, label = TRACK, "—"
    else:
        a = max(0.0, min(1.0, share)) * 100
        fill = f"conic-gradient({colors[0]} 0 {a:.1f}%, {colors[1]} {a:.1f}% 100%)"
        label = pct(share)
    ring = f'<div class="rb-ring" style="background:{fill}"></div>'
    return f'<div class="rb-donut">{ring}<b>{label}</b></div>'


# --- datos del tablero (desde las respuestas del backend) ---------------------------------------


def daily_pnl(items: list[dict[str, Any]], now: datetime, days: int = 7) -> list[tuple[str, float]]:
    """Resultado de las apuestas resueltas por día (hora de Chile), últimos ``days`` días."""
    today = now.astimezone(CHILE).date()
    by_day: dict[Any, float] = defaultdict(float)
    for t in items:
        if t.get("status") == "abierta" or not t.get("resolved_at"):
            continue
        d = datetime.fromisoformat(t["resolved_at"]).astimezone(CHILE).date()
        if (today - d).days < days:
            by_day[d] += float(t.get("pnl_usd") or 0.0)
    out = []
    for k in range(days - 1, -1, -1):
        d = today - timedelta(days=k)
        out.append((DIAS[d.weekday()], by_day.get(d, 0.0)))
    return out


# --- tablero -----------------------------------------------------------------------------------

SHORT_LABELS = {
    "daily_above": "Diario sobre",
    "daily_below": "Diario bajo",
    "daily_range": "Diario rango",
    "daily_updown": "Sube/baja día",
    "hourly_above": "Por hora",
    "hourly_updown": "Sube/baja hora",
    "touch_day": "Toque día",
    "touch_range": "Toque semana",
    "touch_month": "Toque mes",
    "fed_decision": "Fed",
}


def num(n: int | None) -> str:
    return "—" if n is None else f"{n:,}".replace(",", ".")


def short_label(variant: str | None) -> str:
    v = variant or ""
    return SHORT_LABELS.get(v) or ("Deportes" if v.endswith("_partido") else "Otros")


def _line(label: str, value: str, width: float, color: str) -> str:
    return (
        '<div class="rb-line rb-line-wide"><span>' + esc(label) + "</span>"
        '<div class="rb-track"><div class="rb-fill" style="width:'
        + f"{max(0.0, min(1.0, width)) * 100:.0f}%;background:{color}"
        + '"></div></div><span>'
        + esc(value)
        + "</span></div>"
    )


def _foot(*cells: tuple[str, str]) -> str:
    return (
        '<div class="rb-foot">'
        + "".join(f"<div>{esc(k)}<b>{esc(v)}</b></div>" for k, v in cells)
        + "</div>"
    )


def _score(title: str, big: str, label: str, note: str) -> str:
    return (
        f'<div class="rb-head rb-head-score"><div class="rb-title">{esc(title)}</div>'
        f'<div class="rb-score-num"><b>{esc(big)}</b><span>{esc(label)}</span>'
        f'<div class="rb-sub">{esc(note)}</div></div></div>'
    )


ASSETS = (("bitcoin", "Bitcoin"), ("ethereum", "Ethereum"), ("solana", "Solana"),
          ("xrp", "XRP"))  # fmt: skip


def topic(t: dict[str, Any]) -> str:
    """Tema de una apuesta: la moneda si es cripto; si no, el tipo de mercado."""
    q = (t.get("question") or "").lower()
    if t.get("category") == "crypto":
        for key, name in ASSETS:
            if key in q:
                return name
    return short_label(t.get("variant"))


def card_open_bets(paper: dict[str, Any]) -> str:
    cost: Counter[str] = Counter()
    kinds: Counter[str] = Counter()
    for t in paper.get("items") or []:
        if t.get("status") == "abierta":
            cost[topic(t)] += float(t.get("cost_usd") or 0.0)
            kinds[short_label(t.get("variant"))] += 1
    total = sum(cost.values())
    rows = cost.most_common(3)
    if total and sum(v for _, v in rows) < total - 1e-9:
        rows.append(("Otros", total - sum(v for _, v in rows)))
    colors = (GREEN, GREEN_2, LIME, OLIVE)
    lines = "".join(
        f'<div class="rb-stackline"><span>{esc(k)}</span><span>{pct(v / total)}</span>'
        f'<div class="rb-track"><div class="rb-fill" style="width:{100 * v / total:.0f}%;'
        f'background:{colors[i]}"></div></div></div>'
        for i, (k, v) in enumerate(rows)
    )
    lines = lines or '<div class="rb-sub">Sin apuestas abiertas.</div>'
    kind = (f"todas «{kinds.most_common(1)[0][0]}»" if len(kinds) == 1
            else f"{len(kinds)} tipos") if kinds else "sin apuestas"  # fmt: skip
    return (
        f'<div class="rb-card">{head("cartera", "Apuestas abiertas")}'
        f'<div class="rb-rows">{lines}</div>'
        f'<div class="rb-big">{usd(float(paper.get("exposicion_usd") or 0.0))}</div>'
        f'<div class="rb-sub">{num(paper.get("abiertas", 0))} apuestas, {esc(kind)} · máximo '
        f"{usd(paper.get('exposicion_maxima_usd'))}</div></div>"
    )


def card_result(paper: dict[str, Any], now: datetime) -> str:
    days = daily_pnl(paper.get("items") or [], now)
    week = sum(v for _, v in days)
    top = max([abs(v) for _, v in days] + [1e-9])
    cols = []
    for d, v in days:
        color = GREEN if v > 0 else LOSS if v < 0 else TRACK
        h = max(5.0, 78 * abs(v) / top)
        val = f'<span class="rb-val">{esc(f"{v:+.0f}")}</span>' if abs(v) >= 0.5 else ""
        cols.append(
            f'<div class="rb-barcol">{val}<div class="rb-bar" style="height:{h:.0f}px;'
            f'background:{color}" title="{esc(usd(v, sign=True, dec=2))}"></div>{esc(d)}</div>'
        )
    cls = "rb-up" if week > 0 else "rb-down" if week < 0 else "rb-sub"
    arrow = "↑" if week > 0 else "↓" if week < 0 else "·"
    return (
        f'<div class="rb-card">{head("resultado", "Resultado", "Últimos 7 días")}'
        f'<div class="rb-bars">{"".join(cols)}</div>'
        f'<div class="rb-big">{usd(paper.get("resultado_usd"), sign=True)}</div>'
        f'<div class="rb-sub"><span class="{cls}">{arrow} {usd(week, sign=True)}</span> en 7 '
        f"días · {num(paper.get('cerradas', 0))} resueltas</div></div>"
    )


def card_money(paper: dict[str, Any]) -> str:
    capital = paper.get("capital_actual_usd")
    start = float(paper.get("capital_inicial_usd") or 1000.0)
    exposure = float(paper.get("exposicion_usd") or 0.0)
    cap = float(capital) if capital is not None else None
    parts: list[tuple[str, float, str]] = []
    if cap and cap > 0:
        free = max(cap - RESERVE_USD - exposure, 0.0)
        parts = [
            ("En juego", exposure / cap, GREEN),
            ("Reserva", min(RESERVE_USD, cap) / cap, LIME),
            ("Libre", free / cap, OLIVE),
        ]
    stack = "".join(f'<div style="width:{w * 100:.1f}%;background:{c}"></div>' for _, w, c in parts)
    legend = "".join(f"<div>{esc(n)}<b>{pct(w)}</b></div>" for n, w, _ in parts)
    gain = (cap - start) / start if cap is not None else None
    cls = "rb-up" if (gain or 0) > 0 else "rb-down" if (gain or 0) < 0 else "rb-sub"
    arrow = "↓" if (gain or 0) < 0 else "↑"
    return (
        f'<div class="rb-card">{head("plata", "Plata de práctica", "Desde el 26-oct")}'
        f'<div class="rb-stack">{stack}</div><div class="rb-legend">{legend}</div>'
        f'<div class="rb-big">{usd(cap)}</div><div class="rb-sub"><span class="{cls}">'
        f"{arrow} {pct(gain, 1)}</span> desde {usd(start)} · no es dinero real</div></div>"
    )


def card_hit_rate(paper: dict[str, Any]) -> str:
    won, lost = int(paper.get("ganadas", 0)), int(paper.get("perdidas", 0))
    closed = won + lost
    chips = "".join(
        f'<span class="{"on" if k == "₿" else ""}" title="{t}">{k}</span>'
        for k, t in (("₿", "Cripto"), ("🏀", "NBA"), ("⚽", "Fútbol"), ("🎾", "Tenis ATP"),
                     ("🏛", "Fed y economía"), ("🗳", "Elecciones"))
    )  # fmt: skip
    title = f"{num(closed)} apuestas resueltas" if closed else "Todavía sin apuestas resueltas"
    return (
        f'<div class="rb-card rb-tall"><div class="rb-circles">{chips}</div>'
        f'<div class="rb-title">Acierto</div>{donut(won / closed if closed else None)}'
        f'<div class="rb-dots"><span><i style="background:{GREEN}"></i>Ganadas {won}</span>'
        f'<span><i style="background:{LIME}"></i>Perdidas {lost}</span></div>'
        f'<div class="rb-tall-foot"><div class="rb-title">{esc(title)}</div>'
        '<div class="rb-sub">Apuestas de práctica de US$25 al precio real</div></div></div>'
    )


def card_runs(live: dict[str, Any] | None, recent: list[dict[str, Any]], n_markets: int,
              now: datetime) -> str:  # fmt: skip
    last = recent[:12][::-1]
    ok = sum(r.get("status") == "success" for r in last)
    colors = {"success": GREEN, "failed": LOSS}
    blocks = "".join(
        f'<i style="background:{colors.get(r.get("status") or "", TRACK)}" '
        f'title="{esc(chile(r.get("started_at")))} · {esc(r.get("status"))}"></i>'
        for r in last
    )
    blocks = blocks or '<div class="rb-sub">Todavía no hay revisiones.</div>'
    state = ("Al día" if ok == len(last) else "Con fallas") if last else "—"
    dur = None
    if live and live.get("finished_at") and live.get("started_at"):
        span = datetime.fromisoformat(live["finished_at"]) - datetime.fromisoformat(
            live["started_at"]
        )
        dur = span.total_seconds() / 60
    return (
        '<div class="rb-card">'
        + _score("Revisiones", f"{ok}/{len(last)}" if last else "—", state, "las últimas 12")
        + f'<div class="rb-score">{blocks}</div>'
        + _foot(
            ("Última", ago((live or {}).get("finished_at"), now)),
            ("Mercados", num(n_markets)),
            ("Duración", "—" if dur is None else f"{dur:.0f} min"),
        )
        + "</div>"
    )


def card_chances(n_markets: int, n_signals: int, n_alerts: int) -> str:
    big = n_alerts + n_signals
    top = max(big, 1)
    label = "Vale la pena apostar" if n_signals else "Nada claro ahora"
    return (
        '<div class="rb-card">'
        + _score("Oportunidades", str(n_signals), label, "en la última revisión")
        + '<div class="rb-rows rb-rows-gap">'
        + _line("Diferencia ≥ 5 pts", num(big), big / top, GREEN)
        + _line("Pasan todo", num(n_signals), n_signals / top, LIME)
        + "</div>"
        + _foot(
            ("Revisados", num(n_markets)),
            ("Casi entran", num(n_alerts)),
            ("Señales", num(n_signals)),
        )
        + "</div>"
    )


def board(
    *,
    now: datetime,
    live: dict[str, Any] | None,
    recent: list[dict[str, Any]],
    paper: dict[str, Any],
    n_markets: int,
    n_signals: int,
    n_alerts: int,
) -> str:
    return (
        '<div class="rb-wrap"><div class="rb-grid">'
        + card_open_bets(paper)
        + card_result(paper, now)
        + card_money(paper)
        + card_hit_rate(paper)
        + '<div class="rb-row2">'
        + card_runs(live, recent, n_markets, now)
        + card_chances(n_markets, n_signals, n_alerts)
        + "</div></div></div>"
    )


def header(*, now: datetime, live: dict[str, Any] | None, name: str = "Sebastián") -> str:
    when = chile((live or {}).get("finished_at"))
    hour = now.astimezone(CHILE).strftime("%H:%M")
    initials = "".join(w[0] for w in name.split()[:2]).upper() or "R"
    return (
        '<div class="rb-top"><div class="rb-brand"><div class="rb-logo">R</div><div>'
        "<b>Radar</b><span>Polymarket · práctica</span></div></div>"
        f'<div class="rb-user"><div class="rb-avatar">{esc(initials)}</div><div>'
        f"<b>{esc(name)}</b><span>Modo práctica · sin dinero real</span></div></div></div>"
        f'<div class="rb-hero"><p>Hola, {esc(name)} 👋</p>'
        "<h1>¿Qué encontró el radar hoy?</h1></div>"
        f'<div class="rb-tools"><span class="rb-chip">🗓 Última revisión: {esc(when)}</span>'
        '<span class="rb-chip">⟳ Revisa cada 30 min</span>'
        f'<span class="rb-chip"><i>●</i>{esc(hour)} hora de Chile</span></div>'
    )


def reasons_card(reasons: list[dict[str, Any]], n_markets: int) -> str:
    """Motivos de la última revisión como barras (parte de los mercados revisados)."""
    if not reasons:
        return ""
    colors = (GREEN, GREEN_2, LIME, OLIVE)
    lines = "".join(
        _line(r["motivo"], num(r["mercados"]), r["mercados"] / max(n_markets, 1),
              colors[min(i, 3)])
        for i, r in enumerate(reasons)
    )  # fmt: skip
    return (
        '<div class="rb-card" style="min-height:0"><div class="rb-head">'
        '<div class="rb-icon rb-i-resultado"></div><div class="rb-title">¿Por qué apostó o no '
        f'apostó?</div><span class="rb-note">{num(n_markets)} mercados</span></div>'
        f'<div class="rb-rows rb-reasons">{lines}</div><div class="rb-sub">Casi siempre el '
        "precio ya es justo: Polymarket suele acertar. El radar busca las pocas veces en que "
        "se equivoca.</div></div>"
    )
