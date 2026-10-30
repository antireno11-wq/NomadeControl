# Plan de implementación — Polymarket AI Radar

Cada hito se considera terminado solo con **evidencia ejecutada**: pruebas
automáticas en verde, una corrida real (cuando haya conectividad) y un reporte
generado desde la base. Nada se marca como hecho por estar "diseñado".

Leyenda: ✅ hecho y verificado · 🟡 parcial · ⬜ pendiente

## Hito 1 — Ingesta, liquidez y dashboard inicial ✅

| Entregable | Estado | Evidencia |
|---|---|---|
| Proyecto Python 3.12 ejecutable (`radar` CLI) | ✅ | `radar check`, `radar ingest`, `radar report` |
| Docker Compose (db, migrate, api, scheduler, dashboard, tests) | ✅ | ver README, sección *Verificación* |
| PostgreSQL + Alembic (`0001_initial_schema`) | ✅ | `tests/test_migrations_db.py` (modelos = migración) |
| Conector real Gamma (keyset, eventos, consulta por id) | ✅ | corrida real + `tests/test_live.py` |
| Conector real CLOB (`POST /books`) | ✅ | corrida real + `tests/test_live.py` |
| Descubierta paginada de todos los mercados abiertos | ✅ | reporte en `reports/` |
| Almacenamiento de mercados, eventos, tokens, snapshots | ✅ | `tests/test_pipeline_db.py` |
| Bid/ask/spread/profundidad/VWAP | ✅ | `tests/test_orderbook.py` |
| Filtros de elegibilidad y liquidez con motivos | ✅ | `tests/test_filters.py` |
| Dashboard inicial (Radar, Mercados, Detalle, Ingesta) | ✅ | capturas en `docs/screenshots/` |
| Reinicio sin duplicados | ✅ | `test_rerun_is_idempotent`, corrida real repetida |
| Errores visibles (base, API, dashboard, reporte) | ✅ | `ingestion_errors`, pantalla Ingesta |
| Reporte real con conteos | ✅ | `reports/ingestion_run_*.md` |

Limitaciones conocidas del hito 1:
- Una corrida completa tarda ~25–35 min (≈2.400 páginas secuenciales de Gamma).
- Los libros se piden secuencialmente por lotes: no son una foto simultánea.
- Categorías por etiquetas con una regla simple (`tags-v1`).

## Hito E — Motor de discrepancias electorales ✅ (con limitaciones)

| Entregable | Estado | Evidencia |
|---|---|---|
| Descubrimiento de mercados electorales activos | ✅ | 10.824 mercados / 1.847 eventos (`radar elections discover`) |
| Encuestas y agregadores con fecha, por revisión | ✅ | 28 revisiones para 46 instantes (`data/manifests/`) |
| Probabilidades con error histórico (Monte Carlo) | ✅ | 9 segundas vueltas reales de calibración |
| Estimaciones múltiples y desacuerdo registrados | ✅ | `election_estimates`, reporte |
| Comparación con ask ejecutable (en vivo) | ✅ | `scan_contest` + pruebas; sin contienda abierta hoy |
| Alerta ≥ 5 p.p. / señal operable solo con todas las condiciones | ✅ | `tests/test_elections_engine.py` |
| Snapshot verificable (ledger encadenado) | ✅ | `verify-ledger`: 111 registros, cadena íntegra |
| Backtest Brasil oct-2026 sin información futura | ✅ | `reports/backtest_br-2026-presidente-2t.md` |
| Evaluación sobre varias elecciones | 🟡 | 9 contiendas de calibración y 5 contra el mercado: insuficiente para validar |

Pendiente para validar el modelo: ≥ 15 contiendas con resultado (fuentes de
resultados fuera de la página de encuestas, p. ej. TSE/órganos electorales),
modelo de primera vuelta multicandidato, márgenes por tramos y publicación
externa del ledger en vivo antes de cada cierre.

## Hito 1.1 — Escala y frescura ⬜

