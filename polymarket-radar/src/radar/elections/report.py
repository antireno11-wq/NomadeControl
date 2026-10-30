"""Reportes Markdown del motor electoral (generados solo desde los resultados)."""

from __future__ import annotations

from typing import Any

from radar.elections.market_history import PRICE_BASIS_REFERENCE, PRICE_BASIS_TRADES


def _pct(x: float | None, d: int = 1) -> str:
    return "—" if x is None else f"{x * 100:.{d}f} %"


def _num(x: float | None, d: int = 3) -> str:
    return "—" if x is None else f"{x:.{d}f}"


def _find(decisions: list[dict[str, Any]], label: str, basis: str) -> dict[str, Any] | None:
    for d in decisions:
        if d["quote"]["label"] == label and d["quote"]["basis"] == basis:
            return d
    return None


def backtest_markdown(r: dict[str, Any]) -> str:
    tl = r["timeline"]
    val = r["validacion"]
    first = r.get("primera_alerta")
    signals = [p for p in tl if p.get("senal_operable")]
    a_name = "Lula"
    lines: list[str] = []
    w = lines.append
    w(f"# Backtest retrospectivo — {r['contest']}")
    w("")
    w(f"- Generado: `{r['creado']}` (UTC), **después** de conocerse el resultado.")
    w(f"- Modo: `{r['modo']}`. Modelo: `{r['model_version']}`.")
    w(f"- Cierre de urnas: `{r['cierre_urnas_utc']}`. Instantes evaluados: {len(tl)}.")
    w(
        "- Información usada en cada instante T: la revisión de Wikipedia vigente en T, el "
        "precio de referencia de Polymarket anterior a T y las operaciones reales de la hora previa."
    )
    w("")
    w("## Respuesta directa")
    w("")
    w(
        f"**¿Habría generado una señal operable antes del resultado?** "
        f"{'Sí' if signals else '**No**'}."
    )
    if not signals:
        import re as _re

        reasons: dict[str, list[float]] = {}
        for p in tl:
            for d in p.get("decisiones") or []:
                for g in d["gating"]:
                    key = _re.sub(r"-?\d+(\.\d+)?(e-?\d+)?", "X", g.split(":")[0])
                    nums = [
                        float(x) for x in _re.findall(r"-?\d+\.?\d*(?:e-?\d+)?", g.split(":")[0])
                    ]
                    reasons.setdefault(key, []).extend(nums[:1] or [float("nan")])
        w("")
        w("Motivos de bloqueo (cotizaciones evaluadas en las que aparece cada motivo):")
        w("")
        for k, vals in sorted(reasons.items(), key=lambda kv: -len(kv[1])):
            finite = [v for v in vals if v == v]
            rng = f" (X entre {min(finite):.1f} y {max(finite):.1f})" if finite and "X" in k else ""
            w(f"- {k}: {len(vals)}{rng}")
    w("")
    if first:
        d = first["decision"]
        q = d["quote"]
        w(
            "**Primera alerta de investigación** (discrepancia bruta ≥ "
            f"{first['umbral_pp']:.0f} p.p.):"
        )
        w("")
        w(f"- Hora (as_of): `{first['as_of']}`")
        w(
            f"- Token: **{q['label']}**; precio usado: {_num(q['price'])} "
            f"(base: `{q['basis']}`, observado `{q['observed_at']}`)"
        )
        w(
            f"- Probabilidad de referencia del token: {_pct(d['reference_prob'])}; "
            f"discrepancia bruta: {d['discrepancy_pp']:+.1f} p.p.; "
            f"ventaja conservadora tras costos: {d['conservative_edge_pp']:+.1f} p.p."
        )
        rev = first["revision_wikipedia"]
        w(
            f"- Encuestas: revisión Wikipedia `{rev['revid']}` del `{rev['revision_ts']}` "
            f"(SHA-256 `{rev['sha256'][:16]}…`)"
        )
        ev = first.get("evidencia_operaciones") or {}
        if ev:
            w(
                f"- Operaciones reales de compra en la hora previa: {ev.get('compras')} compras, "
                f"{_num(ev.get('acciones'), 0)} acciones, precio {_num(ev.get('precio_min'))}–"
                f"{_num(ev.get('precio_max'))}"
            )
        w("- Estimaciones registradas en ese instante:")
        for e in first["estimaciones"]:
            if e["status"] == "ok":
                w(
                    f"  - `{e['name']}`: P({a_name}) = {_pct(e['prob_a'])} "
                    f"[{_pct(e['prob_a_low'])}–{_pct(e['prob_a_high'])}], voto bipartidista "
                    f"{_pct(e['vote_share_a'], 2)}"
                )
            else:
                w(f"  - `{e['name']}`: abstención ({e['abstain_reason']})")
        w("- Esta alerta se generó retrospectivamente: **no** es evidencia previa al resultado.")
    else:
        w(
            "**No hubo ninguna alerta de investigación** (discrepancia ≥ umbral) en los instantes "
            "evaluados."
        )
    w("")
    w("## Validación del modelo (criterios fijados de antemano)")
    w("")
    w(f"- Estado: **{val['status']}** ({val['n_contests']} contiendas fuera de muestra).")
    w(
        f"- Brier LOO: {_num(val['brier'])}; log loss: {_num(val['log_loss'])}; "
        f"cobertura 50 %: {_num(val['coverage50'], 2)}; cobertura 90 %: {_num(val['coverage90'], 2)}."
    )
    for reason in val["reasons"]:
        w(f"- {reason}")
    cal = r["calibracion"]["weighted"]
    w(
        f"- Error del promedio ponderado: σ0 = {cal['sigma0_pp']} p.p., "
        f"k = {cal['k_pp2_por_dia']} p.p.²/día; contiendas: {', '.join(cal['contiendas'])}."
    )
    w("")
    w("## Línea de tiempo (token " + a_name + " YES)")
    w("")
    w(
        "| T (UTC) | Rev. Wikipedia | Encuestas | Última encuesta | P(Lula) ref. [mín–máx] | "
        "Precio ref. (no ejec.) | Máx. compra real 60 min | Discrep. vs ref. | Alerta | Señal |"
    )
    w("|---|---|---:|---|---|---:|---:|---:|---|---|")
    for p in tl:
        if "consenso" not in p:
            w(f"| {p['t'][:16]} | — | — | — | {p.get('estado', '')} | | | | | |")
            continue
        c = p["consenso"]
        dref = _find(p["decisiones"], f"{a_name} YES", PRICE_BASIS_REFERENCE)
        dtr = _find(p["decisiones"], f"{a_name} YES", PRICE_BASIS_TRADES)
        rng = (
            f"[{_pct(c['min_prob_a'])}–{_pct(c['max_prob_a'])}]"
            if c["min_prob_a"] is not None
            else ""
        )
        w(
            f"| {p['t'][:16]} | {p['revision']['revision_ts'][:16]} | {p['encuestas_en_revision']} | "
            f"{p['encuesta_mas_reciente']} | {_pct(c['reference_prob_a'])} {rng} | "
            f"{_num(dref['quote']['price']) if dref else '—'} | "
            f"{_num(dtr['quote']['price']) if dtr else '—'} | "
            f"{(f'{dref["discrepancy_pp"]:+.1f}' if dref and dref['discrepancy_pp'] is not None else '—')} | "
            f"{'sí' if p['alerta'] else 'no'} | {'sí' if p['senal_operable'] else 'no'} |"
        )
    w("")
    res = r.get("resultado") or {}
    w("## Resultado y evaluación")
    w("")
    wk = res.get("wikipedia") or {}
    w(
        f"- Wikipedia (revisión `{wk.get('revid')}` del `{wk.get('revision_ts')}`): "
        f"A = {wk.get('a')} %, B = {wk.get('b')} % ({wk.get('base')})."
    )
    pm = res.get("polymarket") or {}
    w(
        f"- Polymarket (`{pm.get('slug')}`): ganador según precios = `{pm.get('ganador')}` "
        f"({pm.get('nota')})."
    )
    names = r.get("candidatos") or {}
    w(f"- Ganador: **{names.get(res.get('ganador'), res.get('ganador'))}**.")
    w(f"- Fuentes concordantes: {'sí' if res.get('concordancia_fuentes') else 'no'}.")
    m = r.get("metricas_resultado")
    if m:
        w(
            f"- Brier medio sobre {m['n_instantes']} instantes: modelo {_num(m['brier_medio_modelo'])} "
            f"vs mercado {_num(m['brier_medio_mercado'])}; log loss: modelo "
            f"{_num(m['logloss_medio_modelo'])} vs mercado {_num(m['logloss_medio_mercado'])}."
        )
        w(f"- **{m['advertencia']}**")
    w("")
    w("## Fuentes y verificabilidad")
    w("")
    led = r.get("ledger") or {}
    w(
        f"- Alertas retrospectivas congeladas en `{led.get('ruta')}`: {led.get('alertas')} "
        f"registros, cadena SHA-256 íntegra: {'sí' if led.get('cadena_integra') else 'no'}."
    )
    revs = sorted(
        {(p["revision"]["revid"], p["revision"]["revision_ts"]) for p in tl if "revision" in p}
    )
    w(
        f"- Revisiones de Wikipedia usadas: {len(revs)} (manifiesto en "
        "`data/manifests/br-2026-presidente-2t.json`)."
    )
    w(
        f"- Consultas a Polymarket registradas: {len(r.get('fuentes_mercado') or [])} "
        "(URL, hora de recepción y SHA-256 en el JSON del backtest)."
    )
    w("")
    w("## Limitaciones")
    w("")
    w(
        "- Polymarket no publica libros de órdenes históricos: no existe el ask ejecutable del "
        "pasado. El precio de referencia no es ejecutable; las compras reales prueban que se "
        "pagó ese precio por ese tamaño, no que hubiera más profundidad."
    )
    w(
        "- La disponibilidad de una encuesta se acota por la revisión de Wikipedia que la contiene; "
        "pudo publicarse antes en otro medio (el sistema puede llegar tarde, no adelantarse)."
    )
    w(
        "- El modelo trata la contienda como de dos candidatos (P(B) = 1 − P(A)) e ignora la "
        "regla de 'Other' si no hay resultado antes de junio de 2027."
    )
    w("- Una sola elección no permite evaluar calibración ni rentabilidad.")
    w("")
    return "\n".join(lines)


