# Polymarket AI Radar

Plataforma de investigación sobre mercados de predicción de Polymarket:
ingesta sistemática de mercados y order books, análisis de liquidez y, en hitos
posteriores, arbitraje, modelos predictivos, valoración, cartera virtual y
backtesting.

> **Solo lectura y simulación.** No ejecuta operaciones con dinero real, no
> contiene autenticación de trading ni envío de órdenes, y `RADAR_TRADING_MODE`
> solo admite `paper` (cualquier otro valor aborta el arranque).

**Estado: hito 1 completo** (ingesta real, almacenamiento, liquidez, API,
dashboard, pruebas). Los módulos de arbitraje, modelos, valoración, cartera,
backtesting y alertas **no están implementados**; el dashboard lo indica y no
muestra cifras para ellos. Plan completo en [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md),
diseño en [`ARCHITECTURE.md`](ARCHITECTURE.md), reglas para colaboradores en
[`AGENTS.md`](AGENTS.md).

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

## Dashboard

- **Radar**: mercados encontrados / filtrados / analizados / líquidos, última
  actualización, estado de conexiones (y prueba en vivo), embudo, categorías.
- **Mercados**: tabla ordenable y filtrable con bid/ask ejecutables, spread,
  profundidad, VWAP de referencia, motivos de rechazo y enlace a Polymarket.
- **Detalle**: reglas exactas, fuente, timestamps, libros con gráfico de
  profundidad, evolución de precios, motivos de aceptación/rechazo.
- **Ingesta**: historial de corridas, motivos, tiempos y errores.
- **Oportunidades / Cartera virtual / Calidad predictiva**: marcadas como no
  implementadas; no muestran datos.

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
