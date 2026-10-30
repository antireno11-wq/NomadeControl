# Preregistro: evaluación de modelos cripto (`crypto-backtest-v1`)

Escrito el 26-oct-2026 a las 13:25 UTC, **antes** de ejecutar el backtest sobre el conjunto
completo. Su SHA-256 queda registrado en el reporte del backtest. Cambiar cualquier regla
de esta página exige una nueva versión y declararlo en el reporte.

## Datos

- Mercados: eventos cripto **resueltos** de Polymarket con fin entre el 1-may y el 26-oct-2026
  (`crypto-dataset-v1`). Activos: BTC, ETH, SOL y XRP.
- Muestreo determinista, sin mirar resultados ni precios:
  - eventos horarios: una hora ET por día, la que coincide con (día del año mod 24);
  - el resto: todos los eventos de los tipos elegidos por activo.
- Resultado = resolución oficial de Polymarket (`outcomePrices` 1/0; 0,5/0,5 = empate).
  Se recalcula con las velas de Binance y se informa la tasa de coincidencia.
- Precio del mercado = `/prices-history` del token YES/Up. Es un precio de **referencia no
  ejecutable**. Antigüedad máxima: 15 min (resolución de 1 min), 1 h (10 min) y 6 h (60 min).
- Velas de 1 minuto de Binance spot (`data.binance.vision`, SHA-256 verificado) e índice
  DVOL horario de Deribit (BTC y ETH).

## Momentos de predicción (`crypto-schedule-v1`)

Distancias fijas antes del instante de resolución R:

| Variante | Momentos antes de R |
|---|---|
| Diarios a las 12:00 ET (sobre/bajo/rango) | 24 h, 12 h, 6 h, 3 h, 1 h, 15 min |
| Horario sobre un nivel | 60, 45, 30, 15 y 5 min |
| Up/Down horario | 70, 45, 30, 15 y 5 min |
| Up/Down diario | 24, 18, 12, 6 y 1 h |
| Toque en el día | 24, 18, 12, 6 y 2 h |
| Toque en la semana | 7 d, 5 d, 3 d, 1 d y 6 h |
| Toque en el mes | 28, 21, 14, 7, 3 y 1 d |

Se omiten los momentos anteriores a la creación del mercado y, en los toques, los
posteriores a que el nivel ya se haya alcanzado (el mercado ya está decidido).

## Modelos (`crypto-models-v1`)

Martingala sin deriva y cuatro formas de estimar la dispersión:

- `rv`: volatilidad realizada con retornos de 5 min;
- `ewma`: volatilidad con pesos exponenciales;
- `dvol`: volatilidad implícita (DVOL), solo BTC y ETH;
- `bootstrap`: 4.000 trayectorias por bootstrap estacionario de bloques de retornos
  reales de 30 días.

Fórmulas cerradas: log-normal para el precio final y principio de reflexión para el toque.

## Particiones

- Entrenamiento: instancias resueltas antes del 1-ago-2026.
- Validación: predichas desde el 1-ago y resueltas antes del 15-sep-2026.
- Prueba: predichas desde el 15-sep-2026.
- Se descartan las instancias que cruzan una frontera.

## Qué se ajusta en cada partición

- **Entrenamiento**, por tramo de horizonte (≤2 h, ≤1 d, ≤7 d, >7 d):
  - ventana de `rv` ∈ {1, 3, 7, 14, 30} días y vida media de `ewma` ∈ {6 h, 1 d, 3 d},
    elegidas por mínimo log loss;
  - cuantiles 10/90 del cociente "volatilidad realizada después / volatilidad estimada",
    usados para el intervalo.
- **Validación**: por variante, el modelo de referencia es el de mínimo log loss entre los
  que cubren al menos el 90 % de las instancias.
- **Prueba**: se mide una sola vez, sin cambios posteriores.

## Criterios de validación (prueba, por modelo y variante)

- n ≥ 200 y al menos 20 conglomerados (activo × día ET de resolución).
- ECE (10 tramos) ≤ 0,05.
- |calibración global| ≤ 0,03 y su IC del 95 % incluye 0.
- Brier menor que el de predecir siempre la tasa base de entrenamiento.

Para habilitar señales operables en vivo se exige además que el modelo **supere al mercado**:
diferencia de log loss frente al precio del mercado con IC del 95 % (bootstrap por
conglomerados) completamente por debajo de 0.

## Operaciones hipotéticas (solo prueba)

- Una por mercado, en el primer momento que cumpla las dos condiciones:
  - discrepancia bruta ≥ 5 p.p.;
  - probabilidad conservadora (cota del intervalo) mayor que el costo.
- Costo = precio de referencia + comisión del mercado (`0,07·p·(1−p)` en estos mercados)
  + 0,01 de holgura.
- Monto: US$25 por operación.
- Se informan como **hipotéticas**: no son ganancias realizadas.

## Exposición previa a datos de prueba (declaración)

Antes de este preregistro se hicieron dos pruebas de humo:

- `crypto-dataset-v1` sobre 2 días (20 al 22-oct-2026, dentro del período de prueba), sin
  precios, con parámetros por defecto, para verificar que el flujo funciona. Se vieron Brier
  y ECE de esas 1.488 instancias. Después de verlas **no** se cambió ninguna fórmula,
  parámetro ni criterio: solo se agregó caché (rendimiento) y el resto del sistema (API,
  valoración, dashboard).
- Una corrida en vivo sobre 40 mercados abiertos el 26-oct.

## Enmienda 1: redacciones anteriores de las reglas

Escrita el 26-oct-2026, alrededor de las 14:00 UTC, **antes** de correr la evaluación
sobre el conjunto completo.

**Qué se vio.** El primer armado del conjunto (SHA-256 `a5e0a5c4…`, 15.302 mercados) dejó
fuera, por redacción no reconocida:

- 7.469 mercados diarios "sobre un nivel" y 2.718 de rango, casi todos de meses
  anteriores;
- 390 toques y 24 Up/Down diarios.

Hasta ese momento solo se habían visto esos conteos y los textos de las reglas. **No** se
vieron resultados, precios ni métricas de esos mercados.

**Qué se cambió en `crypto-terms-v1`.** Se agregó la lectura de esas redacciones, con una
interpretación fijada antes de contrastar resultados:

- "la vela de 1 minuto … 12:00 ET" es la vela que **abre** a las 12:00, porque Binance
  etiqueta las velas por su apertura (`rule_form = vela_etiquetada_12:00`). La redacción
  actual, "la vela que **cierra** a las 12:00", sigue siendo la vela que abre a las 11:59
  (`vela_que_cierra_12:00`);
- en el Up/Down diario antiguo, "la vela que cierra a las 12:00 ET" en ambos días abre a
  las 11:59;
- en los toques, "desde la creación del mercado hasta el último día del mes / del rango"
  empieza en la creación del mercado (`desde_creacion`).

**Qué se informa.** El reporte muestra la coincidencia con la resolución oficial para cada
forma de regla y para las dos lecturas alternativas (vela anterior y vela siguiente). Si
una lectura no coincide, se informa; no se reemplaza a posteriori.

No cambian los modelos, las particiones, los criterios ni la regla de operaciones
hipotéticas. El conjunto se reconstruye con el mismo plan de muestreo.
