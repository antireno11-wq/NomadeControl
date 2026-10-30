"""Reportes en Markdown de los modelos predictivos."""

from __future__ import annotations

from typing import Any

VARIANT_NAMES = {
    "daily_above": "Diario: cierre 12:00 ET sobre un nivel",
    "daily_below": "Diario: cierre 12:00 ET bajo un nivel",
    "daily_range": "Diario: cierre 12:00 ET en un rango",
    "hourly_above": "Horario: cierre de vela 1 h sobre un nivel",
    "hourly_updown": "Horario: Up/Down de vela 1 h",
    "daily_updown": "Diario: Up/Down mediodía a mediodía",
    "touch_day": "Toque en el día",
    "touch_range": "Toque en la semana",
    "touch_month": "Toque en el mes",
    "touch_until": "Toque hasta una fecha",
    "touch_explicit": "Toque en ventana explícita",
}


def _f(x: Any, nd: int = 4) -> str:
    if x is None:
        return "—"
    try:
        if x != x:  # NaN
            return "—"
        return f"{x:.{nd}f}"
    except (TypeError, ValueError):
        return str(x)


def _ci(d: dict[str, float] | None, nd: int = 4) -> str:
    if not d:
        return "—"
    return f"{_f(d['value'], nd)} [{_f(d['lo'], nd)}; {_f(d['hi'], nd)}]"


