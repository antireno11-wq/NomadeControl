# Motor de discrepancias electorales

Módulo `radar.elections`. Compara probabilidades estimadas a partir de encuestas
con precios de Polymarket, emite **alertas de investigación** y solo permitiría
una **señal operable** si se cumplen condiciones estrictas. Nada de esto ejecuta
operaciones: todo es lectura y simulación.

## 1. Qué hace cada pieza

| Requisito | Implementación | Estado |
|---|---|---|
| 1. Descubrir mercados electorales activos | `discovery.py`: clasificación determinista (`elec-classify-v1`) de todos los mercados abiertos ingeridos: tipo, cargo, país, año, vuelta, candidato; vínculo con contiendas registradas | ✅ 10.824 mercados en 1.847 eventos (corrida real) |
| 2. Encuestas, promedios y modelos con fecha | `sources/wikimedia.py` + `polls.py`: tablas de encuestas y de agregadores de Wikipedia **por revisión** (id + timestamp + SHA-256); cada encuesta trae fechas de campo, tamaño, margen; cada agregador su fecha de actualización | ✅ (ver limitaciones: no hay modelos probabilísticos externos verificables) |
| 3. Encuestas → probabilidades con errores históricos | `models.py`: promedio ponderado y mediana de encuestadoras; error calibrado con 9 segundas vueltas reales; Monte Carlo t de Student (ν=4) y bootstrap empírico; incertidumbre de calibración por bootstrap de contiendas | ✅ |
| 4. Registrar estimaciones y desacuerdos sin elegir la favorable | `engine.py`: hasta 3 estimaciones internas + 1 por agregador; todas se guardan (`election_estimates`); referencia **preregistrada** = mediana; desacuerdo = rango y desviación | ✅ |
| 5. Comparar con ASK ejecutable | En vivo: libro del CLOB, VWAP para US$25, spread y antigüedad. En el pasado no existe ask: se usa precio de referencia (no ejecutable) y compras reales observadas, siempre etiquetados | ✅ |
| 6. Alerta de investigación ≥ 5 p.p. bruta | `EngineConfig.alert_threshold_pp = 5.0` sobre la referencia, por token | ✅ |
| 7. Señal operable solo si modelo validado + ventaja conservadora > 0 tras costos + liquidez | `gating_reasons()`: validación, base de precio = ask, urnas abiertas, comisión verificada, llenado completo, spread ≤ 0,05, libro ≤ 15 min, ≥ 2 estimaciones, ventaja conservadora (peor cota inferior entre todas las estimaciones − costo) > 0 | ✅ |
| 8. Snapshot verificable antes del resultado | `alerts.py`: JSON canónico + SHA-256 encadenado en un ledger JSONL de solo anexado; `verify-ledger` detecta alteraciones o borrados; en vivo solo se generan con urnas abiertas | ✅ (para prueba pública, el ledger debe publicarse fuera del sistema antes del cierre) |
| 9. Backtest Brasil oct-2026 solo con información disponible | `backtest.py`: 46 instantes del 5 al 25-oct; en cada T, la revisión de Wikipedia vigente en T; precio y operaciones ≤ T; calibración solo con contiendas anteriores | ✅ |
| 10. ¿Señal antes del resultado? ¿hora, datos, precio? | Reporte `reports/backtest_br-2026-presidente-2t.md` y pantalla **Electoral** | ✅ |

## 2. Reglas preregistradas (versión `electoral-2t-v1`)

Fijadas en el código antes de ejecutar el backtest; cambiarlas exige una nueva versión.

- Voto bipartidista `s = A/(A+B)`; contienda de dos candidatos: `P(B) = 1 − P(A)`.
- Promedio ponderado: última encuesta por encuestadora en 30 días,
  peso `0,5^(edad/7 días) · sqrt(n/1000)`. Mediana: última por encuestadora en 14
  días, mínimo 3 encuestadoras.
- Error: `σ²(d) = σ0² + k·d` ajustado sobre errores al cuadrado de las contiendas
  históricas (sin corregir sesgo). Disponibilidad histórica de una encuesta:
  fin de campo + 1 día.
- Probabilidad: 20.000 simulaciones con semilla fija; intervalo = percentiles
  5–95 entre réplicas bootstrap de la calibración.
- Agregadores: su promedio publicado se convierte con el mismo error del
  promedio ponderado (calibración prestada; no hay historial propio).
- Referencia: mediana de todas las estimaciones válidas.
- Alerta: discrepancia bruta `P(token) − precio ≥ 5 p.p.`.
- Validación: dejar una contienda fuera; ≥ 15 contiendas, Brier < 0,23,
  cobertura del intervalo 90 % del voto en [0,80; 0,97] y del 50 % en [0,35; 0,65].
- Comisiones: parámetros por mercado de Gamma; fórmula de
  docs.polymarket.com/trading/fees `fee = C × feeRate × p × (1 − p)`; con
  exponente ≠ 1 el modelo de comisión se considera no verificado y bloquea la señal.

## 3. Resultados reales

### 3.1 Backtest Brasil 2026, segunda vuelta (Lula vs. Flávio Bolsonaro)

- 46 instantes de evaluación (5-oct 12:00 → 25-oct 19:59 UTC; cierre 20:00 UTC),
  respaldados por 28 revisiones de Wikipedia, cada una con timestamp ≤ T.
- **¿Señal operable antes del resultado? No (0 de 46).** Bloqueos: modelo no
  validado (9 contiendas, mínimo 15), y en el pasado no hay ask ejecutable. Además,
  en 304 cotizaciones la ventaja conservadora no fue positiva.
