# Arquitectura — Polymarket AI Radar

Estado: **hito 1 (ingesta + liquidez + dashboard inicial)**. Los módulos B–H
están diseñados aquí pero no implementados; ver `IMPLEMENTATION_PLAN.md`.

## 1. Principios que condicionan el diseño

1. **Nada se inventa.** Cada número que muestra el sistema proviene de una fila
   con `data_origin` (`real` | `historical` | `synthetic`), fuente (`source`) y
   timestamps. Si falta un dato, la API devuelve `null` y el dashboard muestra
   "Información insuficiente".
2. **Precio ejecutable = order book del CLOB.** Los precios de Gamma
   (`outcomePrices`, `bestBid`, `bestAsk`, `lastTradePrice`) se guardan con
   prefijo `gamma_` y se etiquetan como indicativos. El último precio
   negociado del CLOB se guarda como `clob_last_trade_price`, nunca como precio
   de entrada.
3. **Timestamps separados.** `source_ts` / `source_updated_at` = cuándo ocurrió
   en la fuente; `received_at` / `*_seen_at` = cuándo lo recibimos.
4. **Solo lectura.** No hay autenticación de trading, ni claves, ni endpoints de
   órdenes. `RADAR_TRADING_MODE` solo acepta `paper`; otro valor aborta el
   arranque (prueba: `tests/test_config.py`).
5. **Cobertura explícita.** Cada corrida registra el embudo completo
   (descubiertos → elegibles → libros → analizados → líquidos) y sus errores.

## 2. Componentes

```
                    ┌─────────────── APIs públicas (solo lectura) ───────────────┐
                    │ Gamma  GET /events/keyset   GET /markets/keyset            │
                    │        GET /markets/keyset?closed=any&id=…                 │
                    │ CLOB   POST /books           GET /time                     │
                    └───────────────┬───────────────────────────┬────────────────┘
                                    │ httpx + token bucket +     │
                                    │ reintentos/backoff         │
                    ┌───────────────▼───────────────────────────▼────────────────┐
  radar ingest ───► │ ingestion.pipeline (lock consultivo de PostgreSQL)         │
  radar scheduler ─►│  events → discovery → closures → books (hilos acotados)    │
                    │  gamma.py / clob.py: validación pydantic                   │
                    │  market/orderbook.py: métricas, VWAP, llenado parcial      │
                    │  market/filters.py: elegibilidad + liquidez (motivos)      │
                    └───────────────┬────────────────────────────────────────────┘
                                    │ upserts por página (streaming)
                    ┌───────────────▼───────────────┐
                    │ PostgreSQL 16 (Alembic)       │
                    └───────┬───────────────┬───────┘
                            │               │
                 ┌──────────▼─────┐   ┌─────▼──────────────┐
                 │ FastAPI /api/* │◄──│ Streamlit dashboard │
                 └────────────────┘   └────────────────────┘
                 radar report → reports/*.md (generado desde la base)
```

| Paquete | Responsabilidad |
|---|---|
| `radar.config` | Configuración `RADAR_*` (pydantic-settings); bloqueo del modo papel |
| `radar.ingestion.http` | Cliente HTTP: rate limiter, reintentos (408/425/429/5xx/52x, errores de red), `Retry-After`, sin reintento en otros 4xx |
| `radar.ingestion.gamma` | Modelos y paginación de Gamma; decodifica campos que vienen como cadenas JSON |
| `radar.ingestion.clob` | Lotes de `/books`; bisección ante 4xx para aislar tokens problemáticos |
| `radar.ingestion.pipeline` | Orquestación, conteos, errores, idempotencia, cierres |
| `radar.market.*` | Lógica determinista pura (sin E/S): libros, filtros, categorías |
| `radar.queries` / `radar.reports` | Lecturas compartidas por API, CLI y reporte |
| `radar.api.main` | API REST de solo lectura |
| `radar.dashboard.app` | UI; consume la API, no la base |
| `radar.scheduler` | APScheduler, una instancia, `coalesce` |

## 3. Flujo de una corrida

1. **Lock.** `pg_try_advisory_lock`: si otra corrida (manual o programada) está
   activa, se aborta sin escribir. Con el lock tomado, cualquier corrida que
   quedó en `running` se marca `failed` ("interrumpida").
2. **events** — `/events/keyset?closed=false&include_markets=false`: eventos y
   etiquetas → `events.category` (regla `tags-v1`). Si falla, la corrida sigue y
   las categorías quedan `unknown`.
