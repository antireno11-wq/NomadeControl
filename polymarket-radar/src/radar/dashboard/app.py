"""Dashboard Streamlit de Polymarket AI Radar (hito 1).

Lee todo desde el backend FastAPI (RADAR_API_BASE_URL). No calcula ni inventa
datos: si el backend no responde o no hay corridas, lo dice.
"""

from __future__ import annotations

import hmac
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
    c = st.columns(4)
    c[0].metric("Mercados encontrados", f"{run['markets_discovered']:,}")
    c[1].metric("Mercados filtrados (elegibles)", f"{run['markets_eligible']:,}")
    c[2].metric("Mercados analizados", f"{run['markets_analyzed']:,}")
    c[3].metric("Pasan filtro de liquidez", f"{run['markets_liquid']:,}")
    st.caption(
        "Esta pantalla muestra la ingesta de todo Polymarket. Las señales, la cartera de papel "
        "y los aciertos del radar están en **Resumen** y **Señales y alertas**."
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


SERIES_3 = "#1baf7a"  # compras reales observadas


def _election_chart(timeline: list[dict[str, Any]], a_label: str) -> alt.Chart | None:
    rows = []
    band = []
    for p in timeline:
        cons = p.get("consenso") or {}
        t = pd.to_datetime(p["t"], utc=True)
        if cons.get("reference_prob_a") is not None:
            rows.append(
                {"t": t, "valor": cons["reference_prob_a"], "serie": "Modelo: P(A) referencia"}
            )
            band.append({"t": t, "min": cons["min_prob_a"], "max": cons["max_prob_a"]})
        for d in p.get("decisiones") or []:
            q = d["quote"]
            if q["label"] != f"{a_label} YES" or q["price"] is None:
                continue
            if q["basis"] == "precio_referencia_no_ejecutable":
                rows.append(
                    {"t": t, "valor": q["price"], "serie": "Mercado: precio ref. (no ejecutable)"}
                )
            elif q["basis"] == "precio_ejecutado_observado":
                rows.append(
                    {"t": t, "valor": q["price"], "serie": "Mercado: máx. compra real (60 min)"}
                )
    if not rows:
        return None
    df = pd.DataFrame(rows)
    domain = [
        "Modelo: P(A) referencia",
        "Mercado: precio ref. (no ejecutable)",
        "Mercado: máx. compra real (60 min)",
    ]
    color = alt.Color(
        "serie:N",
        scale=alt.Scale(domain=domain, range=[SERIES_1, SERIES_2, SERIES_3]),
        legend=alt.Legend(title=None, orient="top", labelLimit=320),
    )
    x = alt.X(
        "t:T",
        title="Instante de evaluación (UTC)",
        scale=alt.Scale(type="utc"),
        axis=alt.Axis(format="%d-%b %H:%M"),
    )
    y = alt.Y("valor:Q", title="Probabilidad / precio", scale=alt.Scale(domain=[0, 1]))
    layers = []
    if band:
        layers.append(
            alt.Chart(pd.DataFrame(band))
            .mark_area(opacity=0.15, color=SERIES_1)
            .encode(
                x=x.title("Instante de evaluación (UTC)"),
                y="min:Q",
                y2="max:Q",
                tooltip=[
                    alt.Tooltip("min:Q", format=".1%", title="mín. estimaciones"),
                    alt.Tooltip("max:Q", format=".1%", title="máx. estimaciones"),
                ],
            )
        )
    lines = (
        alt.Chart(df[df["serie"] != domain[2]])
        .mark_line(strokeWidth=2)
        .encode(
            x=x,
            y=y,
            color=color,
            tooltip=[
                alt.Tooltip("t:T", format="%Y-%m-%d %H:%M", formatType="utc"),
                alt.Tooltip("serie:N"),
                alt.Tooltip("valor:Q", format=".3f"),
            ],
        )
    )
    pts = (
        alt.Chart(df[df["serie"] == domain[2]])
        .mark_point(filled=True, size=64)
        .encode(
            x=x,
            y=y,
            color=color,
            tooltip=[
                alt.Tooltip("t:T", format="%Y-%m-%d %H:%M", formatType="utc"),
                alt.Tooltip("serie:N"),
                alt.Tooltip("valor:Q", format=".3f"),
            ],
        )
    )
    layers += [lines, pts]
    return alt.layer(*layers).properties(height=320)


def page_elections() -> None:
    st.header("Motor de discrepancias electorales")
    summary = api_get("/api/elections/summary") or {}
    bt = summary.get("backtest") or {}
    val = (bt.get("summary") or {}).get("validacion")
    if val != "validado":
        st.error(
            "**Modelo NO validado.** Solo se emiten alertas de investigación; ninguna señal "
            "operable es posible hasta cumplir los criterios de validación fijados de antemano."
        )
    disc = (summary.get("discover") or {}).get("summary") or {}
    if disc:
        st.subheader("Mercados electorales activos")
        c = st.columns(4)
        c[0].metric("Mercados electorales", f"{disc.get('mercados_electorales', 0):,}")
        c[1].metric("Eventos", f"{disc.get('eventos_electorales', 0):,}")
        c[2].metric("Vinculados a una contienda", f"{disc.get('vinculados_a_contienda', 0):,}")
        c[3].metric("Modelados", f"{disc.get('modelados', 0):,}")
        cols = st.columns(2)
        cols[0].dataframe(
            pd.DataFrame(list((disc.get("por_tipo") or {}).items()), columns=["tipo", "mercados"]),
            hide_index=True,
            width="stretch",
        )
        cols[1].dataframe(
            pd.DataFrame(
                list((disc.get("motivos_abstencion") or {}).items()),
                columns=["motivo de abstención", "mercados"],
            ),
            hide_index=True,
            width="stretch",
        )
    else:
        st.info("Información insuficiente: ejecute `radar elections discover`.")

    st.subheader("Backtest retrospectivo: Brasil 2026, segunda vuelta")
    data = api_get("/api/elections/backtest")
    if not data:
        st.info("Información insuficiente: ejecute `radar elections backtest`.")
        return
    st.warning(
        f"Generado el {fmt_ts(data['creado'])}, **después** del resultado. Las alertas de este "
        "backtest son retrospectivas: no son evidencia previa al resultado."
    )
    tl = data["timeline"]
    signals = [p for p in tl if p.get("senal_operable")]
    first = data.get("primera_alerta")
    st.markdown(
        f"**¿Habría detectado una señal operable antes del resultado?** "
        f"{'Sí' if signals else 'No'}."
    )
    if first:
        d = first["decision"]
        q = d["quote"]
        st.markdown(
            f"**Primera alerta de investigación:** {fmt_ts(first['as_of'])} · token "
            f"**{q['label']}** · precio {q['price']:.3f} (`{q['basis']}`) · discrepancia "
            f"{d['discrepancy_pp']:+.1f} p.p. · ventaja conservadora "
            f"{d['conservative_edge_pp']:+.1f} p.p. · revisión Wikipedia "
            f"`{first['revision_wikipedia']['revid']}`"
        )
        with st.expander("Motivos por los que no fue señal operable"):
            for g in d["gating"]:
                st.write(f"- {g}")
    chart = _election_chart(tl, "Lula")
    if chart is not None:
        st.altair_chart(chart, width="stretch")
        st.caption(
            "A = Lula. Banda: rango entre todas las estimaciones registradas. El precio de "
            "referencia no es ejecutable; los puntos son compras reales (precio máximo pagado "
            "en la hora previa)."
        )
    rows = []
    for p in tl:
        cons = p.get("consenso") or {}
        rows.append(
            {
                "T (UTC)": p["t"][:16],
                "revisión": (p.get("revision") or {}).get("revision_ts", "")[:16],
                "encuestas": p.get("encuestas_en_revision"),
                "P(Lula) ref.": cons.get("reference_prob_a"),
                "mín": cons.get("min_prob_a"),
                "máx": cons.get("max_prob_a"),
                "alerta": p.get("alerta"),
                "señal": p.get("senal_operable"),
                "estado": p.get("estado", ""),
            }
        )
    st.dataframe(
        pd.DataFrame(rows),
        hide_index=True,
        width="stretch",
        column_config={
            "P(Lula) ref.": st.column_config.NumberColumn(format="%.3f"),
            "mín": st.column_config.NumberColumn(format="%.3f"),
            "máx": st.column_config.NumberColumn(format="%.3f"),
        },
    )
    res = data.get("resultado") or {}
    m = data.get("metricas_resultado") or {}
    if m:
        st.markdown(
            f"**Resultado:** ganador "
            f"**{(data.get('candidatos') or {}).get(res.get('ganador'), res.get('ganador'))}** "
            f"(Wikipedia y Polymarket concordantes: "
            f"{'sí' if res.get('concordancia_fuentes') else 'no'}). Brier medio: modelo "
            f"{m['brier_medio_modelo']:.3f} vs mercado {m['brier_medio_mercado']:.3f}."
        )
        st.caption(m["advertencia"])
    alerts = api_get("/api/elections/alerts", mode="backtest_retrospectivo", limit=500) or []
    if alerts:
        st.subheader("Alertas congeladas (ledger encadenado)")
        st.dataframe(
            pd.DataFrame(alerts)[
                [
                    "ledger_seq",
                    "as_of",
                    "label",
                    "price_basis",
                    "price",
                    "discrepancy_pp",
                    "conservative_edge_pp",
                    "signal",
                    "sha256",
                ]
            ],
            hide_index=True,
            width="stretch",
        )
    ev = api_get("/api/elections/evaluation")
    if ev:
        st.subheader("Evaluación sobre múltiples elecciones")
        agg = ev["agregado"]
        st.caption(agg["advertencia"])
        vrows = []
        for k in ("validacion_loo_ponderado", "validacion_loo_mediana"):
            v = ev[k]
            vrows.append(
                {
                    "modelo": v["method"],
                    "estado": v["status"],
                    "contiendas": v["n_contests"],
                    "Brier": v["brier"],
                    "cobertura 90 %": v["coverage90"],
                }
            )
        st.dataframe(pd.DataFrame(vrows), hide_index=True, width="stretch")
        mrows = []
        for r in ev["comparacion_mercado"]:
            met = r.get("metricas") or {}
            op = r.get("operacion_hipotetica") or {}
            mrows.append(
                {
                    "contienda": r["contest"],
                    "ganador": (r.get("candidatos") or {}).get(r.get("ganador_segun_mercado"), ""),
                    "abstención": r.get("abstencion", ""),
                    "Brier modelo": met.get("brier_modelo"),
                    "Brier mercado": met.get("brier_mercado"),
                    "operación hipotética": op.get("token", ""),
                    "P&L hipotético US$": op.get("pnl_hipotetico_usd"),
                }
            )
        st.dataframe(pd.DataFrame(mrows), hide_index=True, width="stretch")


REC_LABELS = {
    "señal_operable": "Señal operable (solo papel)",
    "alerta_investigacion": "Alerta de investigación",
    "sin_ventaja": "Sin ventaja",
    "informacion_insuficiente": "Información insuficiente",
    "abstencion": "Abstención",
}


VARIANT_LABELS = {
    "hourly_above": "Cripto: precio sobre un nivel (por hora)",
    "hourly_updown": "Cripto: sube o baja (por hora)",
    "daily_above": "Cripto: precio sobre un nivel (diario)",
    "daily_below": "Cripto: precio bajo un nivel (diario)",
    "daily_range": "Cripto: precio en un rango (diario)",
    "daily_updown": "Cripto: sube o baja (diario)",
    "touch_day": "Cripto: toca un nivel en el día",
    "touch_range": "Cripto: toca un nivel en la semana",
    "touch_month": "Cripto: toca un nivel en el mes",
    "touch_until": "Cripto: toca un nivel antes de una fecha",
    "touch_explicit": "Cripto: toca un nivel antes de una fecha",
    "nba_partido": "NBA: ganador del partido",
    "nfl_partido": "NFL: ganador del partido",
    "nhl_partido": "NHL: ganador del partido",
    "mlb_partido": "MLB: ganador del partido",
    "futbol_partido": "Fútbol: gana un equipo o empate",
    "fed_decision": "Fed: decisión de tasas",
}
CATEGORY_LABELS = {"crypto": "cripto", "sports": "deportes", "economy": "economía"}


def _money(x: float | None) -> str:
    return "—" if x is None else f"{'+' if x > 0 else ''}US${x:,.2f}"


def _verdict(row: dict[str, Any]) -> str:
    """Comparación con el mercado en palabras simples (forward-v1)."""
    lo, hi = row.get("vs_market_ll_lo"), row.get("vs_market_ll_hi")
    if lo is None or hi is None:
        return "faltan datos"
    if hi < 0:
        return "mejor que el mercado"
    if lo > 0:
        return "peor que el mercado"
    return "igual al mercado"


def page_summary() -> None:
    st.header("Resumen")
    live = (api_get("/api/predict/summary") or {}).get("live")
    paper = api_get("/api/paper") or {}
    fwd = api_get("/api/forward") or {}
    if live:
        crypto = (live.get("summary") or {}).get("crypto") or {}
        age = None
        if live.get("finished_at"):
            age = (datetime.now(UTC) - datetime.fromisoformat(live["finished_at"])).total_seconds()
        ext = (live.get("summary") or {}).get("externos") or {}
        n_ext = sum((ext.get("emparejados") or {}).values())
        msg = (
            f"Última revisión de precios {fmt_age(age)} · {crypto.get('interpretables', 0):,} "
            f"mercados cripto y {n_ext:,} de deportes y la Fed · se repite cada 30 min."
        )
        (st.warning if age is not None and age > 3600 else st.caption)(msg)
    else:
        st.info("Todavía no hay corridas en vivo.")
    signals = (api_get("/api/opportunities", recommendation="señal_operable") or {}).get(
        "items"
    ) or []

    c1, c2 = st.columns(2)
    c3, c4 = st.columns(2)
    c1.metric("Señales ahora", len(signals))
    c2.metric(
        "Posiciones abiertas",
        paper.get("abiertas", 0),
        help=f"Exposición {_money(paper.get('exposicion_usd'))} de un máximo de "
        f"US${paper.get('exposicion_maxima_usd', 300):,.0f}",
    )
    closed = paper.get("cerradas", 0)
    c3.metric(
        "Resultado de la cartera",
        _money(paper.get("resultado_usd", 0.0)),
        help=f"{paper.get('ganadas', 0)} ganadas, {paper.get('perdidas', 0)} perdidas y "
        f"{paper.get('empates', 0)} empates sobre {closed} cerradas.",
    )
    c4.metric("Capital simulado", f"US${paper.get('capital_actual_usd', 1000):,.2f}",
              help="Parte de US$1.000. Todo es papel: no hay dinero real.")  # fmt: skip

    st.subheader("Señales de ahora")
    if signals:
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Mercado": it["question"],
                        "Comprar": it["outcome"],
                        "Precio": it.get("ask_vwap"),
                        "Prob. del radar": it.get("p_model"),
                        "Ganancia esperada con US$25": it.get("ev_net_usd"),
                        "Cierra": fmt_ts(it.get("end_date")),
                        "Enlace": it.get("url"),
                    }
                    for it in signals
                ]
            ),
            hide_index=True,
            use_container_width=True,
            column_config={
                "Enlace": st.column_config.LinkColumn("Enlace", display_text="abrir"),
                "Precio": st.column_config.NumberColumn(format="%.3f"),
                "Prob. del radar": st.column_config.NumberColumn(format="%.3f"),
                "Ganancia esperada con US$25": st.column_config.NumberColumn(format="US$%.2f"),
            },
        )
    else:
        st.info(
            "Ahora no hay señales. El radar propone una solo cuando su modelo está validado, "
            "le gana al mercado y la diferencia cubre los costos."
        )

    st.subheader("Cartera de papel")
    items = paper.get("items") or []
    if not items:
        st.info("Todavía no hay posiciones: se abren solas con cada señal nueva.")
    else:
        df = pd.DataFrame(
            [
                {
                    "Abierta": fmt_ts(t["opened_at"]),
                    "Mercado": t["question"],
                    "Compra": t["outcome"],
                    "Precio": t["entry_price"],
                    "Costo": t["cost_usd"],
                    "Estado": t["status"],
                    "Resultado": t.get("pnl_usd"),
                    "Enlace": t.get("url"),
                }
                for t in items
            ]
        )
        st.dataframe(
            df,
            hide_index=True,
            use_container_width=True,
            column_config={
                "Enlace": st.column_config.LinkColumn("Enlace", display_text="abrir"),
                "Precio": st.column_config.NumberColumn(format="%.3f"),
                "Costo": st.column_config.NumberColumn(format="US$%.2f"),
                "Resultado": st.column_config.NumberColumn(format="US$%.2f"),
            },
        )
        st.caption(
            "Una compra simulada de US$25 por señal, al precio real del libro en ese momento. "
            "Se cierra sola con el resultado oficial."
        )

    st.subheader("¿Acierta el radar?")
    rows = [r for r in fwd.get("items") or [] if r.get("is_reference")]
    if not rows:
        st.info("Todavía no hay predicciones resueltas para medir.")
    else:
        days = {r["variant"]: r["n_clusters"] for r in rows}
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Tipo de mercado": VARIANT_LABELS.get(r["variant"], r["variant"]),
                        "Predicciones medidas": r["n"],
                        "Frente al mercado": _verdict(r),
                        "Estado": (
                            "validado en vivo"
                            if r["status"] == "validado"
                            else "en observación"
                            if r["n"] < 200 or r["n_clusters"] < 20
                            else "no validado"
                        ),
                    }
                    for r in sorted(rows, key=lambda r: -r["n"])
                ]
            ),
            hide_index=True,
            use_container_width=True,
        )
        st.caption(
            "Compara lo que el radar predijo en el momento con el resultado oficial y con el "
            "precio del mercado en ese mismo momento. Para validar hacen falta al menos 200 "
            f"predicciones y 20 días-activo (hoy el máximo es {max(days.values())}). Si un "
            "modelo resulta peor que el mercado, sus señales se suspenden solas."
        )

    st.subheader("Alertas para mirar")
    alerts = (
        api_get("/api/opportunities", recommendation="alerta_investigacion", limit=5) or {}
    ).get("items") or []
    if not alerts:
        st.caption("Sin alertas en la última revisión.")
    else:
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "Mercado": it["question"],
                        "Resultado": it["outcome"],
                        "Precio": it.get("ask_vwap"),
                        "Prob. del radar": it.get("p_model"),
                        "Por qué no es señal": (it.get("reasons") or ["—"])[0],
                        "Enlace": it.get("url"),
                    }
                    for it in alerts
                ]
            ),
            hide_index=True,
            use_container_width=True,
            column_config={
                "Enlace": st.column_config.LinkColumn("Enlace", display_text="abrir"),
                "Precio": st.column_config.NumberColumn(format="%.3f"),
                "Prob. del radar": st.column_config.NumberColumn(format="%.3f"),
            },
        )
        st.caption("Diferencias grandes con el mercado que no cumplen todo. No son compras.")