- **Alertas de investigación:** en 44 de 46 instantes. La primera:
  5-oct 12:00 UTC, token **Lula YES** a 0,165 (precio de referencia; 15 compras
  reales entre 0,160 y 0,170 en la hora previa). Referencia del modelo P(Lula) =
  46,0 % (rango 42,4–57,5 % entre 8 estimaciones), revisión de Wikipedia
  `1378586366`.
- Último instante (25-oct 19:59): P(Lula) = 32,3 % [28,9–38,9 %] frente a un precio
  de referencia de 0,225 y compras reales hasta 0,250.
- Resultado: Lula 51,79 % y Flávio 48,21 % de los votos válidos (revisión de
  Wikipedia `1382025421`). Coincide con los precios de resolución de Polymarket.
- Brier medio sobre los 46 instantes: modelo 0,436 frente a 0,675 del mercado.

**Cómo leerlo:** las encuestas daban ventaja a Flávio (≈ 51 % bipartidista en los
promedios finales) y se equivocaron. El modelo no "acertó" el ganador: le daba a
Lula alrededor del 32 % al final. Asignaba más probabilidad que el mercado porque
el error histórico de las encuestas en segundas vueltas es grande (σ0 ≈ 2,7 p.p.).
Es **una sola elección**: que el modelo quedara más cerca no prueba que esté calibrado.

### 3.2 Calibración sobre 9 segundas vueltas (solo encuestas)

Brasil 2010, 2018 y 2022; Francia 2017 y 2022; Perú 2021; Colombia 2022;
Polonia 2025; Rumanía 2025.

- Brier fuera de muestra: 0,158 (promedio ponderado) y 0,151 (mediana).
- Cobertura del intervalo del 90 %: 0,85; del 50 %: 0,44 (ponderado).
- **Estado: no validado** (9 < 15 contiendas). No se descartaron contiendas por su
  resultado. Las descartadas (Polonia 2020, Chile 2021 y 2025, Ecuador 2025) lo
  fueron porque su página de encuestas no publica fila de resultado.

### 3.3 Comparación con el mercado (walk-forward, 5 elecciones con mercado CLOB)

| Contienda | Brier modelo | Brier mercado | Operación hipotética | P&L hipotético |
|---|---:|---:|---|---:|
| Brasil 2026 | 0,448 | 0,640 | Flávio NO @ 0,207 | +95,77 |
| Polonia 2025 | 0,490 | 0,429 | Nawrocki NO @ 0,635 | −25,00 |
| Rumanía 2025 | 0,355 | 0,327 | Simion NO @ 0,355 | +45,42 |
| Ecuador 2025 | 0,402 | 0,336 | — (ninguna alerta sobre precio de compras reales) | — |
| Chile 2025 | 0,00004 | 0,0004 | — (sin alertas) | — |

- Brier medio: modelo 0,339 frente a 0,347 del mercado. El modelo fue peor en 3 de 5.
- Las 3 operaciones son **hipotéticas** (US$25 cada una, al máximo precio pagado en
  compras reales de la hora previa, más costos). Suman +116,20 US$ sobre 75 US$,
  con 1 pérdida en 3. **No son ganancias realizadas, no demuestran rentabilidad y
  la muestra es demasiado pequeña para concluir.**
- En esta comparación, la disponibilidad de encuestas es aproximada (fin de campo +
  2 días, sobre la página posterior a la elección). Solo el backtest específico de
  Brasil usa revisiones exactas.

## 4. Fuentes y procedencia

- Encuestas, agregadores y resultados: Wikipedia (Action API y REST), una revisión
  fija por instante. Manifiestos en `data/manifests/`; HTML en la caché
  `data/raw/wikimedia/` (no versionada, verificable por revid y SHA-256).
- Precios de referencia: `GET clob.polymarket.com/prices-history` (no ejecutables).
- Operaciones reales: `GET data-api.polymarket.com/trades?takerOnly=true&start&end`.
- Mercados y resolución: Gamma `/events/keyset?slug=…&closed=any`.
- Cada consulta queda registrada con URL, hora de recepción y SHA-256 en el JSON
  del backtest y en `data/raw/polymarket/`.

## 5. Limitaciones conocidas

- **No hay libros de órdenes históricos:** ninguna señal del pasado puede
  calificarse como operable. Las compras reales prueban un precio pagado para un
  tamaño, no profundidad adicional.
- **Disponibilidad de encuestas:** la revisión de Wikipedia es una cota superior;
  la encuesta pudo publicarse antes en otro medio. El sistema puede llegar tarde,
  pero no adelantarse.
- **Modelos externos:** no se encontraron modelos probabilísticos independientes
  y verificables para Brasil 2026. Solo hay promedios de agregadores (Poll+Trend,
  UOL, BBC/PollingData, Plano Político, The Economist, PollsterGraph, ABC Dados),
  que se registran por separado.
- **Primera vuelta y derivados:** no modelados (multicandidato, por estado, márgenes,
  participación); esos mercados quedan en abstención con su motivo.
- **Pocas contiendas:** con 9 contiendas el error de las encuestas se estima con
  mucha incertidumbre; mezclar países supone errores comparables.
- `web.archive.org` no fue accesible desde este entorno. Habría permitido contrastar
  timestamps con capturas de terceros.

## 6. Comandos

```bash
radar elections discover                    # clasifica mercados electorales abiertos
radar elections calibrate                   # calibración y validación (JSON)
radar elections --out reports backtest      # backtest Brasil 2026 → reports/backtest_*.md|json
radar elections --out reports evaluate      # evaluación multi-elección → reports/evaluacion_*
radar elections scan                        # escaneo en vivo (se abstiene con urnas cerradas)
radar elections verify-ledger data/alerts/backtest_br-2026-presidente-2t.jsonl
```
