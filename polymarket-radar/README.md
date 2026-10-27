# Polymarket AI Radar

Plataforma de investigación sobre mercados de predicción de Polymarket:
ingesta sistemática de mercados y order books, análisis de liquidez y, en hitos
posteriores, arbitraje, modelos predictivos, valoración, cartera virtual y
backtesting.

> **Solo lectura y simulación.** No ejecuta operaciones con dinero real, no
> contiene autenticación de trading ni envío de órdenes, y `RADAR_TRADING_MODE`
> solo admite `paper` (cualquier otro valor aborta el arranque).

**Estado:**

- Hito 1 completo: ingesta real, almacenamiento, liquidez, API, dashboard y pruebas.
- **Motor electoral** implementado, para segundas vueltas de dos candidatos.
- **Modelos predictivos cripto** (módulo D) evaluados fuera de muestra.
- **Valoración en papel** (módulo E) contra libros del CLOB.
- Las demás familias de mercados se abstienen con su motivo.
- Arbitraje, cartera virtual y backtesting general **no están implementados**. El
  dashboard lo indica y no muestra cifras para ellos. Plan completo en [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md),
diseño en [`ARCHITECTURE.md`](ARCHITECTURE.md), reglas para colaboradores en
[`AGENTS.md`](AGENTS.md).

## Motor de discrepancias electorales (nuevo)

Detecta mercados electorales, estima probabilidades a partir de encuestas
calibradas con errores históricos y las compara con precios de Polymarket.
Documentación completa, reglas preregistradas y resultados en
[`docs/ELECTORAL_ENGINE.md`](docs/ELECTORAL_ENGINE.md).

Resultado del backtest retrospectivo de la segunda vuelta de Brasil 2026
(46 instantes, solo información disponible en cada momento): **no habría
generado ninguna señal operable**, porque el modelo no está validado (9 contiendas
de calibración, mínimo 15) y no existe ask ejecutable histórico. Sí habría
emitido **alertas de investigación** desde el 5-oct 12:00 UTC (Lula YES a 0,165,
precio de referencia). Es una sola elección: no prueba calibración ni rentabilidad.

```bash
radar elections discover
radar elections --out reports backtest
radar elections --out reports evaluate
```

## Modelos predictivos cripto y valoración (nuevo)

Estiman la probabilidad de contratos cripto de Polymarket con velas de Binance y DVOL de
Deribit:

- tipos de contrato: precio final, rango, Up/Down y toque;
- datos de entrada: velas de 1 minuto de Binance spot y el índice DVOL de Deribit;
- comparación: contra el ask ejecutable del CLOB.

Las reglas de evaluación se fijaron antes de mirar la prueba. Documentación y resultados:

- [`docs/PREDICTIVE_MODELS.md`](docs/PREDICTIVE_MODELS.md)
- [`docs/PREREGISTRO_CRIPTO.md`](docs/PREREGISTRO_CRIPTO.md)
- [`reports/backtest_cripto.md`](reports/backtest_cripto.md)

Resultado fuera de muestra (26-oct-2026: 25.895 mercados resueltos, 30.928 instancias de
prueba entre el 15-sep y el 26-oct):

- **22 de 36** pares (modelo, tipo de contrato) quedan **validados**, es decir, bien
  calibrados.
- En la mayoría de los contratos el modelo **empata con el precio del mercado**.
- La gran diferencia está en los contratos horarios "sobre un nivel". Ahí el precio de
  referencia histórico parece no ser ejecutable, y no se puede verificar porque no hay
  libros históricos.
- Las 1.896 operaciones **hipotéticas** dan +US$29.860 sobre US$47.400. Salen casi
  todas de ese tipo de contrato y **no son evidencia de rentabilidad**.

La primera corrida en vivo dio **0 señales operables**. Mostró un problema de
sincronización: los libros se pedían unos 12 min después de la predicción y se valoraban
hasta 1 h después (`docs/EVIDENCE.md` §9.5). Se corrigió el 27-oct: ahora la corrida va
por tandas de 50 mercados y pide los libros de cada tanda justo antes de valorarla
(`docs/EVIDENCE.md` §10).

```bash
radar predict collect --start 2026-05-01 --end 2026-10-26   # ~3 h
radar predict --out reports backtest                        # ~10 min
radar predict live                                          # ~3 min con base local
```

## Qué hace hoy (verificado)