def page_opportunities() -> None:
    st.header("Señales y alertas")
    summ = (api_get("/api/predict/summary") or {}).get("live")
    if not summ:
        st.info(
            "Información insuficiente: no hay corridas de predicción en vivo "
            "(`radar predict live`)."
        )
        return
    s = summ.get("summary") or {}
    crypto = s.get("crypto") or {}
    tandas = crypto.get("tandas") or {}
    as_of = (
        f"as_of por tanda de {fmt_ts(tandas['primer_as_of'])} a {fmt_ts(tandas['ultimo_as_of'])}"
        if tandas.get("primer_as_of")
        else f"as_of {fmt_ts(s.get('as_of'))}"
    )
    st.caption(
        f"Corrida en vivo #{summ['run_id']} · {as_of} · parámetros "
        f"`{summ.get('params_version')}`. Precio ejecutable = VWAP del ask para US$25 en libros "
        "pedidos al CLOB justo antes de valorar cada tanda."
    )
    ext = s.get("externos") or {}
    recs: dict[str, int] = dict(crypto.get("recomendaciones") or {})
    for k, n in (ext.get("recomendaciones") or {}).items():
        recs[k] = recs.get(k, 0) + n
    c1, c2 = st.columns(2)
    c3, c4 = st.columns(2)
    c1.metric(
        "Mercados revisados",
        crypto.get("interpretables", 0) + sum((ext.get("emparejados") or {}).values()),
        help="Cripto con modelo propio; deportes y Fed comparados con Kalshi (en observación).",
    )
    c2.metric("Señales operables", recs.get("señal_operable", 0))
    c3.metric("Alertas de investigación", recs.get("alerta_investigacion", 0))
    c4.metric("Información insuficiente", recs.get("informacion_insuficiente", 0))
    if not recs.get("señal_operable"):
        st.warning(
            "Ninguna señal operable: una señal exige un modelo **validado** fuera de muestra "
            "para ese tipo de contrato, que además **supere al mercado**, con ventaja "
            "conservadora positiva tras costos y liquidez suficiente."
        )
    with st.expander("Cobertura por familia de mercados (abstenciones con motivo)"):
        fams = s.get("families") or {}
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "familia": f,
                        "mercados abiertos": v.get("mercados"),
                        "motivo de abstención": v.get("motivo", "modelado (ver abajo)"),
                    }
                    for f, v in sorted(fams.items(), key=lambda kv: -kv[1].get("mercados", 0))
                ]
            ),
            hide_index=True,
            use_container_width=True,
        )
        st.write("Contratos cripto no interpretables:", crypto.get("no_interpretables"))
    options = [
        "alerta_investigacion",
        "señal_operable",
        "sin_ventaja",
        "informacion_insuficiente",
        "todas",
    ]
    col_a, col_b = st.columns([2, 1])
    choice = col_a.selectbox(
        "Recomendación", options, format_func=lambda x: REC_LABELS.get(x, "Todas")
    )
    min_edge = col_b.number_input("Diferencia mínima (p.p.)", value=-100.0, step=1.0)
    params: dict[str, Any] = {"limit": 2000}
    if choice != "todas":
        params["recommendation"] = choice
    if min_edge > -100:
        params["min_edge_pp"] = min_edge
    data = api_get("/api/opportunities", **params) or {}
    items = data.get("items") or []
    if not items:
        st.info("Sin filas para este filtro.")
        return
    df = pd.DataFrame(
        [
            {
                "Mercado": it["question"],
                "Resultado": it["outcome"],
                "Categoría": VARIANT_LABELS.get(it.get("variant") or "", it.get("variant")),
                "Precio ejecutable": it.get("ask_vwap"),
                "Prob. estimada": it.get("p_model"),
                "Intervalo": (
                    f"{it['p_low']:.3f}–{it['p_high']:.3f}" if it.get("p_low") is not None else "—"
                ),
                "Diferencia (p.p.)": it.get("edge_pp"),
                "VE neto / acción": it.get("ev_net_per_share"),
                "VE conservador / acción": it.get("ev_conservative_per_share"),
                "Liquidez": f"{it.get('liquidity_risk') or '—'} · spread {it.get('spread')}",
                "Confianza del modelo": f"{it.get('model')} · {it.get('calibration_status')}"
                + (" · supera mercado" if it.get("supera_mercado") else ""),
                "Recomendación": REC_LABELS.get(it["recommendation"], it["recommendation"]),
                "Motivo principal": (it.get("reasons") or ["—"])[0],
                "Enlace": it.get("url"),
            }
            for it in items
        ]
    )
    st.dataframe(
        df,
        hide_index=True,
        use_container_width=True,
        column_config={
            "Enlace": st.column_config.LinkColumn("Enlace", display_text="abrir"),
            "Precio ejecutable": st.column_config.NumberColumn(format="%.3f"),
            "Prob. estimada": st.column_config.NumberColumn(format="%.3f"),
            "Diferencia (p.p.)": st.column_config.NumberColumn(format="%.1f"),
            "VE neto / acción": st.column_config.NumberColumn(format="%.3f"),
            "VE conservador / acción": st.column_config.NumberColumn(format="%.3f"),
        },
    )
    st.caption(
        "VE = valor esperado por acción comprada: probabilidad − precio ejecutable − comisión "
        "del mercado − holgura de 0,005. Conservador = con la cota desfavorable del intervalo."
    )