- Descubierta por `/events/keyset` (≈3× más rápida) filtrando `active=true`.
  Ya se explicó la mayor parte de la diferencia con el listado canónico (los
  ~32.000 extra son mayormente `active=false`); falta verificar los ~2.200 que
  solo aparecieron en el canónico con dos mediciones simultáneas. Mientras tanto,
  corrida canónica completa y refrescos parciales en medio.
- Refresco de libros priorizado (mercados líquidos y con actividad 24h).
- Retención/particionado de `orderbook_snapshots` por mes.
- Índices para listar todos los analizados ordenados por volumen/fecha (hoy
  3,8 s sobre 208k filas).
- Opción `success` vs. `partial`: hoy unos pocos tokens sin libro (48–132 de
  ~417.000) bastan para marcar `partial`; evaluar un umbral de cobertura
  explícito en lugar de "0 errores".
- WebSocket del CLOB para mercados seguidos (solo lectura).

## Hito 2 — Inteligencia de contratos ⬜

- Tabla `contract_terms`: condición exacta, fecha y zona horaria, resultados,
  fuente de resolución, reglas especiales, estado, **grado de ambigüedad**.
- Extracción determinista desde `description` + campos de Gamma; extracción por
  IA solo como propuesta marcada `proposed`.
- Relaciones: complementariedad (YES/NO del mismo `condition_id`), exclusión
  mutua (eventos `neg_risk` con `neg_risk_market_id` común), implicación
  (umbrales jerárquicos del mismo subyacente y fecha), equivalencia potencial.
- Validadores deterministas; sin validación → sin arbitraje automático.
- Pruebas con reglas reales capturadas y casos ambiguos.

## Hito 3 — Arbitraje ⬜

- YES+NO del mismo mercado (dato del hito 1: los libros son espejo y la suma
  de asks fue ≥ 1,001 en los 208.344 binarios de la corrida #2; se implementa
  igual como control); conjuntos exhaustivos y excluyentes (`neg_risk`);
  jerarquías (umbral mayor ⇒ umbral menor).
- Costo ejecutable recorriendo niveles (`simulate_buy`/`simulate_sell`),
  comisiones desde `fee_schedule` (verificar fórmula con documentación oficial
  antes de usarla), slippage, capital requerido, pagos por escenario, ganancia
  mín/máx, riesgo de ejecución parcial (libros no simultáneos).
- "Arbitraje verificado" solo si la ganancia neta mínima > 0 en todos los
  escenarios y las reglas están verificadas (hito 2).
- Pruebas: rentable, no rentable, ilíquido, ambiguo.

## Hito 4 — Modelos predictivos ✅ (cripto y electoral; otras familias se abstienen)

| Entregable | Estado | Evidencia |
|---|---|---|
| Interfaz `predict(market, evidence, as_of_time)` con salida completa | ✅ | `radar/predict/base.py`, `tests/test_predict_crypto.py` |
| Enrutamiento por familia y abstención con motivo | ✅ | `radar/predict/registry.py`, `tests/test_predict_registry.py` |
| Contratos cripto: precio final, rango, Up/Down y toque | ✅ | `crypto-terms-v1` sobre reglas reales, `tests/test_predict_terms.py` |
| Datos con procedencia: Binance (checksum oficial), DVOL de Deribit | ✅ | `data/raw/` (no versionado), SHA-256 en cada predicción |
| Modelos alternativos `rv`, `ewma`, `dvol`, `bootstrap` | ✅ | fórmulas contrastadas con simulación (`tests/test_predict_models.py`) |
| Evaluación preregistrada fuera de muestra | ✅ | `docs/PREREGISTRO_CRIPTO.md`, `reports/backtest_cripto.md`. 26-oct: 25.895 mercados, 22 de 36 pares validados y 13 que superan al mercado; repetida con métricas idénticas (`docs/EVIDENCE.md` §9.3) |
| Elecciones vía la misma interfaz | ✅ | adaptador `elecciones-2t` |
| Deportes (NBA, NFL, NHL, MLB, fútbol) y Fed | 🟡 | referencia de Kalshi sin margen (`ref-kalshi-v1`), en observación hasta pasar la evaluación en vivo (`docs/EVIDENCE.md` §11.2) |
| Modelos cripto v2 en paralelo, sin apostar (`crypto-models-v2`) | 🟡 | `docs/PREREGISTRO_CRIPTO_V2.md` (commit f4db524, antes de programar). `cripto2-vol` (hora de Nueva York, eventos IPC/empleo/Fed, colas t, recalibración): prueba medida una vez el 30-oct (`reports/backtest_cripto_v2.md`): mejor que v1 y que el mercado en `daily_above` y `daily_range`, peor que v1 en `touch_range`. `cripto2-opciones` (Deribit) y `cripto2-mezcla` (libro de Polymarket) solo en vivo; pesos ajustados de la mezcla pendientes para el 16-nov. Reemplazo de v1: dos evaluaciones en vivo separadas 7 días (`radar.predict.forward.compare_v2`) |
| Corporativo, clima, política, otras ligas | ⬜ | se abstienen; candidatos: clima (pronósticos por conjuntos) y Tesoro (motor de toque) |