- Recorre **todos** los mercados abiertos de Gamma (`/markets/keyset`, cursor,
  100 por página) y sus eventos con etiquetas; valida cada registro; detecta
  nuevos, cambios de reglas, cierres (confirmados por id) y desaparecidos.
- Descarga los order books del CLOB (`POST /books`, lotes de 200) de todos los
  mercados elegibles; calcula bid/ask, spread, mid, profundidad total y cercana,
  y el precio promedio ejecutable (VWAP) para un monto de referencia.
- Aplica filtros deterministas de elegibilidad y liquidez y guarda los motivos.
- Guarda snapshots con timestamp de la fuente y de recepción, deduplicados.
- Registra cada corrida con su embudo de cobertura, errores y tiempos.
- Expone todo por una API FastAPI y un dashboard Streamlit, y genera reportes
  Markdown desde la base.

## Inicio rápido (Docker)

Requisitos: Docker con Compose v2.24+.

```bash
cd polymarket-radar
cp .env.example .env            # opcional: ajustar contraseña, puertos, filtros
docker compose up -d --build    # db, migrate, api, scheduler, dashboard
docker compose ps               # api debe quedar "healthy"
docker compose logs -f scheduler
```

- Dashboard: <http://localhost:8501>
- API (documentación interactiva): <http://localhost:8000/docs>

El `scheduler` lanza una ingesta completa al arrancar y luego cada
`RADAR_SCHEDULE_INTERVAL_MINUTES` (60 por defecto). Con el universo actual
(~241.000 mercados abiertos) una corrida completa tarda **~25–35 minutos**;
mientras corre, el dashboard muestra el progreso parcial.

Comandos útiles dentro del stack:

```bash
docker compose exec api python -m radar.cli check                 # base + APIs
docker compose exec api python -m radar.cli ingest --max-pages 10 # corrida manual corta
docker compose exec api python -m radar.cli status                # última corrida (JSON)
docker compose exec -T api python -m radar.cli report --out - > reports/ultimo.md
docker compose --profile test run --rm tests                      # suite de pruebas
docker compose down        # detiene (los datos quedan en el volumen pgdata)
docker compose down -v     # detiene y BORRA la base
```

Una corrida manual y una programada no pueden superponerse (lock consultivo de
PostgreSQL): la segunda termina con código 2 y el mensaje "ya hay una ingesta en curso".

### Red con inspección TLS (proxy corporativo)

Si `pip` falla en el build con `CERTIFICATE_VERIFY_FAILED`, pase la CA de su red
como secreto de build, y móntela en tiempo de ejecución:

```bash
docker build --secret id=extra_ca,src=/ruta/ca.pem --target runtime -t polymarket-radar:0.1.0 .
# en tiempo de ejecución: montar la CA y definir SSL_CERT_FILE en los servicios
```

## Ejecución local (sin Docker)

Requisitos: Python 3.12 y PostgreSQL 16 (por ejemplo `docker compose up -d db`,
que publica el puerto 5433).

```bash
cd polymarket-radar
uv sync                                  # o: python3.12 -m venv .venv && \
                                         #    .venv/bin/pip install --require-hashes -r requirements.lock -r requirements-dev.lock && \
                                         #    .venv/bin/pip install --no-deps -e .
export RADAR_DATABASE_URL=postgresql+psycopg://radar:radar@localhost:5433/radar
.venv/bin/radar db-upgrade
.venv/bin/radar check
.venv/bin/radar ingest --max-pages 20 --report   # corrida corta; sin --max-pages = completa
.venv/bin/radar api &                            # http://127.0.0.1:8000
.venv/bin/radar dashboard                        # http://127.0.0.1:8501
```

### Base de datos externa (p. ej. Railway)

Con un PostgreSQL administrado, use la URL **pública** del servicio (en Railway,
`DATABASE_PUBLIC_URL`, que requiere un proxy TCP). Cambie el prefijo `postgresql://`
por `postgresql+psycopg://` y guárdela como `RADAR_DATABASE_URL` en `.env`, que no se
versiona.

Las pruebas de base de datos hacen `DROP SCHEMA`. `TEST_DATABASE_URL` debe apuntar a
**otra** base, nunca a la principal. Después de la primera ingesta completa, más un
backtest y una corrida en vivo, la base ocupaba 1,8 GB (`docs/EVIDENCE.md` §9.4).