def _calibration_chart(rows: list[dict[str, Any]]) -> alt.Chart | None:
    pts = []
    for r in rows:
        for b in r.get("bins") or []:
            if b.get("n") and b.get("mean_p") is not None and b["mean_p"] == b["mean_p"]:
                pts.append(
                    {
                        "modelo": r["model"],
                        "prob": b["mean_p"],
                        "frecuencia": b["mean_y"],
                        "n": b["n"],
                    }
                )
    if not pts:
        return None
    df = pd.DataFrame(pts)
    models = sorted(df["modelo"].unique())
    palette = [SERIES_1, SERIES_2, SERIES_3, "#8a5cd1", "#7a7a7a"]
    color = alt.Color(
        "modelo:N",
        scale=alt.Scale(domain=models, range=palette[: len(models)]),
        legend=alt.Legend(title=None, orient="top"),
    )
    diag = (
        alt.Chart(pd.DataFrame({"x": [0, 1], "y": [0, 1]}))
        .mark_line(strokeDash=[4, 4], color="#999999")
        .encode(x="x:Q", y="y:Q")
    )
    base = alt.Chart(df).encode(
        x=alt.X(
            "prob:Q",
            title="Probabilidad predicha (promedio del tramo)",
            scale=alt.Scale(domain=[0, 1]),
        ),
        y=alt.Y("frecuencia:Q", title="Frecuencia observada", scale=alt.Scale(domain=[0, 1])),
        color=color,
        tooltip=[
            "modelo:N",
            alt.Tooltip("prob:Q", format=".3f"),
            alt.Tooltip("frecuencia:Q", format=".3f"),
            "n:Q",
        ],
    )
    return (diag + base.mark_line(strokeWidth=2) + base.mark_circle(size=60)).properties(height=360)


