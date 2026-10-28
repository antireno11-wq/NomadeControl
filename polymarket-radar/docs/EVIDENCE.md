# Evidencia de funcionamiento

Secciones 1–7: hito 1 (ingesta). Sección 8: motor electoral (hito E). Sección 9: modelos
cripto y valoración (módulos D y E), en un Mac con la base en Railway. Sección 10:
corrección de la sincronización de la corrida en vivo.

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
| Electoral (hito E, ver §8) | ![Electoral](screenshots/06_electoral.png) |

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

## 8. Motor electoral (hito E) — 26-oct-2026 UTC

Detalle de reglas y resultados en [`ELECTORAL_ENGINE.md`](ELECTORAL_ENGINE.md).

### 8.1 Pruebas

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
# All checks passed! / 74 files already formatted

TEST_DATABASE_URL=postgresql+psycopg://radar:radar@localhost:5432/radar_test \
RADAR_LIVE_TESTS=1 .venv/bin/pytest -q
# 104 passed, 1 warning
```

- 33 pruebas nuevas en `tests/test_elections_*.py`: lectura de números y fechas
  (incluido "4,050" como miles), filas de resultado y de boca de urna nunca
  tratadas como encuestas, un extracto real de Wikipedia (revisión `1379945237`),
  Monte Carlo y validación, puertas de la señal operable, cadena de hashes,
  clasificación de mercados y un backtest sintético que verifica que una
  encuesta publicada después de T no entra en T.
- `test_election_endpoints` (PostgreSQL) cubre las 5 rutas `/api/elections/*`.
- La migración `0002_elections` coincide con los modelos (`test_migrations_db`).
- Pasos de CI en un entorno virtual limpio, instalando solo desde
  `requirements*.lock` con `--require-hashes` (incluye la nueva dependencia
  `lxml==6.0.2`): `102 passed, 2 skipped` (las 2 en vivo).
- Imagen Docker reconstruida con `lxml`; dentro de ella,
  `python -m radar.cli elections verify-ledger …` devuelve 111 registros y 0
  problemas.

### 8.2 Corridas reales

| Paso | Comando | Resultado |
|---|---|---|
| Descubrimiento | `radar elections discover` | 208.368 mercados revisados → 10.824 electorales en 1.847 eventos; 90 vinculados a Brasil 2026; 2 modelados |
| Calibración | `radar elections calibrate` | 9 segundas vueltas con resultado; Brier fuera de muestra 0,158; **no validado** (mínimo 15) |
| Backtest Brasil | `radar elections --out reports backtest` | 46 instantes, 28 revisiones, 44 con alerta, **0 señales operables** |
| Multi-elección | `radar elections --out reports evaluate` | 5 contiendas con mercado; Brier medio 0,339 (modelo) vs 0,347 (mercado) |
| Escaneo en vivo | `radar elections scan` | Se abstiene: "urnas cerradas: no se generan alertas" |

El backtest se ejecutó dos veces con la caché llena y dio los mismos instantes,
alertas, precios y probabilidades. Los hashes del ledger cambian entre corridas
porque incluyen la hora de creación de cada registro.

### 8.3 Ledger de alertas

```bash
radar elections verify-ledger data/alerts/backtest_br-2026-presidente-2t.jsonl
# {"registros": 111, "problemas": []}
```

Sobre una **copia** del ledger se cambió el precio del registro 1 y se borró el
registro 6; `verify-ledger` informó "alerta 1: contenido alterado (hash no
coincide)", "alerta 7: prev_sha256 no coincide" y los saltos de secuencia.

Ese ledger es **retrospectivo** (modo `backtest_retrospectivo`, generado el
26-oct, después del resultado). Prueba que el contenido no cambió desde que se
generó, pero no que existiera antes de la elección. Para eso, el ledger en vivo
tiene que publicarse fuera del sistema antes de cada cierre.

### 8.4 Dashboard

La pantalla **Electoral** (captura en §5) se renderizó con Playwright con 0
excepciones de Streamlit, 0 errores de JavaScript y 1 gráfico.

### 8.5 Lo que NO se verificó

- El escaneo en vivo con una contienda abierta: hoy no hay ninguna con fuente de
  encuestas configurada. Su lógica (VWAP del ask, spread, antigüedad del libro,
  congelado antes del cierre) solo está probada con libros sintéticos.
- Las horas de publicación fuera de Wikipedia: la revisión es una cota superior
  (`web.archive.org` no fue accesible desde este entorno).
- Libros de órdenes históricos: no existen en las APIs públicas, así que ningún
  precio del pasado es un ask ejecutable.

## 9. Modelos cripto y valoración (módulos D y E) — 26-oct-2026 UTC

Esta sección se ejecutó en un Mac (Apple Silicon, Python 3.12 con `uv`), con internet
desde Chile. La base de datos es PostgreSQL 18.6 en Railway: un proyecto aparte con dos
bases, una principal y otra solo para pruebas. Docker no se usó. Detalle de los modelos
y lectura de los resultados en [`PREDICTIVE_MODELS.md`](PREDICTIVE_MODELS.md) §5.

### 9.1 Pruebas

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
# All checks passed! / 101 files already formatted

TEST_DATABASE_URL=<base de pruebas en Railway> .venv/bin/pytest -q
# 159 passed, 2 skipped, 1 warning in 263.22s
```

- Las pruebas de base de datos hacen `DROP SCHEMA`. Por eso apuntan a una base de pruebas
  distinta, y antes de cada corrida se comprueba que su URL no sea la de la base
  principal.
- Las 2 omitidas son las pruebas en vivo (`RADAR_LIVE_TESTS` no estaba activo).
- Antes de los cambios de esta sección, la misma suite daba `158 passed, 2 skipped`. La
  diferencia es la prueba nueva del SHA-256 del conjunto.

### 9.2 Conjunto de mercados resueltos

```bash
radar predict collect --start 2026-05-01 --end 2026-10-26
```

- Duración: 2 h 47 min (16:42 a 19:29 UTC). El cliente usa tasas fijas de 4 req/s
  (Gamma) y 6 req/s (CLOB).
- 25.895 mercados, con 0 errores. Hay 56 eventos sin resolver y 12 contratos no
  interpretables.
- Por variante:

  | Variante | Mercados |
  |---|---:|
  | `daily_above` | 8.041 |
  | `daily_below` | 340 |
  | `daily_range` | 3.060 |
  | `hourly_above` | 5.616 |
  | `hourly_updown` | 712 |
  | `daily_updown` | 700 |
  | `touch_day` | 5.202 |
  | `touch_range` | 1.596 |
  | `touch_month` | 628 |

  Son **idénticos** a los de la corrida anterior en la nube.
- SHA-256 del conjunto: `7e45cb27dd8da77a101ed401233cd6a3ddba40df56c4e87aee17fff66b01c76a`.
  Coincide con el contenido descomprimido de `data/datasets/crypto_resolved_v1.json.gz`.

### 9.3 Backtest

```bash
radar predict --out reports backtest
```

| Corrida | Inicio (UTC) | Duración | Estado |
|---|---|---|---|
| #1 | 19:30 | ~10 min | Falló al guardar las métricas (ver abajo). Quedó `running` y se marcó `failed` a mano, con el error |
| #2 | 19:44 | 9 min 15 s | `success`, 45 evaluaciones guardadas |
| #4 | 20:54 | 9 min 9 s | `success`. Es la que queda en `reports/backtest_cripto.md` |

- **Por qué falló #1.** Un tramo de calibración vacío tiene `mean_p = NaN`, y PostgreSQL
  rechaza `NaN` dentro de JSON.
  - La corrección está solo en la persistencia: `_jsonable` convierte NaN e infinitos a
    `null`. El dashboard ya ignoraba esos tramos.
  - La corrida además queda marcada `failed` si falla al guardar; antes quedaba
    `running`.
  - La prueba `test_prediction_endpoints` ahora deja un tramo vacío a propósito.
  - No cambió ningún modelo, partición ni criterio.
- **Corrección del reporte.** El reporte mostraba el SHA-256 del conjunto vacío. Ahora lo
  calcula desde el archivo. La corrida #4 se repitió para eso.
- **Determinismo.** #2 y #4 dieron métricas, instancias y operaciones idénticas. Solo
  cambió el conteo de velas DVOL (5.756 → 5.757), porque pasó una hora más; esa vela es
  posterior a todos los momentos de predicción.
- Evidencia: 342.000 velas de 1 minuto por activo, con 0 huecos y 33 archivos de
  `data.binance.vision` con checksum verificado.

### 9.4 Ingesta en Railway

```bash
radar ingest
```

| | Corrida #1 (Railway) |
|---|---:|
| Inicio / fin (UTC) | 16:53 / 19:21 |
| Duración | 8.909 s |
| Descubierta completa | sí |
| Páginas de Gamma / eventos | 2.468 / 21.958 |
| Mercados abiertos descubiertos | **246.700** |
| Elegibles | 218.144 |
| Tokens pedidos / libros OK | 436.288 / 435.532 (99,83 %) |
| Libros faltantes | 756 |
| Analizados / pasan filtro de liquidez | 217.759 / **11.952** |
| Snapshots insertados | 23.904 |
| Estado | `partial` (por los 756 libros faltantes) |

- Tiempos por etapa: descubierta 5.992 s, eventos 273 s, libros 2.633 s, cierres 6 s.
- La corrida fue ~5 veces más lenta que la del 25-oct en la nube (§2). No se midió la
  causa; hay más latencia de red hasta Gamma y hasta la base en Railway.
- Tamaño de la base después de la ingesta, el backtest y la corrida en vivo: 1,8 GB.

### 9.5 Corrida en vivo

```bash
radar predict live
```

Datos de la corrida:

- Corrida #3, con `as_of` 19:54:00 UTC. Duró 59 min.
- Familias:

  | Familia | Mercados abiertos |
  |---|---:|
  | Deportes | 186.406 |
  | Elecciones | 9.754 |
  | Otros | 5.908 |
  | Cripto | 5.473 |
  | Macro | 4.134 |
  | Clima | 2.429 |
  | Corporativo | 2.201 |

  Las que no tienen modelo se abstienen con su motivo.
- Cripto:
  - 1.329 mercados interpretables.
  - 4.144 no interpretables. Los motivos principales son la resolución por Chainlink
    (2.752) y tipos de contrato no modelados (1.233).
  - Libros: 2.656 recibidos de 2.658.
- Recomendaciones:

  | Recomendación | Tokens |
  |---|---:|
  | Señal operable | **0** |
  | Alerta de investigación | 81 |
  | Sin ventaja | 2.463 |
  | Información insuficiente | 86 |
  | Abstención | 28 |

- Motivos más comunes de las alertas para no ser señal: el modelo no superó al mercado
  (78), modelo sin evaluar (61), ventaja conservadora no positiva (25) y no validado (12).

Hallazgos, pendientes de corregir:

- **Libros pedidos después del cierre del mercado.** Las velas se cargan hasta las 20:05
  y los libros llegan entre 20:06:17 y 20:06:30. Es decir, 12 min después del `as_of`.
  - 6 alertas (`hourly_updown` de las 3PM ET, que cerraron a las 20:00 UTC) comparan la
    predicción de las 19:54 con libros que ya reflejan el resultado.
  - Ejemplo: BTC estaba 12 US$ bajo la apertura de la vela, así que el modelo da 54,6 %
    a "Down". El ask de "Down" ya era 0,001.
  - No son discrepancias reales.
- **Libros viejos al valorar.** Al valorar, 2.417 de 2.544 libros tenían más de 3 min; la
  mediana fue 24 min. La puerta de antigüedad bloquea la señal, como corresponde, pero con
  este flujo casi ningún mercado puede llegar a ser señal.
- **Ningún mercado `hourly_above` abierto.** No se valoró ninguno, así que la liquidez real
  de esos mercados (§9.3, `PREDICTIVE_MODELS.md` §5) no se pudo observar.

### 9.6 Dashboard

La API (`:8001`) y el dashboard (`:8502`) corrieron contra la base de Railway. Se
tomaron capturas con Playwright y Chromium (1.500 px): ninguna pantalla mostró
excepciones de Streamlit ni errores de JavaScript.

| Pantalla | Captura |
|---|---|
| Oportunidades (corrida en vivo #3, filtro de alertas) | ![Oportunidades](screenshots/07_oportunidades.png) |
| Calidad predictiva (backtest #4, `daily_above`) | ![Calidad predictiva](screenshots/08_calidad_predictiva.png) |

La pantalla **Radar** todavía dice que la valoración "aún no está implementada (hitos 3 y
5)". Es texto anterior al módulo E y queda pendiente.

### 9.7 Lo que NO se verificó

- Si los precios de referencia de `hourly_above` eran ejecutables. Polymarket no publica
  libros históricos.
- La corrección de la sincronización de la corrida en vivo (§9.5). Se hizo después: §10.
- El scheduler contra Railway. Los servicios `launchd` del Mac siguen usando la base local.
- Las pruebas en vivo contra Gamma y CLOB (`RADAR_LIVE_TESTS=1`).

## 10. Sincronización de la corrida en vivo — 27-oct-2026 UTC

Corrige los dos problemas de §9.5. El flujo nuevo está descrito en
[`PREDICTIVE_MODELS.md`](PREDICTIVE_MODELS.md) §4 ("Corrida en vivo por tandas"). No
cambian los modelos, los parámetros, las particiones ni los criterios del preregistro.

### 10.1 Causa medida

Se midió con los registros de la corrida #3 en Railway: `predictions.created_at` y la
hora de cada valoración (`book_received_at + book_age_s`).

| Etapa, sumada sobre 1.329 mercados | Tiempo |
|---|---:|
| Cálculo de los 4 modelos | 78 s |
| Guardar las 4 predicciones de cada mercado (una sentencia y un viaje a Railway por fila) | 2.082 s |
| Guardar las valoraciones y pasar al mercado siguiente | 652 s |

El cálculo no era el problema. Lo lento era guardar fila por fila en una base remota,
con todos los libros ya pedidos al comienzo.

### 10.2 Cambio

- Los libros se piden por tandas de 50 mercados, en orden de cierre, justo antes de
  valorar cada tanda.
- Cada tanda tiene su propio `as_of`. Antes de fijarlo se ponen al día las velas: solo se
  piden las cerradas desde la última carga (`BinanceKlines.extend`). El DVOL se vuelve a
  pedir cuando cierra una hora nueva.
- Se descartan los mercados que cerraron antes de pedir su libro y los que cerraron
  mientras llegaba.
- La tanda se guarda después de valorarla, con una sentencia para las predicciones y otra
  para las valoraciones.
- El resumen de la corrida agrega `cerrados_antes_de_valorar`, `tandas` y
  `antiguedad_libro_s`. La pantalla Oportunidades muestra el primer y el último `as_of`.

### 10.3 Pruebas

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
# All checks passed! / 102 files already formatted

TEST_DATABASE_URL=<base local de pruebas> .venv/bin/pytest -q
# 161 passed, 2 skipped, 1 warning in 4.53s
```

- La suite corrió contra la base local de pruebas (PostgreSQL 15 en el Mac), no contra
  Railway.
- Son 2 pruebas más que en §9.1, ambas en `tests/test_predict_live.py`:
  - `test_extend_adds_only_new_closed_candles`: pide solo la cola de velas y nunca usa
    una vela que sigue abierta.
  - `test_live_run_values_each_batch_against_fresh_books`: usa un reloj simulado. La base
    tarda tanto que la segunda tanda empieza 5,5 h después, y un libro llega después del
    cierre de su mercado. La prueba comprueba cuatro cosas:
    - cada tanda pide solo sus libros;
    - se descartan los 4 mercados cerrados, sin pedir los libros de los que ya habían
      cerrado;
    - los libros tienen menos de 1 s al valorarse;
    - cada tanda predice en su propio `as_of`.
- Con el descarte desactivado a mano, la segunda prueba falla, como se esperaba.

### 10.4 Corrida real

La corrida se hizo contra la **base local**, la que el scheduler del Mac actualiza cada
hora, y no contra Railway. Cada corrida en vivo lee unos 1,5 GB de mercados abiertos
(medido con `octet_length` sobre las filas), y en Railway la salida de datos se cobra.

```bash
RADAR_DATABASE_URL=<base local> radar predict live
```

La corrida #43 es la última corrida automática del scheduler con el código anterior.

| | #43 (código anterior) | #44 (código nuevo) |
|---|---:|---:|
| Mercados cripto interpretables | 1.371 | 1.335 |
| Libros recibidos / pedidos | 2.742 / 2.742 | 2.670 / 2.670 |
| `as_of` | uno solo, 13:42:21 UTC | 27 tandas, de 14:01:56 a 14:02:45 UTC |
| Antigüedad del libro al valorar, mediana | 13,3 s | 0,09 s |
| Antigüedad del libro al valorar, máxima | 108,9 s | 39,8 s |
| Duración | 2 min 50 s | 2 min 37 s |
| Señales operables | 1 | 0 |
| Alertas de investigación | 88 | 77 |

- La máxima de 39,8 s es de la última tanda: 35 contratos de toque de largo plazo, en los
  que el modelo `bootstrap` tarda más. Queda bajo el límite de 180 s.
- Ningún mercado cerró durante la corrida (los dos descartes dieron 0). Ese caso solo lo
  cubre la prueba de §10.3.
- Las velas se pusieron al día durante la corrida: el último cierre usado pasó de 14:01 a
  14:02 UTC. Ninguna predicción usó una vela cerrada hace más de 60 s.
- En la base local el código anterior no fallaba tanto como en Railway, porque guardar
  es rápido. En Railway, la corrida #3 duró 59 min.

### 10.5 Lo que NO se verificó

- La corrida nueva contra Railway. Guardar debería ser mucho más rápido (dos sentencias
  por tanda en vez de seis por mercado), pero no se midió.
- Un mercado que cierre durante una corrida real.

## 11. Cartera de papel, evaluación en vivo y deportes/Fed — 27 y 28-oct-2026 UTC

Reglas en [`PREREGISTRO_VIVO.md`](PREREGISTRO_VIVO.md), escritas antes de calcular las
métricas en vivo (`forward-v1`, `paper-v1`) y antes de la primera corrida de deportes y Fed
(`ref-kalshi-v1`). Todo se ejecutó contra la base local. No cambian los modelos, parámetros
ni criterios cripto.

### 11.1 Primera evaluación en vivo (27-oct, ~19:50 UTC)

`radar predict forward` sobre las corridas en vivo guardadas (desde el 26-oct):

- 10.832 predicciones distintas usadas como instancias, de 1.285 mercados ya resueltos. Hubo
  42 mercados consultados a Gamma porque la base todavía no tenía su resolución.
- La cartera de papel abrió y cerró las 4 señales de las corridas #20, #42 y #43. Las 4
  ganaron: +US$53,73 sobre US$101,78. Coincide con la revisión a mano.
- Ningún par cumple todavía los criterios. El motivo principal es que hay pocos
  conglomerados (activo × día ET): el máximo era 12, y hacen falta 20.

### 11.2 Primera corrida con Kalshi (corrida #61, 27-oct)

- 640 cotizaciones de Kalshi y 211.277 mercados candidatos de deportes, política y economía.
- Emparejados: 330 de fútbol, 48 de NHL, 30 de NBA, 29 de NFL, 20 de la Fed y 1 de MLB.
- El resto queda sin par, con su motivo. Los más comunes son:
  - no es un partido ni una decisión de la Fed;
  - tipo de mercado no cubierto (por ejemplo "ambos marcan" o hándicap);
  - liga no cubierta (tenis ITF, fútbol universitario, básquetbol universitario).
- Revisión a mano de 40 pares al azar: en todos coincidían los equipos, el empate o la
  reunión de la Fed. Las probabilidades de Kalshi quedaron casi siempre a 1–2 p.p. del
  punto medio del libro de Polymarket.
- Las abstenciones fueron casi todas por spread de Kalshi > 0,10, sobre todo en partidos
  lejanos.

### 11.3 Funcionamiento sin supervisión (27-oct 21:48 → 28-oct 13:50 UTC)

El scheduler local se reinició con el código nuevo a las 21:48 UTC.

- **Corridas en vivo:** 30 exitosas y 2 fallidas, a las 12:21 y 12:51 UTC. Las dos fallaron
  porque el Mac no podía resolver nombres de dominio (sin internet) al pedir las velas de
  Binance. Quedaron registradas como `failed` y la siguiente corrida funcionó.
- **Cartera de papel:** 7 posiciones nuevas, todas de toque en la semana
  (`touch_range`, del 26-oct al 1-nov), por US$176,76. Siguen abiertas.
- **Corrida #125 (13:48 UTC):**

  | | Valoraciones |
  |---|---:|
  | Cripto | 2.680 |
  | Deportes | 862 |
  | Fed | 40 |

  En deportes y Fed hubo 0 señales, porque esas familias siguen en observación, y 3 alertas.
- **Evaluación en vivo #126:**
  - `hourly_updown` (ewma, el modelo que se usa) es **peor que el mercado** en vivo:
    - diferencia de log loss con IC [+0,010; +0,022];
    - n = 791 y 18 conglomerados.

    Todavía no se suspende, porque la regla exige 20 conglomerados. Igual ya no daba
    señales: no superó al mercado en el backtest.
  - `hourly_above`, `daily_above`, `daily_range` y `touch_day` son mejores que el punto medio
    del libro, pero tienen 4 a 8 conglomerados. Faltan días para validarlos.
- **Base local:** 6,5 GB. La poda empieza a borrar cuando hay datos de más de 2 días.

### 11.4 Pruebas

173 correctas y 2 omitidas (las 2 en vivo), contra PostgreSQL 15 local, en la base de pruebas
separada. Ruff sin avisos. Las pruebas nuevas cubren:

- la elección de instancias y el reemplazo por la predicción más cercana;
- la resolución oficial y el cierre de posiciones;
- la exposición máxima;
- la suspensión y la habilitación;
- el emparejamiento con Kalshi en EE.UU., fútbol y Fed, y las abstenciones;
- la poda.

### 11.5 Lo que NO se verificó

- La imagen Docker nueva (etapa `deploy`, `radar serve`) no se construyó: Docker no estaba
  corriendo. El despliegue en Railway no se hizo, porque espera la aprobación del costo.
- No se revisaron los términos de uso de la API de Kalshi para un uso que no sea personal.
- Política: no hay emparejamiento. Fútbol universitario, básquetbol universitario y tenis
  tampoco tienen, porque sus códigos no coinciden con Kalshi.
- Ningún par habilitado o suspendido en vivo todavía: faltan días.