## CLI

| Comando | Qué hace |
|---|---|
| `radar db-upgrade` | Aplica las migraciones Alembic |
| `radar check` | Comprueba base, Gamma y CLOB; código ≠ 0 si algo falla |
| `radar ingest [--max-pages N] [--report]` | Corrida manual; `--max-pages` marca la descubierta como incompleta |
| `radar report [--run-id N] [--out DIR\|-]` | Reporte Markdown de una corrida, generado desde la base |
| `radar status` | Última corrida en JSON |
| `radar scheduler` | Ingesta periódica |
| `radar api` / `radar dashboard` | Servidores |
| `radar elections …` | Motor electoral (ver arriba) |
| `radar predict collect [--start --end]` | Conjunto de mercados cripto resueltos (Gamma + `/prices-history`) |
| `radar predict --out reports backtest` | Ajuste (entrenamiento), elección (validación) y medición (prueba) de los modelos cripto |
| `radar predict live [--max-markets N]` | Predice los mercados abiertos y los valora contra libros pedidos en el momento |

## API

| Endpoint | Contenido |
|---|---|
| `GET /api/health` | Base de datos, versión, `trading_mode: paper_only` |
| `GET /api/connectivity` | Prueba en vivo de base, Gamma y CLOB |
| `GET /api/status` | Modo de datos (`datos_reales` / `demo_sintetica` / `sin_datos`), última corrida terminada, corrida en curso, estado por fuente |
| `GET /api/runs`, `/api/runs/{id}`, `/api/runs/{id}/errors` | Corridas, embudo y errores |
| `GET /api/markets` | Mercados analizados; filtros `liquid_only`, `category`, `search`, `sort`, paginación |
| `GET /api/markets/{id}` | Reglas exactas, estado, fechas, parámetros, evaluación de liquidez, último libro por token, valores indicativos de Gamma separados |
| `GET /api/markets/{id}/snapshots` | Historial de snapshots |
| `GET /api/categories` | Analizados y líquidos por categoría |
| `GET /api/elections/*` | Motor electoral: resumen, mercados, backtest, evaluación, alertas |
| `GET /api/predict/summary` | Última corrida en vivo (cobertura por familia, abstenciones) y último backtest |
| `GET /api/opportunities` | Valoraciones de la última corrida en vivo; filtros `recommendation`, `min_edge_pp` |
| `GET /api/predict/quality` | Métricas fuera de muestra por modelo y tipo de contrato, con la referencia del mercado |
| `GET /api/markets/{id}/predictions` | Predicciones registradas de un mercado (con datos usados) |

## Dashboard

- **Radar**: mercados encontrados / filtrados / analizados / líquidos, última
  actualización, estado de conexiones (y prueba en vivo), embudo, categorías.
- **Mercados**: tabla ordenable y filtrable con bid/ask ejecutables, spread,
  profundidad, VWAP de referencia, motivos de rechazo y enlace a Polymarket.
- **Detalle**: reglas exactas, fuente, timestamps, libros con gráfico de
  profundidad, evolución de precios, motivos de aceptación/rechazo.
- **Ingesta**: historial de corridas, motivos, tiempos y errores.
- **Electoral**: estado de validación, mercados electorales clasificados,
  respuesta directa del backtest de Brasil 2026, gráfico modelo vs. mercado,
  alertas congeladas con su hash y evaluación sobre varias elecciones.
- **Oportunidades**: tabla ordenable con mercado, categoría, precio ejecutable,
  probabilidad estimada e intervalo, diferencia en p.p., valor esperado neto y
  conservador, liquidez, confianza del modelo, recomendación, motivo y enlace;
  cobertura por familia con los motivos de abstención.
- **Calidad predictiva**: Brier, log loss, ECE y calibración global con IC por
  conglomerados; curva de calibración frente al mercado; desempeño por modelo;
  resultado hipotético; abstenciones y contraste del resultado oficial con Binance.
- **Cartera virtual**: marcada como no implementada; no muestra datos.

Un banner indica siempre si hay datos reales, datos sintéticos o ningún dato.

## Configuración principal

Todas las variables usan el prefijo `RADAR_` (ver `.env.example` y `src/radar/config.py`).