def evaluation_markdown(o: dict[str, Any]) -> str:
    lines: list[str] = []
    w = lines.append
    agg = o["agregado"]
    w("# Evaluación sobre múltiples elecciones")
    w("")
    w(f"- Generado: `{o['creado']}` (UTC). Todo es retrospectivo.")
    w(f"- **{agg['advertencia']}**")
    w("")
    w("## 1. Calibración solo con encuestas (dejar una contienda fuera)")
    w("")
    for key in ("validacion_loo_ponderado", "validacion_loo_mediana"):
        v = o[key]
        w(
            f"- `{v['method']}`: estado **{v['status']}**, {v['n_contests']} contiendas, "
            f"Brier {_num(v['brier'])}, log loss {_num(v['log_loss'])}, cobertura 50 % "
            f"{_num(v['coverage50'], 2)}, cobertura 90 % {_num(v['coverage90'], 2)}."
        )
        for reason in v["reasons"]:
            w(f"  - {reason}")
    w("")
    w("| Contienda | Horizonte (días) | Promedio A | Resultado A | P(A) | ¿Ganó A? |")
    w("|---|---:|---:|---:|---:|---|")
    for f in o["validacion_loo_ponderado"]["forecasts"]:
        w(
            f"| {f['contest']} | {f['horizon_days']} | {_pct(f['avg'], 2)} | {_pct(f['result'], 2)} | "
            f"{_pct(f['prob_a'])} | {'sí' if f['outcome_a'] else 'no'} |"
        )
    w("")
    w("Contiendas de calibración y problemas de datos:")
    w("")
    for prov in o["calibracion"]["fuentes"]:
        res = prov.get("resultado") or {}
        w(
            f"- `{prov['contest']}`: revisión `{prov['revid']}` ({prov['revision_ts'][:10]}), "
            f"{prov.get('encuestas_en_ventana', prov.get('encuestas_parseadas'))} encuestas, "
            f"resultado A {res.get('a')} / B {res.get('b')} ({res.get('base')})"
        )
    for issue in o["calibracion"]["problemas"]:
        w(f"- ⚠ {issue}")
    w("")
    w("## 2. Comparación con el mercado (walk-forward)")
    w("")
    w(f"Reglas: {agg['reglas']}")
    w("")
    w(
        "| Contienda | Calibrado con | Ganador (mercado) | Brier modelo | Brier mercado | "
        "Alertas | Operación hipotética | P&L hipotético US$ |"
    )
    w("|---|---:|---|---:|---:|---:|---|---:|")
    for r in o["comparacion_mercado"]:
        if "abstencion" in r:
            w(f"| {r['contest']} | — | — | — | — | — | abstención: {r['abstencion']} | — |")
            continue
        m = r.get("metricas") or {}
        op = r.get("operacion_hipotetica")
        n_alerts = sum(len(p["alertas"]) for p in r["puntos"])
        w(
            f"| {r['contest']} | {len(r['calibrado_con'])} | "
            f"{(r.get('candidatos') or {}).get(r['ganador_segun_mercado'], r['ganador_segun_mercado'])} | "
            f"{_num(m.get('brier_modelo'))} | {_num(m.get('brier_mercado'))} | {n_alerts} | "
            f"{(op['token'] + ' @ ' + _num(op['costo_por_accion'])) if op else '—'} | "
            f"{_num(op.get('pnl_hipotetico_usd'), 2) if op else '—'} |"
        )
    w("")
    w(
        f"- Contiendas evaluadas: {agg['contiendas_evaluadas']} de {agg['contiendas']}; con alerta: "
        f"{agg['contiendas_con_alerta']}; señales operables: {agg['senales_operables']}."
    )
    w(
        f"- Operaciones hipotéticas: {agg['operaciones_hipoteticas']}; P&L hipotético total: "
        f"{_num(agg['pnl_hipotetico_total_usd'], 2)} US$ sobre {agg['capital_hipotetico_usd']} US$ "
        "comprometidos. **No son ganancias realizadas.**"
    )
    w(
        f"- Brier medio: modelo {_num(agg['brier_medio_modelo'])} vs mercado "
        f"{_num(agg['brier_medio_mercado'])}."
    )
    w("")
    return "\n".join(lines)
