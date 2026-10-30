# Preregistro: modelos cripto v2 (`crypto-models-v2`) y su evaluación (`crypto-eval-v2`)

Escrito el 30-oct-2026, alrededor de las 17:00 UTC, **antes** de programar los modelos v2 y
antes de calcular cualquier resultado de v2 en la partición de prueba o en vivo. Su SHA-256
queda en los reportes de v2. Cambiar cualquier regla de esta página exige una enmienda
fechada al final, que declare qué se había visto hasta ese momento.

## Qué no cambia

`crypto-models-v1`, sus parámetros (`data/models/crypto_params.json`), la valoración, las
señales, las carteras `paper-v1` y `paper-v2`, y `forward-v1` siguen igual. Los modelos v2
corren **en paralelo y sin apostar**: se guardan y se evalúan, pero no se usan para valorar
ni para abrir posiciones hasta cumplir la regla de "Reemplazo" de esta página.

## Exposición previa (declaración)

- **Entrenamiento y validación de `crypto-backtest-v1`** (29-oct-2026). Se exploró:
  - volatilidad por hora del día y fin de semana;
  - un multiplicador de σ por tramo de horizonte;
  - una recalibración logística;
  - la mezcla con el precio del mercado.

  En validación, la estacionalidad más la recalibración bajaron el log loss en ~0,005. La
  estacionalidad empeoró los toques de rango. Los detalles están en la memoria del proyecto
  (`mejora_exp.py`).
- **Partición de prueba de `crypto-backtest-v1`**: solo se conocen los resultados de v1 ya
  publicados en `docs/PREDICTIVE_MODELS.md`. **No** se calculó nada de v2 sobre ella.
- **Datos en vivo del 26 al 30-oct-2026** (`forward-v1` y valoraciones). Se vieron estos
  diagnósticos:
  - en `hourly_updown` el modelo exagera los movimientos cortos (pendiente 1,46);
  - en las 194 alertas resueltas, lo que más separó las ganadoras de las perdedoras fue que
    los 4 modelos coincidieran, la ventaja conservadora > 0, el precio < 0,30 y el tipo de
    contrato;
  - la antigüedad del spot no explica las pérdidas.
- **Opciones de Deribit**: una sola consulta el 30-oct-2026 para ver qué instrumentos existen
  (BTC, ETH, SOL_USDC, XRP_USDC y otros). No se compararon con resultados.
- **Calendarios oficiales** de BLS (IPC y empleo) y de la Reserva Federal, leídos el 30-oct-2026.

Por eso la evaluación que decide se hace **con datos nuevos**: la partición de prueba (no
vista para v2) y las instancias en vivo posteriores al despliegue de v2.

## Modelos

Familia `cripto`, versión `crypto-models-v2`. Mismos contratos, el mismo lector de reglas y
los mismos datos con fecha ≤ `as_of` que v1.

### 1. `cripto2-vol` — volatilidad mejorada (grupo 1)

Fórmulas cerradas de v1 (log-normal y reflexión). Solo cambia la varianza, y luego se
recalibra.

1. **Base.** EWMA de retornos de 5 min, con la vida media de v1 por tramo de horizonte.
2. **Estacionalidad** (solo tramos ≤ 2 h y ≤ 1 d):
   - El perfil se arma con los retornos de 5 min de los 30 días anteriores al inicio del día
     UTC de `as_of`.
   - Tiene 24 factores por hora del día en **hora de Nueva York**: el cuadrado de la media de
     |r| en esa hora sobre la media general.
   - Más un factor de fin de semana (sábado y domingo de Nueva York) y uno de día hábil,
     calculados sobre los retornos ya desestacionalizados.
   - La EWMA se calcula sobre los retornos desestacionalizados.
   - La varianza que entra en la fórmula es esa EWMA por el promedio del perfil sobre
     [`as_of`, R].
3. **Eventos programados:**
   - IPC y empleo de EE.UU. a las 08:30 de Nueva York; decisión de la Fed a las 14:00 de
     Nueva York.
   - Las fechas están en `radar/predict/crypto/events.py`, con su fuente.
   - Si [`as_of`, R] incluye la hora [t, t+60 min] de un evento, se suma a esa hora
     `k_evento ×` su varianza esperada (proporcional a la parte de la hora incluida).
   - `k_evento` es un solo número. Se ajusta solo con velas de entrenamiento, usando los
     eventos con fecha anterior al 1-ago-2026: es la mediana entre eventos y activos de
     (varianza realizada en [t, t+60] ÷ varianza esperada por el perfil) − 1, con mínimo 0.
4. **Colas gruesas** (solo contratos de precio final y Up/Down):
   - t de Student con varianza igualada a la del modelo.
   - ν por tramo de horizonte, elegido en entrenamiento entre {3, 4, 6, 10, ∞} por mínimo
     log loss (∞ = normal).
   - Los toques no cambian.
5. **Recalibración:**
   - p' = 1 / (1 + exp(−(a + b · logit(p)))), con logit recortado a [1e-4, 1 − 1e-4].
   - Se ajusta por máxima verosimilitud, por tramo de horizonte, con **entrenamiento +
     validación**.
6. **Intervalo:** como v1: σ multiplicada por los cuantiles 10/90 de v1. Cada extremo pasa por
   la misma recalibración.

Parámetros en `data/models/crypto_params_v2.json`, con su SHA-256 y las fechas de ajuste.

### 2. `cripto2-opciones` — lo que dicen las opciones de Deribit (grupo 2)

Probabilidad implícita en los precios de opciones. **Sin parámetros ajustados.**