| Variable | Defecto | Uso |
|---|---|---|
| `RADAR_DATABASE_URL` | `postgresql+psycopg://radar:radar@localhost:5432/radar` | Base de datos |
| `RADAR_SCHEDULE_INTERVAL_MINUTES` | 60 | Intervalo del scheduler |
| `RADAR_GAMMA_MAX_PAGES` | vacío (todas) | Tope de páginas (marca la corrida incompleta) |
| `RADAR_CLOB_CONCURRENCY` | 4 | Solicitudes concurrentes a `/books` |
| `RADAR_GAMMA_RATE_PER_S` / `RADAR_CLOB_RATE_PER_S` | 8 / 8 | Rate limit por API |
| `RADAR_HTTP_MAX_RETRIES` | 5 | Reintentos con backoff exponencial |
| `RADAR_LIQ_MAX_SPREAD` | 0.05 | Spread máximo por token |
| `RADAR_LIQ_DEPTH_BAND` / `RADAR_LIQ_MIN_DEPTH_USD` | 0.02 / 100 | Profundidad mínima por lado cerca del mejor precio |
| `RADAR_REFERENCE_NOTIONAL_USD` | 100 | Monto para el VWAP de referencia |
| `RADAR_SNAPSHOT_SCOPE` | `liquid` | `liquid` o `analyzed` |
| `RADAR_SNAPSHOT_STORE_LEVELS` / `RADAR_SNAPSHOT_MAX_LEVELS` | `liquid` / 50 | Niveles guardados por lado |

## Pruebas

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
TEST_DATABASE_URL=postgresql+psycopg://radar:radar@localhost:5433/radar_test .venv/bin/pytest
RADAR_LIVE_TESTS=1 .venv/bin/pytest -m live      # contra las APIs reales
```

- Unitarias (sin red ni base): cliente HTTP (429/`Retry-After`, 5xx, 403
  Cloudflare, errores de red, JSON inválido, rate limiter), parsers de Gamma y
  CLOB con **respuestas reales capturadas** (`tests/fixtures/real_sample.json`,
  con procedencia), métricas del libro, VWAP y llenados parciales, filtros,
  categorías, bloqueo del modo papel.
- Integración con PostgreSQL y APIs **falsas con datos sintéticos**
  (`tests/fakes.py`): embudo exacto, idempotencia, deduplicación, cierres
  confirmados vs. no confirmados, descubierta incompleta, caída de Gamma o del
  CLOB, lock de concurrencia, corridas interrumpidas, API y reporte.
- Sin `TEST_DATABASE_URL` las pruebas de base se **omiten** (y pytest lo informa).

## Evidencia de funcionamiento

Ver [`docs/EVIDENCE.md`](docs/EVIDENCE.md): comandos ejecutados, resultados de
pruebas, corrida real completa, verificación del stack Docker, reinicio sin
duplicados y capturas del dashboard. El reporte real está en [`reports/`](reports/).

## Recuperación ante fallos

| Situación | Qué pasa | Qué hacer |
|---|---|---|
| Gamma o CLOB caídos / 429 | Reintentos con backoff; luego error registrado; corrida `partial` o `failed` | Nada: la próxima corrida reintenta. Ver pantalla Ingesta |
| Proceso interrumpido | La corrida queda `running` | La siguiente corrida la marca `failed` ("interrumpida"); volver a ejecutar es seguro |
| Descubierta incompleta | No se infieren cierres | Ejecutar otra corrida completa |
| "ya hay una ingesta en curso" | Lock tomado por otra corrida | Esperar; si el proceso murió, el lock se libera con su conexión |
| 403 "error code: 1010" | Cloudflare rechaza el User-Agent | Mantener `RADAR_USER_AGENT` explícito |
| Respaldo | — | `docker compose exec db pg_dump -U radar radar > backup.sql` |
| Restaurar | — | `docker compose exec -T db psql -U radar radar < backup.sql` |
| Base corrupta o esquema roto | — | `docker compose down -v && docker compose up -d` (se pierde el historial) |

## Limitaciones conocidas

- Los libros se piden en lotes a lo largo de varios minutos: **no** son una foto
  simultánea del mercado; cada snapshot lleva su propio timestamp.
- Pasar el filtro de liquidez no implica oportunidad alguna.
- Las comisiones (`fee_schedule`) se guardan, pero no se aplican todavía: su
  fórmula debe verificarse contra la documentación oficial antes del hito 3.
- La categoría proviene de etiquetas de Gamma con una regla simple (`tags-v1`).