def crypto_backtest_markdown(r: dict[str, Any]) -> str:
    L: list[str] = []
    ds = r.get("dataset") or {}
    sp = r["splits"]
    L.append("# Backtest de modelos cripto (`crypto-backtest-v1`)\n")
    L.append(
        f"Generado {r['finished_at']}. Datos reales: mercados resueltos de Polymarket "
        f"(`{ds.get('version')}`, SHA-256 `{(ds.get('sha256') or '')[:16]}…`), velas de 1 minuto "
        "de Binance spot (archivos con checksum oficial) e índice DVOL de Deribit. "
        "Ningún resultado se usó para elegir mercados ni momentos de predicción.\n"
    )
    pre = r.get("preregistro")
    if pre:
        L.append(
            f"Reglas fijadas antes de correr: [`{pre['path']}`](../{pre['path']}) (SHA-256 `{pre['sha256']}`).\n"
        )
    st = r["test"]["status"]
    validated = sorted(k for k, v in st.items() if v == "validado")
    beats = []
    for v, res in r["test"]["by_variant"].items():
        for m, s in res["models"].items():
            if s.get("supera_mercado"):
                beats.append(f"cripto-{m}|{v}")
    h = r["hypothetical"]
    L.append("## Respuesta directa\n")
    L.append(
        f"- Pares (modelo, variante) **validados** en prueba: {len(validated)} de {len(st)}"
        + (f": {', '.join(validated)}." if validated else ".")
    )
    L.append(
        f"- Pares que **superan al mercado** (log loss menor con IC < 0): {len(beats)}"
        + (f": {', '.join(sorted(beats))}." if beats else ".")
    )
    L.append(
        f"- Operaciones **hipotéticas** en prueba: {h['n_trades']}, resultado "
        f"{_f(h['total_pnl'], 2)} US$ sobre {_f(h['staked'], 0)} US$ apostados. "
        f"{h['label']}."
    )
    L.append(
        "- Una señal operable en vivo exige además precio ask ejecutable, liquidez y que el "
        "par esté validado **y** supere al mercado.\n"
    )

    L.append("## Datos\n")
    stats = ds.get("stats") or {}
    L.append(f"- Mercados en el conjunto: {ds.get('markets')} (sin historia de precios: "
             f"{ds.get('markets_without_prices')}).")  # fmt: skip
    L.append(f"- Por variante: {stats.get('markets')}")
    L.append(f"- Contratos no interpretables (excluidos con motivo): {stats.get('unsupported')}")
    L.append(f"- Instancias (mercado × momento): {r['instances']}; con precio de mercado: "
             f"{r['instances_with_market_price']}.")  # fmt: skip
    L.append(f"- Excluidas: {r['build']['skipped']}")
    L.append(f"- Evidencia: {r.get('evidence')}\n")

    L.append("### Contraste del resultado oficial con Binance\n")
    L.append("| Variante | Coincide | Difiere | Sin datos |")
    L.append("|---|---:|---:|---:|")
    for k, v in r["build"]["resolution_check"].items():
        L.append(
            f"| {k} | {v.get('coincide', 0)} | {v.get('difiere', 0)} | {v.get('sin_datos', 0)} |"
        )
    L.append(
        "\n`|vela_siguiente` = lectura alternativa (vela que abre a la hora indicada, en vez de "
        "la que cierra). Sirve para comprobar qué lectura de las reglas coincide con Polymarket.\n"
    )

    L.append("## Partición temporal\n")
    L.append(f"- Entrenamiento: {sp['train']}")
    L.append(f"- Validación: {sp['valid']}")
    L.append(f"- Prueba: {sp['test']}")
    L.append(f"- Instancias: {sp['counts']}; mercados: {sp['markets_by_split']}; "
             f"conglomerados (activo × día): {sp['clusters_by_split']}\n")  # fmt: skip

    p = r["params"]
    L.append("## Parámetros ajustados en entrenamiento\n")
    L.append(f"- Ventana de volatilidad realizada (min) por tramo: {p['rv_lookback_min']}")
    L.append(f"- Vida media EWMA (min) por tramo: {p['ewma_halflife_min']}")
    L.append(f"- Cuantiles 10/90 del cociente de volatilidad (intervalos): {p['vol_ratio_q']}\n")

    L.append("## Modelo de referencia elegido en validación\n")
    L.append("| Variante | Referencia | log loss por modelo |")
    L.append("|---|---|---|")
    for v, x in r["reference_by_variant"].items():
        sc = ", ".join(f"{m} {_f(s['log_loss'])}" for m, s in x["scores"].items())
        L.append(f"| {v} | {x['reference'] or '—'} | {sc} |")
    L.append("")

    L.append("## Prueba (fuera de muestra)\n")
    L.append(f"Criterios preregistrados: {r['test']['criteria']}\n")
    for v, res in r["test"]["by_variant"].items():
        L.append(f"### {VARIANT_NAMES.get(v, v)} (`{v}`), {res['n_instances']} instancias\n")
        L.append("| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | "
                 "vs mercado (Δ log loss [IC95]) | Estado |")  # fmt: skip
        L.append("|---|---:|---|---|---:|---|---|---|")
        mk = res.get("market")
        if mk and mk.get("n"):
            L.append(
                f"| Mercado (precio ref.) | {mk['n']} | {_ci(mk['brier'])} | {_ci(mk['log_loss'])}"
                f" | {_f(mk['ece']['value'], 3)} | {_f(mk['calib_in_large']['value'], 3)} | — | — |"
            )
        for m, s in res["models"].items():
            vm = (s.get("vs_market") or {}).get("log_loss_diff")
            L.append(
                f"| {m} | {s['n']} | {_ci(s['brier'])} | {_ci(s['log_loss'])} | "
                f"{_f(s['ece']['value'], 3)} | {_f(s['calib_in_large']['value'], 3)} | "
                f"{_ci(vm)} | {s['status']} |"
            )
        fails = {
            m: s["validation_failures"]
            for m, s in res["models"].items()
            if s["validation_failures"]
        }
        if fails:
            L.append(
                "\nMotivos de no validación: "
                + "; ".join(f"{m}: {', '.join(f)}" for m, f in fails.items())
            )
        L.append("")

    L.append("## Modelo de referencia frente al mercado por horizonte (prueba)\n")
    L.append(
        "| Horizonte | n | Brier modelo | Brier mercado | log loss modelo | log loss mercado |"
    )
    L.append("|---|---:|---:|---:|---:|---:|")
    for b, x in r["test_by_bucket"].items():
        L.append(f"| {b} | {x['n']} | {_f(x['brier_model'])} | {_f(x['brier_market'])} | "
                 f"{_f(x['log_loss_model'])} | {_f(x['log_loss_market'])} |")  # fmt: skip
    L.append("")

    L.append("## Operaciones hipotéticas (prueba)\n")
    L.append(f"**{h['label']}.** Reglas: {h['rules']}.\n")
    L.append(f"- Operaciones: {h['n_trades']}; aciertos: {_f(h['hit_rate'], 3)}; "
             f"resultado total: {_f(h['total_pnl'], 2)} US$; caída máxima: "
             f"{_f(h['max_drawdown'], 2)} US$.")  # fmt: skip
    L.append(
        f"- Resultado medio por operación [IC95 por conglomerados]: {_ci(h['mean_pnl_ci'], 2)}"
    )
    L.append(f"- Por variante: {h['by_variant']}\n")

    L.append("## Abstenciones\n")
    for k, v in r["abstentions"].items():
        L.append(f"- {v} × {k}")
    L.append("")
    L.append("## Limitaciones\n")
    L.append(
        "- Polymarket no publica libros históricos: el precio del mercado es una referencia no "
        "ejecutable y las operaciones son hipotéticas."
    )
    L.append(
        "- Mercados del mismo día y activo comparten la trayectoria del precio: los IC se "
        "calculan por conglomerados (activo × día), y aun así el período de prueba cubre pocas "
        "semanas de un solo régimen de mercado."
    )
    L.append(
        "- Los contratos horarios se muestrean (una hora por día, rotando); los de 5 y 15 "
        "minutos (Chainlink) quedan fuera por falta de historial verificable."
    )
    L.append(
        "- El modelo supone precio sin deriva: no intenta predecir dirección, solo dispersión."
    )
    return "\n".join(L) + "\n"
