# Evidencia de funcionamiento — hito 1

Todo lo de esta página se ejecutó el **25-oct-2026 (UTC)** en un contenedor
Linux con acceso a internet, contra las APIs públicas reales de Polymarket.
Los números provienen de la base de datos (`ingestion_runs`) o de la salida de
los comandos indicados; no hay cifras estimadas.

## 1. Pruebas automáticas y lint

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
# All checks passed! / 46 files already formatted

TEST_DATABASE_URL=postgresql+psycopg://radar:radar@localhost:5432/radar_test \
RADAR_LIVE_TESTS=1 .venv/bin/pytest -v
# ======================== 70 passed, 1 warning in 5.42s =========================
```

- 70 pruebas: 48 unitarias, 20 de integración con PostgreSQL 16 y 2 en vivo
  contra Gamma y CLOB reales. El aviso es una deprecación de
  `starlette.testclient` (no afecta).
- Dentro de Docker (`docker compose --profile test run --rm tests`, sin las
  pruebas en vivo): `68 passed, 2 skipped`.
- Pasos de CI reproducidos en un entorno virtual limpio instalando solo desde
  `requirements*.lock` con `--require-hashes`: `68 passed, 2 skipped`.

## 2. Corridas reales completas

Dos corridas completas consecutivas (`radar ingest --report`), sin tope de
páginas, sobre una base vacía:

| | Corrida #1 | Corrida #2 |
|---|---:|---:|
| Inicio (UTC) | 22:20:24 | 22:47:19 |
| Duración | 1.577 s | 1.682 s |
| Descubierta completa | sí | sí |
| Páginas de Gamma | 2.417 | 2.421 |
| Mercados abiertos descubiertos | **241.681** | **242.077** |
| Inválidos / duplicados | 0 / 0 | 0 / 0 |
| Nuevos | 241.681 | 1.859 |
| Cierres confirmados por id | 0 | **1.463** |
| Desaparecidos sin confirmar | 0 | 0 |
| Elegibles | 208.765 | 208.368 |
| Tokens pedidos al CLOB | 417.530 | 416.736 |
| Libros OK | 417.398 (99,97 %) | 416.688 (99,99 %) |
| Libros faltantes / fallidos | 132 / 0 | 48 / 0 |
| Mercados analizados | 208.697 | 208.344 |
| Pasan filtro de liquidez | 9.901 | 9.762 |
| Snapshots insertados / sin cambios | 19.802 / 0 | 17.480 / 2.044 |
| Errores registrados | 132 | 48 |
| Estado | `partial` | `partial` |

- Reportes generados desde la base: [`reports/ingestion_run_1_20261025T2220Z.md`](../reports/ingestion_run_1_20261025T2220Z.md)
  y [`reports/ingestion_run_2_20261025T2247Z.md`](../reports/ingestion_run_2_20261025T2247Z.md).
- Ambas quedan `partial` porque la regla exige 0 errores para `success` y hubo
  tokens sin libro: el CLOB no devolvió libro para 132 y 48 tokens de mercados
  que Gamma marca `acceptingOrders=true` (p. ej. elecciones presidenciales de
  Bulgaria que cierran el 26-oct). Cada uno quedó registrado con su token.
- Tiempos por etapa (corrida #2): eventos 66 s, descubierta 1.274 s, cierres
  11 s, libros 331 s.

## 3. Reinicio sin duplicar registros

Después de las dos corridas completas:

```
 markets | uniq   | tokens | events | snaps | dup_snaps | closed | missing
---------+--------+--------+--------+-------+-----------+--------+---------
  243540 | 243540 | 486992 |  22294 | 37282 |         0 |   1463 |       0