## Hito 5 — Valoración ✅ (`valuation-v1`)

| Entregable | Estado | Evidencia |
|---|---|---|
| Probabilidad vs. ask ejecutable (VWAP), diferencia en p.p., VE bruto/neto/conservador, costos, incertidumbre, riesgo de liquidez | ✅ | `radar/predict/valuation.py`, `tests/test_predict_valuation.py` |
| Umbrales configurables y puertas de señal | ✅ | `ValuationConfig`, `gate_reasons` |
| Sin señal si el modelo no está validado o no supera al mercado | ✅ | pruebas de puertas |
| Corrida en vivo manual y programada | ✅ | `radar predict live`, `RADAR_PREDICT_INTERVAL_MINUTES`. Va por tandas de 50 mercados y pide los libros justo antes de valorar. 27-oct, base local: antigüedad del libro con mediana 0,09 s y máxima 39,8 s (`docs/EVIDENCE.md` §10) |

| Evaluación en vivo (`forward-v1`) con suspensión automática | ✅ | `radar/predict/forward.py`, `tests/test_forward.py`, `docs/EVIDENCE.md` §11 |

Pendiente:

- **Despliegue en Railway.** Preparado (`radar serve`, etapa `deploy`), no ejecutado: espera
  la aprobación del costo.
- **Re-ajuste periódico de parámetros** (`crypto-refit-v1`): preregistrarlo antes de correrlo.

## Hito 6 — Cartera virtual 🟡 (`paper-v1`)

| Entregable | Estado | Evidencia |
|---|---|---|
| US$1.000, reserva US$700, exposición máx. US$300, US$25 por señal | ✅ | `open_paper`, `test_paper_respects_max_exposure` |
| Compra al VWAP del ask del libro real + comisión; cierre solo con resolución oficial | ✅ | `resolve`, `docs/EVIDENCE.md` §11.1 |
| Ledger encadenado (append-only), P&L no realizado, exposición por evento | ⬜ | hoy es una tabla normal (`paper_trades`) |

## Hito 7 — Backtesting 🟡 (cripto hecho; general pendiente)

Hecho para cripto: motor cronológico con partición entrenamiento/validación/prueba,
mercados resueltos sin filtrar por resultado, precios históricos reales (referencia
no ejecutable), Brier, log loss, ECE, calibración, comparación con el mercado y
operaciones hipotéticas con caída máxima. Resultados del 26-oct-2026 en
`docs/PREDICTIVE_MODELS.md` §5. Pendiente: generalizarlo a otras familias y a la cartera
virtual (hito 6).

### Diseño original


- Motor cronológico con `as_of_time`; train/validación/test temporal; incluye
  mercados cerrados y desaparecidos (sin survivorship bias); solo precios
  realmente registrados; sin reconstruir profundidad inexistente.
- Métricas: Brier, log loss, calibración, ROI neto, drawdown, nº operaciones,
  beneficio por categoría, comparación con referencia de mercado.
- Si faltan datos: informe explícito de lo que falta.

## Hito 8 — Alertas ⬜

- Arbitraje verificado, ventaja > umbral, cambios de liquidez, fallos de datos,
  límites de riesgo. Persistidas con clave de deduplicación; canal de dashboard
  e interfaz para email/otros.
