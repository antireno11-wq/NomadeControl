"""Dashboard Streamlit de Polymarket AI Radar (hito 1).

Lee todo desde el backend FastAPI (RADAR_API_BASE_URL). No calcula ni inventa
datos: si el backend no responde o no hay corridas, lo dice.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

import altair as alt
import httpx
import pandas as pd
import streamlit as st

API = os.environ.get("RADAR_API_BASE_URL", "http://localhost:8000").rstrip("/")

# Paleta categórica de referencia (slots 1 y 2), validada para daltonismo.
SERIES_1 = "#2a78d6"  # bid / compra
SERIES_2 = "#eb6834"  # ask / venta

st.set_page_config(page_title="Polymarket AI Radar", layout="wide")


def api_get(path: str, **params: Any) -> Any:
    try:
        r = httpx.get(f"{API}{path}", params=params, timeout=30)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as exc:
        st.error(f"El backend respondió {exc.response.status_code} en {path}.")
    except httpx.HTTPError as exc:
        st.error(f"Backend no disponible en {API} ({type(exc).__name__}). Inicie `radar api`.")
    return None


def fmt_ts(ts: str | None) -> str:
    if not ts:
        return "—"
    dt = datetime.fromisoformat(ts)
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")


def fmt_age(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    if seconds < 120:
        return f"hace {seconds:.0f} s"
    if seconds < 7200:
        return f"hace {seconds / 60:.0f} min"
    return f"hace {seconds / 3600:.1f} h"


def banner(status: dict[str, Any] | None) -> None:
    st.caption(
        "Solo simulación y análisis. Este sistema **no** ejecuta operaciones con dinero real."
    )
    if status is None:
        return
    running = status.get("run_in_progress")
    if running:
        st.info(
            f"Corrida #{running['id']} en curso desde {fmt_ts(running['started_at'])}: "
            f"{running['gamma_pages']:,} páginas, {running['markets_discovered']:,} mercados "
            f"descubiertos, {running['books_ok']:,} libros recibidos (conteos parciales). "
            "Las cifras de abajo son de la última corrida terminada."
        )
    mode = status.get("data_mode")
    if mode == "sin_datos":
        st.warning(
            "**Sin datos reales todavía.** Ejecute `radar ingest` (o espere al scheduler). "
            "No se muestran cifras de ejemplo."
        )
    elif mode == "demo_sintetica":
        st.error("**MODO DEMOSTRACIÓN — datos sintéticos.** No representan el mercado real.")
    else:
        last = status.get("last_run") or {}
        st.success(
            f"**Datos reales** de las APIs públicas de Polymarket · última corrida "
            f"#{last.get('id')} ({last.get('status')}) terminada "
            f"{fmt_ts(last.get('finished_at'))} ({fmt_age(status.get('last_run_age_s'))})."
        )
        if last.get("status") != "success":
            st.warning(
                "La última corrida no fue completamente exitosa: revise errores y cobertura "
                "en la pantalla **Ingesta**."
            )


# ------------------------------------------------------------------ pantallas
def page_radar(status: dict[str, Any] | None) -> None:
    st.header("Radar")
    if status is None or status.get("last_run") is None:
        st.info("Información insuficiente: no hay corridas de ingesta registradas.")
        return
    run = status["last_run"]
    c = st.columns(5)
    c[0].metric("Mercados encontrados", f"{run['markets_discovered']:,}")
    c[1].metric("Mercados filtrados (elegibles)", f"{run['markets_eligible']:,}")
    c[2].metric("Mercados analizados", f"{run['markets_analyzed']:,}")
    c[3].metric("Pasan filtro de liquidez", f"{run['markets_liquid']:,}")
    c[4].metric("Oportunidades detectadas", "—")
    st.caption(
        "Oportunidades: el motor de arbitraje y valoración aún no está implementado "
        "(hitos 3 y 5). No se muestran oportunidades hasta que exista un cálculo verificable."
    )

    left, right = st.columns(2)
    with left:
        st.subheader("Última actualización")
        st.write(
            f"- Corrida #{run['id']} · disparo `{run['trigger']}` · estado **{run['status']}**\n"
            f"- Inicio: {fmt_ts(run['started_at'])}\n"
            f"- Fin: {fmt_ts(run['finished_at'])} ({fmt_age(status.get('last_run_age_s'))})\n"
            f"- Duración: {run['duration_s']} s\n"
            f"- Descubierta completa: {'sí' if run['discovery_complete'] else '**no**'}\n"
            f"- Cobertura de libros: "
            f"{(run['book_coverage'] or 0) * 100:.2f}% "
            f"({run['books_ok']:,} de {run['tokens_requested']:,} tokens)\n"
            f"- Errores registrados: {run['errors_count']:,}"
        )
        for note in run.get("notes") or []:
            st.warning(note)
    with right:
        st.subheader("Estado de conexiones")
        rows = []
        for name, s in (status.get("sources") or {}).items():
            rows.append(
                {
                    "fuente": name,
                    "estado (última corrida)": s.get("state"),
                    "errores": s.get("errors_last_run"),
                }
            )
        if rows:
            st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        if st.button("Probar conexión ahora"):
            live = api_get("/api/connectivity")
            if live:
                st.dataframe(
                    pd.DataFrame(
                        [
                            {
                                "servicio": k,
                                "ok": v.get("ok"),
                                "latencia_ms": v.get("latency_ms"),
                                "comprobado": fmt_ts(v.get("checked_at")),
                                "error": v.get("error"),
                            }
                            for k, v in live.items()
                        ]
                    ),
                    hide_index=True,
                    width="stretch",
                )

    st.subheader("Embudo de cobertura de la última corrida")
    funnel = [
        ("Páginas Gamma", run["gamma_pages"]),
        ("Eventos descubiertos", run["events_discovered"]),
        ("Mercados descubiertos", run["markets_discovered"]),
        ("Inválidos", run["markets_invalid"]),
        ("Nuevos", run["markets_new"]),
        ("Cierres confirmados", run["markets_closed_detected"]),
        ("Desaparecidos sin confirmar", run["markets_missing_from_source"]),
        ("Elegibles", run["markets_eligible"]),
        ("Tokens solicitados", run["tokens_requested"]),
        ("Libros OK", run["books_ok"]),
        ("Libros faltantes", run["books_missing"]),
        ("Libros inválidos", run["books_invalid"]),
        ("Libros fallidos", run["books_failed"]),
        ("Analizados", run["markets_analyzed"]),
        ("Líquidos", run["markets_liquid"]),
        ("Snapshots insertados", run["snapshots_inserted"]),
        ("Snapshots sin cambios", run["snapshots_unchanged"]),
    ]
    st.dataframe(
        pd.DataFrame(funnel, columns=["etapa", "cantidad"]), hide_index=True, width="stretch"
    )

    cats = api_get("/api/categories")
    if cats:
        st.subheader("Mercados analizados por categoría")
        st.caption("Categoría derivada de las etiquetas del evento en Gamma (regla tags-v1).")
        st.dataframe(pd.DataFrame(cats), hide_index=True, width="stretch")


def page_markets() -> None:
    st.header("Mercados y liquidez")
    st.caption(
        "Bid/ask del order book del CLOB en el instante del snapshot (precios ejecutables, no "
        "último precio). 'Precio prom. compra' = VWAP para comprar el monto de referencia del "
        "primer resultado. Volumen 24h es de Gamma (indicativo)."
    )
    cats = api_get("/api/categories") or []
    f = st.columns([1, 1, 2, 1])
    liquid_only = f[0].toggle("Solo líquidos", value=True)
    category = f[1].selectbox("Categoría", ["(todas)"] + [c["category"] for c in cats])
    search = f[2].text_input("Buscar en la pregunta o evento")
    sort = f[3].selectbox(
        "Orden", ["spread", "depth", "volume_24h", "end_date", "analyzed_at"], index=0
    )
    page_size = 200
    page_no = st.number_input("Página", min_value=1, value=1, step=1)
    data = api_get(
        "/api/markets",
        liquid_only=liquid_only,
        category=None if category == "(todas)" else category,
        search=search or None,
        sort=sort,
        limit=page_size,
        offset=(page_no - 1) * page_size,
    )
    if not data:
        return
    st.write(f"{data['total']:,} mercados coinciden.")
    if not data["items"]:
        st.info("Información insuficiente para los filtros elegidos.")
        return
    df = pd.DataFrame(data["items"])
    df["recibido"] = df["analyzed_at"].map(fmt_ts)
    df["motivos"] = df["reasons"].map(lambda r: ", ".join(r) if r else "")
    view = df[
        [
            "id",
            "question",
            "category",
            "yes_best_bid",
            "yes_best_ask",
            "max_spread",
            "min_depth_band_usd",
            "yes_buy_avg_price_ref",
            "yes_buy_fully_filled_ref",
            "gamma_volume_24h",
            "end_date",
            "recibido",
            "motivos",
            "url",
        ]
    ]
    st.dataframe(
        view,
        hide_index=True,
        width="stretch",
        height=600,
        column_config={
            "id": "id",
            "question": st.column_config.TextColumn("Mercado", width="large"),
            "category": "Categoría",
            "yes_best_bid": st.column_config.NumberColumn("Bid (1er res.)", format="%.3f"),
            "yes_best_ask": st.column_config.NumberColumn("Ask (1er res.)", format="%.3f"),
            "max_spread": st.column_config.NumberColumn("Spread máx.", format="%.3f"),
            "min_depth_band_usd": st.column_config.NumberColumn("Prof. mín. US$", format="%.0f"),
            "yes_buy_avg_price_ref": st.column_config.NumberColumn(
                "Precio prom. compra", format="%.4f"
            ),
            "yes_buy_fully_filled_ref": st.column_config.CheckboxColumn("Llenado completo"),
            "gamma_volume_24h": st.column_config.NumberColumn(
                "Vol. 24h Gamma (indic.)", format="%.0f"
            ),
            "end_date": "Vence",
            "recibido": "Libro recibido",
            "motivos": "Motivos de rechazo",
            "url": st.column_config.LinkColumn("Enlace", display_text="abrir"),
        },
    )
    st.caption("Para ver reglas, libros e historial, copie el id en la pantalla **Detalle**.")


def _depth_chart(bids: list[dict[str, float]], asks: list[dict[str, float]]) -> alt.Chart | None:
    rows = []
    cum = 0.0
    for lv in bids:
        cum += lv["price"] * lv["size"]
        rows.append({"precio": lv["price"], "acumulado_usd": cum, "lado": "bids"})
    cum = 0.0
    for lv in asks:
        cum += lv["price"] * lv["size"]
        rows.append({"precio": lv["price"], "acumulado_usd": cum, "lado": "asks"})
    if not rows:
        return None
    df = pd.DataFrame(rows)
    return (
        alt.Chart(df)
        .mark_line(interpolate="step-after", strokeWidth=2)
        .encode(
            x=alt.X("precio:Q", title="Precio", scale=alt.Scale(zero=False)),
            y=alt.Y("acumulado_usd:Q", title="Profundidad acumulada (US$)"),
            color=alt.Color(
                "lado:N",
                scale=alt.Scale(domain=["bids", "asks"], range=[SERIES_1, SERIES_2]),
                legend=alt.Legend(title=None, orient="top"),
            ),
            tooltip=[
                alt.Tooltip("lado:N"),
                alt.Tooltip("precio:Q", format=".3f"),
                alt.Tooltip("acumulado_usd:Q", format=",.0f", title="US$ acumulado"),
            ],
        )
        .properties(height=260)
    )


def _price_chart(snaps: list[dict[str, Any]]) -> alt.Chart | None:
    rows = []
    for s in snaps:
        t = s["received_at"]
        if s.get("best_bid") is not None:
            rows.append({"recibido": t, "precio": s["best_bid"], "serie": "mejor bid"})
        if s.get("best_ask") is not None:
            rows.append({"recibido": t, "precio": s["best_ask"], "serie": "mejor ask"})
    if not rows:
        return None
    df = pd.DataFrame(rows)
    df["recibido"] = pd.to_datetime(df["recibido"], utc=True)
    hover = alt.selection_point(fields=["recibido"], nearest=True, on="pointerover", empty=False)
    base = alt.Chart(df).encode(
        x=alt.X(
            "recibido:T",
            title="Recepción del snapshot (UTC)",
            scale=alt.Scale(type="utc"),
            axis=alt.Axis(format="%m-%d %H:%M"),
        ),
        y=alt.Y("precio:Q", title="Precio", scale=alt.Scale(zero=False)),
        color=alt.Color(
            "serie:N",
            scale=alt.Scale(domain=["mejor bid", "mejor ask"], range=[SERIES_1, SERIES_2]),
            legend=alt.Legend(title=None, orient="top"),
        ),
    )
    lines = base.mark_line(strokeWidth=2, interpolate="step-after")
    # Marcadores siempre visibles: cada punto es un snapshot real (un libro nuevo).
    points = (
        base.mark_point(filled=True)
        .encode(
            size=alt.condition(hover, alt.value(140), alt.value(64)),
            tooltip=[
                alt.Tooltip("recibido:T", format="%Y-%m-%d %H:%M:%S", formatType="utc"),
                alt.Tooltip("serie:N"),
                alt.Tooltip("precio:Q", format=".3f"),
            ],
        )
        .add_params(hover)
    )
    return (lines + points).properties(height=260)


def page_detail() -> None:
    st.header("Detalle de mercado")
    market_id = st.text_input("Id del mercado (Gamma)", value=st.query_params.get("market", ""))
    if not market_id:
        st.info("Ingrese el id de un mercado (columna 'id' en la pantalla Mercados).")
        return
    st.query_params["market"] = market_id
    m = api_get(f"/api/markets/{market_id}")
    if not m:
        return
    if m["data_origin"] != "real":
        st.error("Este mercado proviene de datos SINTÉTICOS.")
    st.subheader(m["question"])
    if m.get("url"):
        st.markdown(f"[Abrir en Polymarket]({m['url']})")
    ev = m.get("event") or {}
    st.write(
        f"Evento: {ev.get('title', '—')} · categoría: `{ev.get('category', 'unknown')}` · "
        f"etiquetas: {', '.join(t for t in ev.get('tags', []) if t) or '—'}"
    )

    st.markdown("#### Reglas exactas (texto de Gamma)")
    st.text(m.get("rules") or "Información insuficiente: el mercado no publica descripción.")
    st.write(f"Fuente de resolución declarada: {m.get('resolution_source') or '—'}")
    st.write(f"Resultados posibles: {', '.join(m.get('outcomes') or [])}")

    cols = st.columns(3)
    with cols[0]:
        st.markdown("#### Estado")
        st.json(m["status"], expanded=True)
    with cols[1]:
        st.markdown("#### Fechas (UTC)")
        st.json(m["dates"], expanded=True)
    with cols[2]:
        st.markdown("#### Parámetros de negociación")
        st.json(m["trading_params"], expanded=True)

    state = m.get("state")
    st.markdown("#### Evaluación de liquidez")
    if not state:
        st.info("Información insuficiente: el mercado no ha sido analizado.")
    else:
        if state["liquid"]:
            st.success("Pasa el filtro de liquidez (no es una recomendación de trading).")
        else:
            st.warning("Rechazado por el filtro de liquidez: " + ", ".join(state["reasons"]))
        st.write(
            f"Análisis de la corrida #{state['run_id']} · libro recibido "
            f"{fmt_ts(state['analyzed_at'])} · timestamp de la fuente "
            f"{fmt_ts(state['book_source_ts_min'])}"
        )
        st.write(
            f"Suma de mejores asks de todos los resultados: {state['sum_best_asks']} · suma de "
            f"mejores bids: {state['sum_best_bids']} (diagnóstico; no implica arbitraje)."
        )
        if state["yes_buy_avg_price_ref"] is not None:
            st.write(
                f"Comprar US${state['reference_notional_usd']:.0f} del primer resultado: precio "
                f"promedio {state['yes_buy_avg_price_ref']:.4f}, slippage "
                f"{state['yes_buy_slippage_ref']:.4f}, llenado completo: "
                f"{'sí' if state['yes_buy_fully_filled_ref'] else 'no'}."
            )
        st.dataframe(pd.DataFrame(state["outcomes_metrics"]), hide_index=True, width="stretch")

    st.markdown("#### Order books (último snapshot guardado)")
    for tok in m["tokens"]:
        snap = tok.get("latest_snapshot")
        st.markdown(f"**{tok['outcome']}** · token `{tok['token_id'][:16]}…`")
        if not snap:
            st.caption(
                "Sin snapshot guardado (alcance de snapshots = solo mercados líquidos, o aún no "
                "analizado)."
            )
            continue
        st.caption(
            f"Fuente: {snap['source']} · timestamp fuente {fmt_ts(snap['source_ts'])} · "
            f"recibido {fmt_ts(snap['received_at'])} · hash {snap['book_hash'][:12]}"
            + (" · niveles truncados" if snap["levels_truncated"] else "")
        )
        if snap.get("bids") is None:
            st.caption("Solo métricas agregadas (niveles no guardados para este snapshot).")
            continue
        book_cols = st.columns([1, 1, 2])
        book_cols[0].dataframe(pd.DataFrame(snap["bids"][:15]), hide_index=True, width="stretch")
        book_cols[1].dataframe(pd.DataFrame(snap["asks"][:15]), hide_index=True, width="stretch")
        chart = _depth_chart(snap["bids"], snap["asks"])
        if chart is not None:
            book_cols[2].altair_chart(chart, width="stretch")

    st.markdown("#### Evolución de precios (primer resultado)")
    if m["tokens"]:
        snaps = api_get(
            f"/api/markets/{market_id}/snapshots", token_id=m["tokens"][0]["token_id"], limit=2000
        )
        if snaps and len(snaps) >= 2:
            chart = _price_chart(snaps)
            if chart is not None:
                st.altair_chart(chart, width="stretch")
            st.caption(
                f"{len(snaps)} snapshots. Un nuevo snapshot solo se guarda cuando el libro cambia."
            )
        else:
            st.info("Información insuficiente: se necesitan al menos 2 snapshots guardados.")

    with st.expander("Precios informados por Gamma (indicativos, NO ejecutables)"):
        st.json(m["gamma_indicative"])


def page_ingestion() -> None:
    st.header("Ingesta: corridas, cobertura y errores")
    runs = api_get("/api/runs", limit=50)
    if not runs:
        st.info("Información insuficiente: no hay corridas registradas.")
        return
    df = pd.DataFrame(runs)
    st.dataframe(
        df[
            [
                "id",
                "trigger",
                "status",
                "data_origin",
                "started_at",
                "duration_s",
                "discovery_complete",
                "markets_discovered",
                "markets_eligible",
                "markets_analyzed",
                "markets_liquid",
                "books_ok",
                "books_missing",
                "books_failed",
                "errors_count",
            ]
        ],
        hide_index=True,
        width="stretch",
    )
    run_id = st.selectbox("Corrida", [r["id"] for r in runs])
    run = next(r for r in runs if r["id"] == run_id)
    c = st.columns(3)
    with c[0]:
        st.markdown("**Motivos de no elegibilidad**")
        st.json(run["eligibility_breakdown"])
    with c[1]:
        st.markdown("**Motivos de rechazo por liquidez**")
        st.json(run["liquidity_breakdown"])
    with c[2]:
        st.markdown("**Errores por etapa:tipo**")
        st.json(run["error_summary"] or {"sin errores": 0})
    st.markdown("**Tiempos por etapa (s)**")
    st.json(run["stage_timings_s"])
    for note in run.get("notes") or []:
        st.warning(note)
    errors = api_get(f"/api/runs/{run_id}/errors", limit=500)
    st.markdown(f"**Errores registrados (muestra, hasta 500)**: {len(errors or [])}")
    if errors:
        st.dataframe(pd.DataFrame(errors), hide_index=True, width="stretch")


def page_pending(title: str, milestone: str, needs: list[str]) -> None:
    st.header(title)
    st.info(f"No implementado todavía ({milestone}). No se muestran datos ficticios ni de ejemplo.")
    st.markdown("Requisitos antes de habilitar esta pantalla:")
    for n in needs:
        st.markdown(f"- {n}")


PAGES = [
    "Radar",
    "Mercados",
    "Detalle",
    "Ingesta",
    "Oportunidades",
    "Cartera virtual",
    "Calidad predictiva",
]


def main() -> None:
    st.sidebar.title("Polymarket AI Radar")
    page = st.sidebar.radio("Pantalla", PAGES)
    st.sidebar.caption(f"Backend: {API}")
    health = api_get("/api/health")
    if health:
        st.sidebar.caption(
            f"API {health['version']} · base: {health['database']} · trading: "
            f"{health['trading_mode']}"
        )
    status = api_get("/api/status")
    banner(status)
    if page == "Radar":
        page_radar(status)
    elif page == "Mercados":
        page_markets()
    elif page == "Detalle":
        page_detail()
    elif page == "Ingesta":
        page_ingestion()
    elif page == "Oportunidades":
        page_pending(
            "Oportunidades",
            "hitos 3 y 5",
            [
                "Normalización de contratos y validación determinista de relaciones (hito 2).",
                "Motor de arbitraje con pagos por escenario y costos ejecutables (hito 3).",
                "Modelos predictivos calibrados; sin calibración no hay señal (hitos 4-5).",
            ],
        )
    elif page == "Cartera virtual":
        page_pending(
            "Cartera virtual",
            "hito 6",
            [
                "Simulador de ejecución sobre order books con llenados parciales.",
                "Ledger auditable; capital US$1.000, reserva US$700, exposición máx. US$300.",
            ],
        )
    else:
        page_pending(
            "Calidad predictiva",
            "hito 7",
            [
                "Predicciones registradas con timestamp y resultados verificados.",
                "Brier score, log loss y curvas de calibración fuera de muestra.",
            ],
        )


main()
