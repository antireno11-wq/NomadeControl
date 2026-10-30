# Backtest retrospectivo — br-2026-presidente-2t

- Generado: `2026-10-26T03:15:54.178977+00:00` (UTC), **después** de conocerse el resultado.
- Modo: `backtest_retrospectivo`. Modelo: `electoral-2t-v1`.
- Cierre de urnas: `2026-10-25T20:00:00+00:00`. Instantes evaluados: 46.
- Información usada en cada instante T: la revisión de Wikipedia vigente en T, el precio de referencia de Polymarket anterior a T y las operaciones reales de la hora previa.

## Respuesta directa

**¿Habría generado una señal operable antes del resultado?** **No**.

Motivos de bloqueo (cotizaciones evaluadas en las que aparece cada motivo):

- modelo no validado: 343
- ventaja conservadora X p.p. no positiva tras costos: 304 (X entre -62.7 y -0.0)
- precio no ejecutable (precio_referencia_no_ejecutable): 184
- precio no ejecutable (precio_ejecutado_observado): 159

**Primera alerta de investigación** (discrepancia bruta ≥ 5 p.p.):

- Hora (as_of): `2026-10-05T12:00:00+00:00`
- Token: **Lula YES**; precio usado: 0.165 (base: `precio_referencia_no_ejecutable`, observado `2026-10-05T11:00:39+00:00`)
- Probabilidad de referencia del token: 46.0 %; discrepancia bruta: +29.5 p.p.; ventaja conservadora tras costos: +10.8 p.p.
- Encuestas: revisión Wikipedia `1378586366` del `2026-10-05T02:58:29+00:00` (SHA-256 `8d92b24a5e4d53f4…`)
- Operaciones reales de compra en la hora previa: 15 compras, 1898 acciones, precio 0.160–0.170
- Estimaciones registradas en ese instante:
  - `interno:ponderado+t`: P(Lula) = 44.8 % [34.0 %–56.0 %], voto bipartidista 49.59 %
  - `interno:ponderado+empirico`: P(Lula) = 44.4 % [27.8 %–66.7 %], voto bipartidista 49.59 %
  - `interno:mediana+t`: P(Lula) = 49.9 % [38.0 %–62.0 %], voto bipartidista 50.05 %
  - `agregador:UOL`: P(Lula) = 52.7 % [42.0 %–64.0 %], voto bipartidista 50.22 %
  - `agregador:BBC/PollingData`: P(Lula) = 44.1 % [32.0 %–56.0 %], voto bipartidista 49.56 %
  - `agregador:Plano Político`: P(Lula) = 47.2 % [34.0 %–60.0 %], voto bipartidista 49.78 %
  - `agregador:ABC Dados`: P(Lula) = 57.5 % [46.0 %–68.0 %], voto bipartidista 50.55 %
  - `agregador:The Economist`: P(Lula) = 42.4 % [32.0 %–54.0 %], voto bipartidista 49.44 %
- Esta alerta se generó retrospectivamente: **no** es evidencia previa al resultado.

## Validación del modelo (criterios fijados de antemano)

- Estado: **no_validado** (9 contiendas fuera de muestra).
- Brier LOO: 0.158; log loss: 0.477; cobertura 50 %: 0.44; cobertura 90 %: 0.85.
- solo 9 contiendas fuera de muestra (mínimo 15)
- Error del promedio ponderado: σ0 = 2.748 p.p., k = 0.431 p.p.²/día; contiendas: br-2010-presidente-2t, br-2018-presidente-2t, br-2022-presidente-2t, co-2022-presidente-2t, fr-2017-presidente-2t, fr-2022-presidente-2t, pe-2021-presidente-2t, pl-2025-presidente-2t, ro-2025-presidente-2t.

## Línea de tiempo (token Lula YES)