3. **discovery** — `/markets/keyset?closed=false`, 100 por página, cursor
   `next_cursor`. Cada página se valida y se persiste en su propia transacción.
   Duplicados de paginación se descartan y se cuentan. Si una página falla tras
   los reintentos, la descubierta queda **incompleta** (no hay cursor para seguir).
4. **closures** — solo con descubierta completa. Los mercados abiertos en la base
   que no aparecieron se consultan por id (`closed=any`). Si Gamma confirma
   `closed=true` → `closed_detected_at`. Si no los devuelve → `missing_since`.
   Nunca se asume un cierre.
5. **books** — tokens de mercados elegibles en lotes de 200 (`POST /books`),
   `RADAR_CLOB_CONCURRENCY` hilos compartiendo el rate limiter. El hilo principal
   procesa en orden, calcula métricas y escribe `market_state` y snapshots.
6. **Cierre.** Estado: `success` (descubierta completa y 0 errores), `partial`
   (descubierta incompleta o algún error) o `failed` (sin páginas de Gamma o
   excepción). Se guardan conteos, motivos, tiempos por etapa y notas.

## 4. Modelo de datos

| Tabla | Clave | Contenido |
|---|---|---|
| `ingestion_runs` | `id` | Embudo de conteos, estado, `discovery_complete`, motivos, tiempos, configuración (sin secretos), notas |
| `ingestion_errors` | `id` | Etapa, fuente, endpoint, entidad, tipo, HTTP, intentos, mensaje (muestra de ≤200 por tipo y corrida; el total va en `errors_count`) |
| `events` | id de Gamma | Título, `neg_risk`, etiquetas, categoría |
| `markets` | id de Gamma | Pregunta, **reglas** (`description`), fuente de resolución, resultados, tokens, fechas, estado, parámetros (tick, tamaño mínimo, comisiones), métricas indicativas `gamma_*`, `rules_hash`, elegibilidad y motivos, `first/last_seen`, `closed_detected_at`, `missing_since`, JSON crudo |
| `tokens` | `token_id` | Resultado e índice |
| `orderbook_snapshots` | `id`; único (`token_id`, `source_ts`, `book_hash`) | Métricas del libro + niveles (truncados) |
| `market_state` | `market_id` | Último análisis por mercado: analizado, líquido, motivos, bid/ask/spread, profundidad, VWAP de referencia |

### Idempotencia y deduplicación

- `markets`, `events`, `tokens`: upsert por clave natural.
- `orderbook_snapshots`: `ON CONFLICT DO NOTHING` sobre
  (`token_id`, `source_ts`, `book_hash`) con `NULLS NOT DISTINCT`. El
  `timestamp` del CLOB solo cambia cuando cambia el libro (verificado en la
  corrida real #2: 2.044 libros idénticos a la #1 no se reinsertaron y no hay
  ningún snapshot repetido), así que reiniciar o repetir no duplica.
- `raw` y `description` solo se reescriben al insertar o si cambia `rules_hash`;
  los campos volátiles tienen columnas propias. Evita reescribir ~2 GB de JSON
  por corrida con el universo actual.

## 5. Escala medida (APIs reales, 25-oct-2026)

| Medición | Valor |
|---|---|
| Mercados abiertos en `/markets/keyset` | 241.249 (2.413 páginas, 975 s secuenciales) |
| Página de `/markets/keyset` | 100 mercados máx. (`limit` mayor se ignora), ~0,3–0,4 s |
| `/markets?offset=` | Deprecado: cabecera `warning: use /markets/keyset`, `sunset` 2026-05-01 |
| `/events/keyset` con mercados anidados | 21.909 eventos, 271.530 mercados anidados no cerrados (+136.164 cerrados) en 305 s |
| `POST /books` | lotes de 200 tokens OK, ~0,3–0,5 s |
| User-Agent | Cloudflare devuelve 403 "error code: 1010" al UA por defecto de `urllib`; se envía un UA explícito |

