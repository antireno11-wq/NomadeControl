# Preregistro: evaluación en vivo (`forward-v1`) y cartera de papel (`paper-v1`)

Escrito el 27-oct-2026, alrededor de las 19:40 UTC, **antes** de calcular cualquier métrica
sobre las predicciones en vivo. Cambiar cualquier regla de esta página exige una nueva versión
y declararlo.

## Exposición previa (declaración)

- Se vieron los conteos de recomendaciones de cada corrida en vivo (señales, alertas, etc.).
- Se revisaron a mano las 4 señales operables de papel de las corridas #20, #42 y #43: las 4
  acertaron (+US$53,72 sobre US$101,79 si se hubieran comprado).
- **No** se calcularon Brier, log loss, calibración ni comparaciones con el mercado de las
  predicciones en vivo.

## Para qué sirve

El backtest (`crypto-backtest-v1`) mide los modelos con datos pasados. Esta evaluación mide lo
que el radar predijo **de verdad**, en el momento, contra el resultado oficial. Es la forma en
que el radar aprende de sus señales sin engañarse:

1. cada señal se anota en una cartera de papel y se cierra con el resultado oficial;
2. cada predicción en vivo, haya o no señal, se compara con el resultado y con el precio del
   mercado en ese mismo momento;
3. si en vivo un modelo resulta peor que el mercado, sus señales se suspenden solas.

## Datos

- Predicciones de corridas en vivo (`prediction_runs.kind = 'live'`), con probabilidad.
- Resultado: resolución oficial de Polymarket (`umaResolutionStatus = resolved` y precios
  finales 1/0; 0,5/0,5 = empate, y = 0,5). Si la base no la tiene, se consulta a Gamma por id.
- Precio del mercado: punto medio del libro del CLOB del mismo token, pedido en la misma tanda
  que la predicción (`valuations.p_market_mid`). Es un precio real del momento.

## Instancias

- Momentos: los mismos de `crypto-schedule-v1` (distancias fijas d antes de la resolución R).
- R = `as_of` + minutos hasta la resolución registrados en la predicción (`details.tau_min`).
- Para cada mercado, modelo y momento d se usa la **última** predicción en vivo con
  `as_of` ≤ R − d y `as_of` ≥ R − d − 40 min. Si no hay, no hay instancia.
- Una predicción que sirve a dos momentos cuenta una sola vez.
- Conglomerado: activo × día ET de R (igual que el backtest).
- Las familias nuevas (deportes, política, economía) usan sus propios momentos, que se fijan en
  su documento antes de la primera corrida.

## Métricas y criterios (por modelo y variante)

- n ≥ 200 y al menos 20 conglomerados.
- ECE (10 tramos) ≤ 0,05.
- |calibración global| ≤ 0,03 y su IC del 95 % incluye 0.
- Brier menor que el de predecir siempre la tasa observada en las mismas instancias.
- **Supera al mercado en vivo**: diferencia de log loss (modelo − mercado) con IC del 95 %
  (bootstrap por conglomerados, 500 remuestreos) completamente por debajo de 0.
- **Peor que el mercado en vivo**: el mismo IC completamente por encima de 0.

## Qué cambia en las señales

1. **Suspensión.** Si un par modelo-variante habilitado por el backtest resulta *peor que el
   mercado en vivo* con n ≥ 200 y ≥ 20 conglomerados, sus señales se suspenden: la valoración
   agrega el motivo "suspendido por la evaluación en vivo". Esta regla solo puede quitar señales.
2. **Familias nuevas.** Sin backtest, una familia nueva solo da señales si en vivo cumple todos
   los criterios y supera al mercado **en dos evaluaciones separadas por al menos 7 días**
   (para no habilitar por mirar muchas veces). Mientras tanto queda en *observación*.
3. Un par cripto que no pasó el backtest **no** se habilita solo por la evaluación en vivo: eso
   exige un nuevo preregistro.