```

- 243.540 = 241.681 (corrida #1) + 1.859 nuevos (corrida #2): ningún mercado
  duplicado; 0 snapshots repetidos por (token, timestamp de la fuente, hash);
  2.044 libros idénticos no se reinsertaron.
- Stack Docker: tras `docker compose restart scheduler` (que lanza otra corrida
  al arrancar) los conteos de mercados/tokens/eventos siguieron en 500/1000/501 y
  `markets_new` fue 0.

## 4. Stack Docker

```bash
docker compose up -d --build
docker compose ps
# api        running   Up (healthy)   127.0.0.1:8001->8000/tcp
# dashboard  running   Up             127.0.0.1:8502->8501/tcp
# db         running   Up (healthy)   127.0.0.1:5433->5432/tcp
# scheduler  running   Up
docker compose logs migrate      # Running upgrade  -> 0001 ... migraciones aplicadas hasta head
docker compose logs scheduler    # ingestion_finished discovered=500 eligible=498 analyzed=498 liquid=224 errors=0
docker compose exec -T api python -m radar.cli check   # database/gamma/clob: ok=true
```

Notas honestas sobre esta verificación:

- Se usaron los puertos 8001/8502 (`RADAR_API_PORT`, `RADAR_DASHBOARD_PORT`)
  porque 8000/8501 estaban ocupados por la instancia local.
- El sandbox de verificación intercepta TLS. Para construir se pasó su CA como
  secreto de build (`--secret id=extra_ca`, soportado por el `Dockerfile`) y, en
  tiempo de ejecución, un archivo override **no incluido en el repositorio**
  montó esa CA (`SSL_CERT_FILE`) y limitó la ingesta a 5 páginas
  (`RADAR_GAMMA_MAX_PAGES=5`) para no duplicar la carga sobre las APIs mientras
  corría la ingesta completa local. En una red sin inspección TLS no hace falta.
- La corrida completa a escala real (sección 2) se ejecutó con el mismo código
  fuera de Docker, contra PostgreSQL 16 local.

## 5. Dashboard (datos reales)

| Pantalla | Captura |
|---|---|
| Radar | ![Radar](screenshots/01_radar.png) |
| Mercados y liquidez | ![Mercados](screenshots/02_mercados.png) |
| Detalle (reglas, libros, profundidad, historial) | ![Detalle](screenshots/03_detalle.png) |
| Ingesta (corridas, motivos, errores) | ![Ingesta](screenshots/04_ingesta.png) |
| Pantallas no implementadas | ![Pendiente](screenshots/05_oportunidades_no_implementado.png) |

Las capturas se tomaron con Playwright/Chromium; ninguna pantalla lanzó
excepciones de Streamlit ni errores de JavaScript.

Latencia de la API con el volumen real (con una ingesta en paralelo):
`/api/status` 0,12 s · `/api/markets` (líquidos) 0,22 s · `/api/markets/{id}`
0,01 s · `/api/categories` 0,27 s · listar los 208k analizados ordenados por
volumen 3,8 s (mejora pendiente: índices).

## 6. Hallazgos de los datos reales

1. **Escala**: ~242.000 mercados abiertos; 85 % de los analizados (177.874 de
   208.344) son de deportes.
   Solo el 4,7 % de los analizados pasa el filtro de liquidez por defecto.
2. **Libros YES/NO espejo**: en la corrida #2, de 208.344 mercados binarios
   analizados, ninguno tuvo `ask_YES + ask_NO < 1` (mínimo 1,001) ni
   `bid_YES + bid_NO > 1` (máximo 0,999); 8.737 de 8.740 pares de snapshots
   guardados son espejo exacto (`bid_YES = 1 − ask_NO`). En esos snapshots no
   hubo desajustes YES/NO explotables al mejor precio. Es una medición sobre
   libros no simultáneos: no prueba que nunca ocurran.
3. **Comisiones activas** en parte del universo (p. ej. `fee_type`
   `sports_fees_nfl_cfb_oct26`, `rate: 0.03`, `takerOnly`): el hito 3 debe
   aplicar comisiones antes de evaluar cualquier arbitraje.
4. **Gamma**: `/markets?offset` está deprecado (`warning: use /markets/keyset`);
   el keyset entrega como máximo 100 por página; Cloudflare devuelve 403
   `error code: 1010` al User-Agent por defecto de `urllib`.
5. **Vía por eventos**: no es equivalente al listado canónico (ver
   `ARCHITECTURE.md` §5): los ~32.000 mercados extra son mayormente `active=false`.

## 7. Lo que NO se verificó

- Ejecución continua del scheduler durante días (solo se verificó el arranque y
  una corrida programada).
- Comportamiento ante límites de tasa reales sostenidos: en las dos corridas no
  hubo ningún reintento (0 eventos `http_retryable_status` ni
  `http_transport_error_retry` en los logs), así que el backoff solo está probado
  con pruebas sintéticas.
- El build Docker en una red sin inspección TLS (se usó el secreto de CA).