| T (UTC) | Rev. Wikipedia | Encuestas | Última encuesta | P(Lula) ref. [mín–máx] | Precio ref. (no ejec.) | Máx. compra real 60 min | Discrep. vs ref. | Alerta | Señal |
|---|---|---:|---|---|---:|---:|---:|---|---|
| 2026-10-05T12:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 46.0 % [42.4 %–57.5 %] | 0.165 | 0.170 | +29.5 | sí | no |
| 2026-10-06T00:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 46.0 % [42.4 %–57.5 %] | 0.165 | 0.170 | +29.5 | sí | no |
| 2026-10-06T12:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 46.0 % [42.3 %–57.5 %] | 0.165 | 0.170 | +29.5 | sí | no |
| 2026-10-07T00:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 46.0 % [42.3 %–57.6 %] | 0.145 | 0.160 | +31.5 | sí | no |
| 2026-10-07T12:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 45.9 % [42.3 %–57.7 %] | 0.145 | 0.150 | +31.4 | sí | no |
| 2026-10-08T00:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 45.9 % [42.2 %–57.7 %] | 0.155 | 0.160 | +30.4 | sí | no |
| 2026-10-08T12:00 | 2026-10-05T02:58 | 142 | 2026-10-03 | 48.5 % [42.2 %–57.8 %] | 0.155 | 0.160 | +33.0 | sí | no |
| 2026-10-09T00:00 | 2026-10-08T21:48 | 144 | 2026-10-07 | 45.5 % [35.3 %–57.8 %] | 0.135 | 0.140 | +32.0 | sí | no |
| 2026-10-09T12:00 | 2026-10-09T03:29 | 144 | 2026-10-07 | 45.4 % [35.2 %–57.9 %] | 0.135 | — | +31.9 | sí | no |
| 2026-10-10T00:00 | 2026-10-09T20:13 | 146 | 2026-10-08 | 45.4 % [32.9 %–57.9 %] | 0.105 | 0.110 | +34.9 | sí | no |
| 2026-10-10T12:00 | 2026-10-10T05:36 | 146 | 2026-10-08 | 45.4 % [32.8 %–58.0 %] | 0.115 | 0.120 | +33.9 | sí | no |
| 2026-10-11T00:00 | 2026-10-10T20:53 | 147 | 2026-10-08 | 33.4 % [22.9 %–57.9 %] | 0.115 | 0.120 | +21.9 | sí | no |
| 2026-10-11T12:00 | 2026-10-10T20:53 | 147 | 2026-10-08 | 33.3 % [22.8 %–58.0 %] | 0.115 | 0.120 | +21.8 | sí | no |
| 2026-10-12T00:00 | 2026-10-10T20:53 | 147 | 2026-10-08 | 31.1 % [22.6 %–58.1 %] | 0.125 | 0.130 | +18.6 | sí | no |
| 2026-10-12T12:00 | 2026-10-12T00:07 | 147 | 2026-10-08 | 30.9 % [22.4 %–58.1 %] | 0.125 | 0.130 | +18.4 | sí | no |
| 2026-10-13T00:00 | 2026-10-12T21:20 | 147 | 2026-10-08 | 30.8 % [22.3 %–58.2 %] | 0.125 | 0.130 | +18.2 | sí | no |
| 2026-10-13T12:00 | 2026-10-12T21:20 | 147 | 2026-10-08 | 30.7 % [22.2 %–58.3 %] | 0.125 | 0.130 | +18.2 | sí | no |
| 2026-10-14T00:00 | 2026-10-13T18:45 | 150 | 2026-10-12 | 31.0 % [22.0 %–58.4 %] | 0.135 | 0.140 | +17.5 | sí | no |
| 2026-10-14T12:00 | 2026-10-14T03:43 | 151 | 2026-10-12 | 26.3 % [21.8 %–58.4 %] | 0.135 | 0.140 | +12.8 | sí | no |
| 2026-10-15T00:00 | 2026-10-14T03:43 | 151 | 2026-10-12 | 26.1 % [21.6 %–58.5 %] | 0.155 | 0.160 | +10.6 | sí | no |
| 2026-10-15T12:00 | 2026-10-15T10:41 | 153 | 2026-10-13 | 29.4 % [21.4 %–58.6 %] | 0.195 | 0.200 | +9.9 | sí | no |
| 2026-10-16T00:00 | 2026-10-15T22:45 | 155 | 2026-10-15 | 28.3 % [20.5 %–44.4 %] | 0.205 | 0.210 | +7.8 | sí | no |
| 2026-10-16T12:00 | 2026-10-15T22:45 | 155 | 2026-10-15 | 28.1 % [20.3 %–44.4 %] | 0.215 | 0.220 | +6.6 | sí | no |
| 2026-10-17T00:00 | 2026-10-16T21:15 | 159 | 2026-10-16 | 28.1 % [20.1 %–50.0 %] | 0.225 | 0.230 | +5.6 | sí | no |
| 2026-10-17T12:00 | 2026-10-17T11:30 | 159 | 2026-10-16 | 27.9 % [19.8 %–44.4 %] | 0.235 | 0.240 | +4.4 | no | no |
| 2026-10-18T00:00 | 2026-10-17T20:05 | 161 | 2026-10-16 | 27.8 % [19.6 %–44.4 %] | 0.225 | 0.230 | +5.3 | sí | no |
| 2026-10-18T12:00 | 2026-10-18T00:26 | 161 | 2026-10-16 | 27.6 % [19.4 %–44.4 %] | 0.195 | 0.200 | +8.1 | sí | no |
| 2026-10-19T00:00 | 2026-10-18T23:04 | 162 | 2026-10-17 | 27.3 % [19.1 %–44.4 %] | 0.215 | 0.220 | +5.8 | sí | no |
| 2026-10-19T12:00 | 2026-10-19T03:42 | 162 | 2026-10-17 | 27.1 % [18.9 %–44.4 %] | 0.225 | 0.230 | +4.6 | no | no |
| 2026-10-20T00:00 | 2026-10-19T21:44 | 166 | 2026-10-18 | 32.8 % [25.0 %–41.8 %] | 0.235 | 0.240 | +9.3 | sí | no |
| 2026-10-20T12:00 | 2026-10-19T21:44 | 166 | 2026-10-18 | 32.6 % [24.6 %–41.7 %] | 0.225 | 0.230 | +10.1 | sí | no |
| 2026-10-21T00:00 | 2026-10-20T23:00 | 168 | 2026-10-19 | 32.1 % [24.4 %–41.6 %] | 0.195 | 0.210 | +12.6 | sí | no |
| 2026-10-21T12:00 | 2026-10-21T03:13 | 169 | 2026-10-19 | 31.9 % [24.1 %–41.4 %] | 0.195 | 0.200 | +12.4 | sí | no |
| 2026-10-22T00:00 | 2026-10-21T22:34 | 175 | 2026-10-21 | 31.5 % [23.9 %–41.2 %] | 0.195 | 0.210 | +12.0 | sí | no |
| 2026-10-22T12:00 | 2026-10-21T22:34 | 175 | 2026-10-21 | 31.3 % [23.5 %–41.1 %] | 0.215 | 0.220 | +9.8 | sí | no |
| 2026-10-23T00:00 | 2026-10-22T22:14 | 178 | 2026-10-22 | 31.9 % [23.3 %–41.0 %] | 0.235 | 0.250 | +8.4 | sí | no |
| 2026-10-23T12:00 | 2026-10-23T03:40 | 179 | 2026-10-22 | 32.1 % [23.0 %–44.9 %] | 0.225 | 0.239 | +9.6 | sí | no |
| 2026-10-24T00:00 | 2026-10-23T22:35 | 184 | 2026-10-22 | 31.6 % [22.6 %–44.8 %] | 0.235 | 0.240 | +8.1 | sí | no |
| 2026-10-24T12:00 | 2026-10-23T22:35 | 184 | 2026-10-22 | 31.3 % [22.2 %–44.7 %] | 0.200 | 0.210 | +11.3 | sí | no |
| 2026-10-25T00:00 | 2026-10-24T23:54 | 194 | 2026-10-24 | 33.1 % [21.7 %–44.5 %] | 0.175 | 0.170 | +15.6 | sí | no |
| 2026-10-25T06:00 | 2026-10-25T05:56 | 196 | 2026-10-24 | 32.8 % [21.5 %–44.5 %] | 0.205 | 0.210 | +12.3 | sí | no |
| 2026-10-25T12:00 | 2026-10-25T06:06 | 196 | 2026-10-24 | 32.7 % [29.3 %–38.9 %] | 0.205 | 0.230 | +12.2 | sí | no |
| 2026-10-25T15:00 | 2026-10-25T06:06 | 196 | 2026-10-24 | 32.5 % [29.1 %–38.9 %] | 0.205 | 0.220 | +12.0 | sí | no |
| 2026-10-25T18:00 | 2026-10-25T06:06 | 196 | 2026-10-24 | 32.4 % [29.0 %–38.9 %] | 0.215 | 0.194 | +10.9 | sí | no |
| 2026-10-25T19:00 | 2026-10-25T06:06 | 196 | 2026-10-24 | 32.4 % [28.9 %–38.9 %] | 0.185 | 0.230 | +13.9 | sí | no |
| 2026-10-25T19:59 | 2026-10-25T06:06 | 196 | 2026-10-24 | 32.3 % [28.9 %–38.9 %] | 0.225 | 0.250 | +9.8 | sí | no |