def page_quality() -> None:
    st.header("Calidad predictiva")
    data = api_get("/api/predict/quality") or {}
    run = data.get("run")
    items = data.get("items") or []
    if not run or not items:
        st.info("Información insuficiente: no hay backtest de modelos (`radar predict backtest`).")
        return
    summ = run.get("summary") or {}
    st.caption(
        f"Backtest #{run['run_id']} · {fmt_ts(run.get('finished_at'))} · métricas **fuera de "
        "muestra** (partición de prueba). IC del 95 % por bootstrap de conglomerados "
        "(activo × día). Precio de mercado = referencia no ejecutable."
    )
    validated = summ.get("validados") or []
    beats = summ.get("superan_mercado") or []
    c1, c2, c3 = st.columns(3)
    c1.metric("Pares validados", len(validated))
    c2.metric("Pares que superan al mercado", len(beats))
    hyp = summ.get("operaciones_hipoteticas") or {}
    c3.metric("Resultado hipotético (US$)", f"{hyp.get('resultado_usd', 0):+.2f}",
              help=hyp.get("etiqueta"))  # fmt: skip
    st.caption(f"Operaciones hipotéticas: {hyp.get('n', 0)} · {hyp.get('etiqueta', '')}")
    df = pd.DataFrame(items)
    variants = sorted(df["variant"].unique())
    v = st.selectbox("Tipo de contrato", variants)
    sub = df[df["variant"] == v]
    table = sub[[
        "model", "n", "n_clusters", "brier", "brier_lo", "brier_hi", "log_loss", "ece",
        "calib_in_large", "vs_market_ll_diff", "vs_market_ll_lo", "vs_market_ll_hi",
        "supera_mercado", "is_reference", "status",
    ]].rename(columns={
        "model": "modelo", "n_clusters": "conglomerados",
        "brier_lo": "Brier IC−", "brier_hi": "Brier IC+",
        "log_loss": "log loss", "calib_in_large": "calibración global",
        "vs_market_ll_diff": "Δ log loss vs mercado",
        "vs_market_ll_lo": "Δ IC−", "vs_market_ll_hi": "Δ IC+",
        "supera_mercado": "supera mercado", "is_reference": "referencia", "status": "estado",
    })  # fmt: skip
    st.dataframe(table, hide_index=True, use_container_width=True)
    chart = _calibration_chart(sub.to_dict("records"))
    if chart is not None:
        st.subheader("Curva de calibración (prueba)")
        st.altair_chart(chart, use_container_width=True)
        st.caption(
            "Un modelo calibrado sigue la diagonal: lo que predice con 30 % ocurre "
            "~30 % de las veces."
        )
    fails = sub[sub["failures"].map(bool)][["model", "failures"]]
    if len(fails):
        with st.expander("Motivos de no validación"):
            for _, r in fails.iterrows():
                st.write(f"**{r['model']}**: " + "; ".join(r["failures"]))
    st.subheader("Desempeño por modelo (todas las variantes de prueba)")
    agg = (
        df.assign(w=df["n"])
        .groupby("model")
        .apply(lambda g: pd.Series({
            "instancias": int(g["n"].sum()),
            "Brier ponderado": float((g["brier"] * g["n"]).sum() / g["n"].sum()),
            "log loss ponderado": float((g["log_loss"] * g["n"]).sum() / g["n"].sum()),
            "variantes validadas": int((g["status"] == "validado").sum()),
        }), include_groups=False)
        .reset_index()
    )  # fmt: skip
    st.dataframe(agg, hide_index=True, use_container_width=True)
    with st.expander("Errores y abstenciones del backtest"):
        st.write(summ.get("abstenciones") or "—")
        st.write("Excluidas:", summ.get("excluidas") or "—")
        st.write(
            "Contraste del resultado oficial con Binance:", summ.get("contraste_resolucion") or "—"
        )


