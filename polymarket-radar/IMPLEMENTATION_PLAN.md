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

## Hito 1.1 — Escala y frescura ⬜

- Descubierta incremental: usar `/events/keyset` (≈3× más rápida) solo después
  de explicar mercado por mercado la diferencia de ~30.000 mercados con el
  listado canónico; mientras tanto, corrida completa canónica cada N horas y
  refrescos parciales en medio.
- Refresco de libros priorizado (mercados líquidos y con actividad 24h).
- Retención/particionado de `orderbook_snapshots` por mes.
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

- YES+NO del mismo mercado; conjuntos exhaustivos y excluyentes (`neg_risk`);
  jerarquías (umbral mayor ⇒ umbral menor).
- Costo ejecutable recorriendo niveles (`simulate_buy`/`simulate_sell`),
  comisiones desde `fee_schedule` (verificar fórmula con documentación oficial
  antes de usarla), slippage, capital requerido, pagos por escenario, ganancia
  mín/máx, riesgo de ejecución parcial (libros no simultáneos).
- "Arbitraje verificado" solo si la ganancia neta mínima > 0 en todos los
  escenarios y las reglas están verificadas (hito 2).
- Pruebas: rentable, no rentable, ilíquido, ambiguo.

## Hito 4 — Modelos predictivos ⬜

- Interfaz `predict(market, evidence, as_of_time)` → probabilidad, intervalo,
  versión, datos usados, fecha, estado de calibración, motivo de abstención.
- Cripto: precio al vencimiento (cierre > K) vs. toque de barrera antes del
  vencimiento; simulación de trayectorias con volatilidad histórica; modelos
  alternativos (GBM, bootstrap de retornos, volatilidad implícita si hay fuente
  verificable). Fuente de precios histórica a definir y documentar.
- Macro, corporativo, elecciones, otros: interfaces que se abstienen hasta
  contar con datasets adecuados.

## Hito 5 — Valoración ⬜

- Probabilidad del modelo vs. precio ejecutable; ventaja en p.p.; EV bruto y
  neto; incertidumbre; riesgo de liquidez; umbrales configurables.
- Sin señal si el modelo no está calibrado o los datos son insuficientes.

## Hito 6 — Cartera virtual ⬜

- US$1.000, reserva mínima US$700, exposición máx. US$300, pérdida máx. por
  operación direccional US$25, sin apalancamiento.
- Ejecución simulada contra libros guardados, llenados parciales, comisiones,
  ledger auditable (append-only), P&L realizado/no realizado, resolución solo con
  resultados verificados, exposición correlacionada por evento/categoría.

## Hito 7 — Backtesting ⬜

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
