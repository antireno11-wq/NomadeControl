"""Reporte Markdown de una corrida de ingesta, generado solo a partir de la base."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from radar import queries
from radar.config import Settings
from radar.db.models import IngestionRun
from radar.timeutil import utcnow


def _pct(num: int, den: int) -> str:
    return f"{100 * num / den:.2f}%" if den else "n/d"


def _fmt(v: Any, digits: int = 3) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)


def build_run_report(session: Session, settings: Settings, run: IngestionRun) -> str:
    r = queries.run_to_dict(run)
    origin_banner = {
        "real": "Datos **reales** obtenidos de las APIs públicas de Polymarket.",
        "synthetic": "**DATOS SINTÉTICOS** (pruebas/demostración). No representan el mercado.",
    }.get(run.data_origin, run.data_origin)
    lines: list[str] = []
    lines.append(f"# Reporte de ingesta — corrida #{run.id}")
    lines.append("")
    lines.append(f"- Generado: `{utcnow().isoformat()}` (UTC) a partir de la base de datos.")
    lines.append(f"- Origen: {origin_banner}")
    lines.append(f"- Disparo: `{run.trigger}` · Estado: **{run.status}**")
    lines.append(
        f"- Inicio: `{r['started_at']}` · Fin: `{r['finished_at']}` · Duración: {r['duration_s']} s"
    )
    lines.append(f"- Descubierta completa: **{'sí' if run.discovery_complete else 'no'}**")
    lines.append(
        "- Fuentes: Gamma `GET /events/keyset`, `GET /markets/keyset`; CLOB `POST /books`."
    )
    lines.append("")
    lines.append("## Embudo de cobertura")
    lines.append("")
    lines.append("| Etapa | Cantidad | Nota |")
    lines.append("|---|---:|---|")
    rows = [
        ("Páginas Gamma leídas", run.gamma_pages, "100 mercados por página"),
        ("Eventos abiertos descubiertos", run.events_discovered, "con etiquetas → categoría"),
        ("Mercados abiertos descubiertos (únicos)", run.markets_discovered, ""),
        ("Mercados duplicados en la paginación", run.markets_duplicated, "descartados"),
        ("Mercados inválidos (validación)", run.markets_invalid, "ver errores"),
        ("Mercados nuevos (primera vez vistos)", run.markets_new, ""),
        ("Mercados con reglas modificadas", run.markets_rules_changed, "hash de reglas"),
        ("Cierres confirmados", run.markets_closed_detected, "consulta por id"),
        ("Desaparecidos sin confirmar", run.markets_missing_from_source, "missing_since"),
        (
            "Mercados elegibles (filtrados)",
            run.markets_eligible,
            _pct(run.markets_eligible, run.markets_discovered) + " de descubiertos",
        ),
        ("Tokens solicitados al CLOB", run.tokens_requested, f"{run.clob_requests} solicitudes"),
        ("Libros recibidos OK", run.books_ok, _pct(run.books_ok, run.tokens_requested)),
        ("Libros faltantes", run.books_missing, "el CLOB no devolvió libro"),
        ("Libros inválidos", run.books_invalid, ""),
        ("Libros fallidos (error de solicitud)", run.books_failed, ""),
        (
            "Mercados analizados (todos sus libros)",
            run.markets_analyzed,
            _pct(run.markets_analyzed, run.markets_eligible) + " de elegibles",
        ),
        (
            "Mercados que pasan filtro de liquidez",
            run.markets_liquid,
            _pct(run.markets_liquid, run.markets_analyzed) + " de analizados",
        ),
        ("Snapshots insertados", run.snapshots_inserted, f"alcance: {settings.snapshot_scope}"),
        ("Snapshots sin cambios (no reinsertados)", run.snapshots_unchanged, "deduplicación"),
        ("Errores registrados", run.errors_count, ""),
    ]
    for name, value, note in rows:
        lines.append(f"| {name} | {value} | {note} |")
    lines.append("")
    lines.append("## Motivos de exclusión")
    lines.append("")
    lines.append("Elegibilidad (metadatos de Gamma):")
    lines.append("")
    for k, v in sorted((run.eligibility_breakdown or {}).items(), key=lambda kv: -kv[1]):
        lines.append(f"- `{k}`: {v}")
    if not run.eligibility_breakdown:
        lines.append("- (ninguno)")
    lines.append("")
    cfg = run.config or {}
    lines.append(
        "Liquidez (order book del CLOB; spread máx. "
        f"{cfg.get('liq_max_spread')}, profundidad mín. US${cfg.get('liq_min_depth_usd')} "
        f"por lado dentro de {cfg.get('liq_depth_band')} del mejor precio; un mercado puede "
        "acumular varios motivos y se cuenta una vez por token afectado):"
    )
    lines.append("")
    for k, v in sorted(r["liquidity_breakdown"].items(), key=lambda kv: -kv[1]):
        lines.append(f"- `{k}`: {v}")
    lines.append("")
    lines.append("## Errores por etapa y tipo")
    lines.append("")
    if r["error_summary"]:
        for k, v in r["error_summary"].items():
            lines.append(f"- `{k}`: {v}")
    else:
        lines.append("- Sin errores registrados.")
    lines.append("")
    lines.append("## Tiempos por etapa (s)")
    lines.append("")
    for k, v in (run.stage_timings_s or {}).items():
        lines.append(f"- {k}: {v}")
    if run.notes:
        lines.append("")
        lines.append("## Notas de la corrida")
        lines.append("")
        for n in run.notes:
            lines.append(f"- {n}")
    lines.append("")
    lines.append("## Mercados analizados por categoría (estado actual)")
    lines.append("")
    lines.append("| Categoría | Analizados | Líquidos |")
    lines.append("|---|---:|---:|")
    for c in queries.category_counts(session):
        lines.append(f"| {c['category']} | {c['analyzed']} | {c['liquid']} |")
    lines.append("")
    lines.append("## Muestra: 15 mercados líquidos con menor spread")
    lines.append("")
    lines.append(
        "Precios del order book del CLOB (bid/ask ejecutables en el instante del snapshot). "
        "`Precio prom. compra` = VWAP para comprar US$"
        f"{_fmt(settings.reference_notional_usd, 0)} del primer resultado recorriendo el libro."
    )
    lines.append("")
    lines.append(
        "| Mercado | Cat. | Bid | Ask | Spread | Prof. mín. US$ | Precio prom. compra "
        "| Libro (fuente) | Recibido |"
    )
    lines.append("|---|---|---:|---:|---:|---:|---:|---|---|")
    sample = queries.list_markets(session, settings, liquid_only=True, sort="spread", limit=15)
    for m in sample["items"]:
        q = m["question"].replace("|", "/")
        q = q if len(q) <= 70 else q[:67] + "..."
        lines.append(
            f"| {q} | {m['category']} | {_fmt(m['yes_best_bid'])} | {_fmt(m['yes_best_ask'])} | "
            f"{_fmt(m['max_spread'])} | {_fmt(m['min_depth_band_usd'], 0)} | "
            f"{_fmt(m['yes_buy_avg_price_ref'], 4)} | {m['book_source_ts_min']} | "
            f"{m['analyzed_at']} |"
        )
    if not sample["items"]:
        lines.append("| Información insuficiente | | | | | | | | |")
    lines.append("")
    lines.append("## Limitaciones")
    lines.append("")
    lines.append(
        "- Los precios de Gamma (`outcomePrices`, `lastTradePrice`) no se usan como "
        "ejecutables; solo el order book del CLOB."
    )
    lines.append(
        "- Los libros se consultan en lotes secuenciales: no son una foto simultánea; "
        "cada snapshot lleva su propio timestamp de fuente y de recepción."
    )
    lines.append(
        "- El filtro de liquidez no es una señal de trading ni implica oportunidad alguna."
    )
    lines.append("- No se calculan probabilidades, arbitrajes ni valor esperado en este hito.")
    lines.append("")
    return "\n".join(lines)


def default_report_name(run: IngestionRun, now: datetime | None = None) -> str:
    stamp = (run.started_at or now or utcnow()).strftime("%Y%m%dT%H%MZ")
    return f"ingestion_run_{run.id}_{stamp}.md"