## Resultado y evaluación

- Wikipedia (revisión `1382025421` del `2026-10-26T02:56:04+00:00`): A = 51.79 %, B = 48.21 % (votos válidos).
- Polymarket (`brazil-presidential-election`): ganador según precios = `a` (outcomePrices de Gamma (YES ≥ 0,99)).
- Ganador: **Lula**.
- Fuentes concordantes: sí.
- Brier medio sobre 46 instantes: modelo 0.436 vs mercado 0.675; log loss: modelo 1.088 vs mercado 1.747.
- **Una sola elección. Que el resultado coincida o no con una estimación no prueba que estuviera bien calibrada.**

## Fuentes y verificabilidad

- Alertas retrospectivas congeladas en `data/alerts/backtest_br-2026-presidente-2t.jsonl`: 111 registros, cadena SHA-256 íntegra: sí.
- Revisiones de Wikipedia usadas: 28 (manifiesto en `data/manifests/br-2026-presidente-2t.json`).
- Consultas a Polymarket registradas: 102 (URL, hora de recepción y SHA-256 en el JSON del backtest).

## Limitaciones

- Polymarket no publica libros de órdenes históricos: no existe el ask ejecutable del pasado. El precio de referencia no es ejecutable; las compras reales prueban que se pagó ese precio por ese tamaño, no que hubiera más profundidad.
- La disponibilidad de una encuesta se acota por la revisión de Wikipedia que la contiene; pudo publicarse antes en otro medio (el sistema puede llegar tarde, no adelantarse).
- El modelo trata la contienda como de dos candidatos (P(B) = 1 − P(A)) e ignora la regla de 'Other' si no hay resultado antes de junio de 2027.
- Una sola elección no permite evaluar calibración ni rentabilidad.