La evaluación se recalcula después de cada corrida en vivo. Mirar tantas veces aumenta la
probabilidad de un resultado favorable por azar; por eso la habilitación exige dos
evaluaciones separadas y la suspensión solo puede quitar señales.

## Cartera de papel (`paper-v1`)

- Capital US$1.000, reserva mínima US$700, exposición máxima US$300.
- Una posición por mercado y resultado: la primera señal operable. Las señales repetidas del
  mismo mercado en corridas siguientes no compran de nuevo.
- Compra: las acciones que llenan US$25 al precio ejecutable (VWAP del ask) de la valoración,
  más la comisión del mercado.
- La posición ocupa capital desde su `as_of` hasta el fin del mercado. Si abrirla supera la
  exposición máxima, no se abre y se cuenta como omitida.
- Sin ventas anticipadas. Cierre con la resolución oficial: cobro = acciones × precio final.
- Son operaciones **simuladas**. No hay órdenes reales.

## Re-ajuste de parámetros

`forward-v1` no re-ajusta parámetros. Un re-ajuste periódico con datos nuevos
(`crypto-refit-v1`) se preregistrará aparte, antes de ejecutarse.

## Familias con referencia externa (`ref-kalshi-v1`)

Agregado el 27-oct-2026, alrededor de las 22:30 UTC, **antes** de la primera corrida de estas
familias. Hasta ahora solo se miraron listados de mercados abiertos de Kalshi y de Polymarket
para comprobar que se pueden emparejar; no se compararon precios ni resultados.

**Idea.** Para deportes y economía no hay un modelo propio. La "predicción" es el precio de un
mercado equivalente en Kalshi (API pública de solo lectura), sin margen. La evaluación en vivo
dirá si esa referencia le gana al libro de Polymarket; mientras no lo demuestre, estas familias
quedan en *observación* y no dan señales.

**Mercados emparejados (todo lo demás se abstiene con su motivo):**

| Variante | Polymarket | Kalshi | Cómo se empareja |
|---|---|---|---|
| `nba_partido`, `nfl_partido`, `nhl_partido`, `mlb_partido` | ganador del partido (2 resultados) | `KX{LIGA}GAME` | fecha ET del inicio + códigos de equipo del slug (con tabla de equivalencias) |
| `futbol_partido` (Premier, Serie A, LaLiga, Bundesliga, Ligue 1, Champions) | gana un equipo / empate (Sí/No) | `KX{LIGA}GAME` | fecha ET + nombres de los dos equipos (similitud ≥ 0,6, sin ambigüedad); empate = `TIE` |
| `fed_decision` | decisión de tasas de una reunión (sin cambio, ±25, ±50+) | `KXFEDDECISION` | mes y año de la reunión + tipo de decisión |

**Probabilidad.** Punto medio (bid+ask)/2 del resultado en Kalshi, dividido por la suma de los
puntos medios de todos los resultados del mismo evento (quita el margen). Intervalo = bid y ask
divididos por la misma suma. Abstención si:

- falta bid o ask en algún resultado del evento, o el spread del resultado es > 0,10;
- la suma de puntos medios no está entre 0,90 y 1,15;
- el precio de Kalshi tiene más de 10 min al momento de la predicción;
- el partido ya empezó (en vivo no se compara: los dos precios no son del mismo instante).

**Momentos** (antes del inicio del partido o de la hora de la decisión de la Fed):

| Variante | Momentos |
|---|---|
| partidos | 24 h, 6 h, 2 h y 30 min |
| `fed_decision` | 14 d, 7 d, 3 d, 1 d y 2 h |

**Conglomerado:** liga × día ET del partido; para la Fed, la reunión.

Se aplican los mismos criterios y la misma regla de habilitación de "Familias nuevas" (dos
evaluaciones que pasan, separadas por al menos 7 días). No se agregan reglas de política en esta
versión: los mercados políticos de Polymarket casi nunca tienen un equivalente exacto.