MAIN_PAGES = ["Resumen", "Señales y alertas"]
TECH_PAGES = ["Radar", "Mercados", "Detalle", "Ingesta", "Electoral", "Calidad predictiva"]


def password_ok() -> bool:
    """Con RADAR_DASHBOARD_PASSWORD definida (dashboard en internet), pide la contraseña."""
    expected = os.environ.get("RADAR_DASHBOARD_PASSWORD")
    if not expected or st.session_state.get("auth_ok"):
        return True
    st.title("Polymarket AI Radar")
    typed = st.text_input("Contraseña", type="password")
    if typed:
        if hmac.compare_digest(typed.encode(), expected.encode()):
            st.session_state["auth_ok"] = True
            st.rerun()
        st.error("Contraseña incorrecta.")
    return False


def main() -> None:
    if not password_ok():
        return
    st.sidebar.title("Polymarket AI Radar")
    tech = st.sidebar.toggle("Pantallas técnicas", value=False)
    page = st.sidebar.radio("Pantalla", MAIN_PAGES + (TECH_PAGES if tech else []))
    st.sidebar.caption("Solo simulación: no opera con dinero real.")
    if tech:
        st.sidebar.caption(f"Backend: {API}")
        health = api_get("/api/health")
        if health:
            st.sidebar.caption(
                f"API {health['version']} · base: {health['database']} · trading: "
                f"{health['trading_mode']}"
            )
    if page == "Resumen":
        page_summary()
    elif page == "Señales y alertas":
        page_opportunities()
    else:
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
        elif page == "Electoral":
            page_elections()
        else:
            page_quality()


main()