**Decisión:** la descubierta canónica usa `/markets/keyset`. La vía por eventos
es ~3× más rápida pero no es equivalente. Comparación de conjuntos de ids
(listado canónico de la corrida #1 vs. medición por eventos ~10 min antes):

| | Mercados |
|---|---:|
| En ambos | 239.445 |
| Solo anidados en eventos | 32.085 |
| Solo en `/markets/keyset` | 2.236 |

Una muestra de 100 de los "solo en eventos" consultada por id con `closed=any`
no devolvió ninguno, y en el payload de eventos 697 de 698 muestreados tienen
`active=false` (marcadores como "Will A win…" aún no activados): no serían
elegibles. Los 2.236 "solo canónicos" no se han verificado (hipótesis: creados
entre ambas mediciones). Hasta verificarlo, la vía por eventos no se usa como
fuente de verdad (ver hito 1.1).

**Libros YES/NO espejo:** el CLOB publica libros complementarios: en la
corrida #2, 8.737 de 8.740 pares de snapshots cumplen `bid_YES = 1 − ask_NO` y
`ask_YES = 1 − bid_NO`, y en los 208.344 binarios analizados la suma de mejores
asks fue siempre ≥ 1,001 (y la de bids ≤ 0,999). El motor de arbitraje (hito 3)
debe partir de este hecho: el desajuste YES/NO dentro de un mercado no es la
fuente esperable de oportunidades; sí lo son los conjuntos `neg_risk` y las
relaciones entre mercados, siempre con comisiones y libros no simultáneos.

**Snapshots:** con ~2,4·10⁵ mercados elegibles habría ~4,8·10⁵ libros por
corrida. Por defecto (`RADAR_SNAPSHOT_SCOPE=liquid`) solo se guardan snapshots
de mercados que pasan el filtro de liquidez; `market_state` conserva siempre el
último análisis de todos.

## 6. Filtros

**Elegibilidad (metadatos Gamma):** abierto, activo, no archivado, order book
habilitado, acepta órdenes, tokens = resultados y sin duplicados, fecha de cierre
futura. Cada exclusión deja su motivo.

**Liquidez (CLOB):** para *todos* los tokens del mercado: libro de dos lados, sin
cruce, `spread ≤ RADAR_LIQ_MAX_SPREAD` (0,05), y ≥ `RADAR_LIQ_MIN_DEPTH_USD`
(US$100) de nocional por lado dentro de `RADAR_LIQ_DEPTH_BAND` (0,02) del mejor
precio. Pasar el filtro **no** es una señal de trading.

## 7. Errores, reintentos y recuperación

- Backoff exponencial con jitter (base `RADAR_HTTP_BACKOFF_BASE_S`, tope
  `RADAR_HTTP_BACKOFF_MAX_S`), `Retry-After` respetado, `RADAR_HTTP_MAX_RETRIES`.
- Errores de una página de Gamma: descubierta incompleta → sin inferencia de cierres.
- Error de un lote del CLOB: se registran los tokens fallidos; el resto sigue.
- Mercados/libros inválidos: se registran y se excluyen; no detienen la corrida.
- Proceso interrumpido: la corrida queda `running`; la siguiente la marca
  `failed`. Como todo es idempotente, basta con volver a ejecutar.

## 8. Seguridad

- Sin secretos en el repositorio; `.env` está ignorado; `config` guardada en
  `ingestion_runs` redacta la contraseña de la base.
- Puertos de Docker publicados solo en `127.0.0.1`.
- Contenedores con usuario sin privilegios (uid 10001).
- Dependencias fijadas: directas con `==` en `pyproject.toml`; árbol completo con
  hashes en `uv.lock` y `requirements*.lock` (`pip --require-hashes`); imágenes
  base fijadas por digest.
- La API valida parámetros (patrones, rangos); no ejecuta SQL dinámico.

## 9. Diseño de módulos posteriores (no implementados)

- **B. Contratos:** estructura normalizada (`contract_terms`) derivada de reglas;
  relaciones propuestas (IA o heurística) con estado `proposed` y solo
  `verified` tras validaciones deterministas (mismo `neg_risk_market_id`,
  resultados exhaustivos declarados, misma fuente y fecha de resolución). El
  `rules_hash` ya permite invalidar relaciones cuando cambian las reglas.
- **C. Arbitraje:** usa `simulate_buy/simulate_sell` sobre los niveles guardados,
  pagos por escenario, comisiones según `fee_schedule` (fórmula pendiente de
  verificar contra la documentación oficial), y solo marca "verificado" si la
  ganancia mínima neta es > 0 en todos los escenarios y las reglas están
  verificadas.
- **D. Modelos:** interfaz `predict(market, evidence, as_of_time)` → estimación
  con intervalo, versión, datos usados, estado de calibración o abstención.
- **E–H.** Valoración, cartera virtual con ledger, backtesting cronológico,
  alertas deduplicadas: ver `IMPLEMENTATION_PLAN.md`.