- **Fuente:** `public/get_book_summary_by_currency` (`kind=option`) para BTC, ETH y USDC. Se
  pide al empezar la corrida y de nuevo si la foto tiene más de 5 min. Abstención si la foto
  tiene más de 10 min en `as_of`.
- **Subyacentes:** BTC y ETH (opciones inversas), SOL_USDC y XRP_USDC (lineales).
- **Sonrisa por vencimiento:**
  - Se usa `mark_iv` contra x = ln(K/F), con F = `underlying_price` del vencimiento.
  - Solo opciones fuera del dinero (call si K ≥ F, put si K < F) con `mark_iv` > 0.
  - Mínimo 5 precios de ejercicio por vencimiento; si no, ese vencimiento no se usa.
  - Interpolación lineal en x y extrapolación plana.
- **Ajuste al precio de Binance:** el contrato resuelve con Binance, así que F se multiplica
  por (spot Binance ÷ índice de Deribit, `estimated_delivery_price`).
- **Tiempo:**
  - Los vencimientos son a las 08:00 UTC.
  - Si R cae entre dos vencimientos, la varianza total w = σ²·T en ese moneyness se interpola
    linealmente en T.
  - Si R es anterior al primer vencimiento, se usa la σ del primero.
  - Si R es posterior al último, hay abstención.
- **Probabilidad:**
  - P(S_R > K) = −∂C/∂K. Se calcula por diferencia finita de Black-76 con σ(K ± h) y h = 0,5 %
    de K, lo que incluye la sonrisa.
  - Rango = diferencia de dos de esas probabilidades.
  - Up/Down con referencia conocida: K = referencia.
  - Up/Down con referencia futura: la fórmula de v1 con la σ del dinero.
  - Toques: la fórmula de v1 con la σ en el nivel del toque.
- **Intervalo:** el mismo cálculo con σ × 0,9 y σ × 1,1.
- **Solo en vivo:** no hay cadenas históricas de opciones. En el backtest se abstiene con ese
  motivo.

### 3. `cripto2-mezcla` — combinación con el mercado y su libro (grupo 3)

- **Fase A** (desde el despliegue de v2 hasta el 15-nov-2026 a las 23:59 UTC):
  - `cripto2-mezcla` es el promedio simple de los logits disponibles de `cripto2-vol`,
    `cripto2-opciones` y el punto medio del libro de Polymarket del resultado YES en ese
    momento.
  - Exige el punto medio y al menos uno de los dos modelos. Sin parámetros.
  - El punto medio se usa solo como dato de entrada, nunca como precio de compra.
- **Variables que se guardan** con cada predicción de `cripto2-mezcla`, en
  `details.features`, que se copian a `forward_instances.features`:
  - punto medio y spread;
  - desequilibrio del libro: (profundidad de compra − profundidad de venta) / suma, contando
    solo las órdenes a ≤ 0,05 del punto medio;
  - cambio del punto medio frente a la corrida en vivo anterior, si esa corrida fue hace
    20–45 min;
  - los logits de cada componente.
- **Fase B**, el 16-nov-2026:
  - Se ajusta `cripto2-mezcla-ajustada`: una regresión logística de y sobre:
    - logit de `cripto2-vol`;
    - logit de `cripto2-opciones`, con un indicador de faltante;
    - logit del punto medio;
    - desequilibrio, cambio del punto medio y spread.
  - Penalización L2 fija (λ = 1, variables estandarizadas).
  - Se ajusta con las instancias de la fase A ya resueltas.
  - Si hay menos de 500 instancias o menos de 20 conglomerados, no se ajusta y la fase A se
    alarga dos semanas.
  - Después, `cripto2-mezcla-ajustada` se evalúa **solo** con instancias cuyo `as_of` sea
    posterior al ajuste.

## Evaluación

1. **Backtest (solo `cripto2-vol`).**
   - Partición de prueba de `crypto-backtest-v1`: predichas desde el 15-sep-2026 y resueltas
     hasta el 26-oct-2026. Una sola vez.
   - Mismas métricas y criterios que v1, y además una comparación pareada con la referencia v1
     de cada variante: diferencia de log loss, IC del 95 % por bootstrap de conglomerados.
   - Reporte: `reports/backtest_cripto_v2.md`.
2. **En vivo (los tres modelos).**
   - Las instancias y métricas de `forward-v1`: mismos momentos y conglomerados.
   - Además, por variante, la diferencia de log loss pareada (mismo mercado y momento) contra
     la referencia v1, con el mismo IC.

## Reemplazo de la referencia v1 (única forma de que v2 apueste)

Un modelo v2 reemplaza a la referencia v1 de una variante solo si, en **dos evaluaciones en
vivo separadas por al menos 7 días**:

1. cumple los criterios de `forward-v1`: n ≥ 200, ≥ 20 conglomerados, ECE ≤ 0,05, calibración
   global y Brier;
2. supera al mercado: el IC de la diferencia de log loss está completamente bajo 0;
3. supera a la referencia v1 en las mismas instancias: ese IC también está completamente bajo 0.

Para `cripto2-vol` se exige además que el backtest de prueba **no** lo muestre peor que v1 en
esa variante (IC completamente sobre 0). Si califican varios modelos v2, gana el de menor
log loss en vivo. El cambio se anota como enmienda en esta página antes de aplicarlo.

## Costo y volumen

- La API pública de Deribit no cobra. Son 3 consultas por foto, unos 2,3 MB.
- Las predicciones guardadas crecen ~75 % mientras v2 corre en paralelo. La poda de 2 días se
  mantiene, dentro del disco de 20 GB.
