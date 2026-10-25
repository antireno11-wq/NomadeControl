# AGENTS.md — reglas para agentes y colaboradores

Este directorio (`polymarket-radar/`) es un proyecto Python independiente del
resto del repositorio (la app Next.js de Nómade vive en la raíz). No mezclar
dependencias ni configuración entre ambos.

## Reglas no negociables

1. **Nunca inventar** precios, volúmenes, probabilidades, noticias ni resultados.
   Sin dato → `null` en la API y "Información insuficiente" en la UI.
2. **Etiquetar el origen** de todo dato: `data_origin` = `real` | `historical` |
   `synthetic`, más `source` y timestamps (de la fuente y de recepción).
3. **Precio ejecutable = order book del CLOB.** Nunca usar `lastTradePrice`,
   `outcomePrices` ni el midpoint como precio de entrada.
4. **Sin trading real.** No agregar autenticación de trading, claves, firmas ni
   llamadas a endpoints de órdenes. `RADAR_TRADING_MODE` solo admite `paper` y
   `tests/test_config.py` falla si aparecen palabras como `post_order`.
5. **No declarar arbitraje** sin reglas verificadas, pagos en todos los
   escenarios y costos ejecutables. **No declarar rentabilidad** sin pruebas
   fuera de muestra. **No usar información futura** en backtesting.
6. **Una probabilidad generada libremente por un LLM no es una estimación
   calibrada**: solo puede ser una propuesta marcada como tal.
7. **Fallos y cobertura incompleta se registran y se muestran**, nunca se ocultan.
8. **No afirmar que algo funciona sin haberlo ejecutado.** Documentar comandos y
   resultados reales.

## Convenciones

- Python 3.12, tipado, `ruff` (línea 100). Textos de usuario y documentación en
  español.
- Lógica pura y determinista en `radar.market.*` (sin E/S), probada con tests
  unitarios. E/S en `radar.ingestion.*`, `radar.api`, `radar.dashboard`.
- Toda llamada externa pasa por `radar.ingestion.http.ApiClient` (rate limit,
  reintentos, User-Agent explícito).
- Cambios de esquema: modificar `radar/db/models.py` y crear una migración
  Alembic nueva (`alembic revision --autogenerate`, revisar a mano).
  `tests/test_migrations_db.py` verifica que ambos coinciden.
- Datos de prueba: sintéticos en `tests/fakes.py` (marcados "SINTÉTICO");
  muestras reales en `tests/fixtures/` con `_provenance`.

## Comandos

```bash
uv sync                                   # entorno con dependencias fijadas
.venv/bin/ruff check . && .venv/bin/ruff format --check .
TEST_DATABASE_URL=postgresql+psycopg://radar:radar@localhost:5433/radar_test .venv/bin/pytest
RADAR_LIVE_TESTS=1 .venv/bin/pytest -m live   # contrato de las APIs reales
docker compose --profile test run --rm tests  # suite completa en contenedor
```

## Antes de entregar un cambio

- Pruebas y lint en verde (incluidas las de base de datos).
- Si toca la ingesta: una corrida real (aunque sea `--max-pages`) y su reporte.
- Actualizar `IMPLEMENTATION_PLAN.md` con lo verificado y lo pendiente.
