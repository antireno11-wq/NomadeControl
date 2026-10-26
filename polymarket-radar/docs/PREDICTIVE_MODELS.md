# Modelos predictivos (módulo D) y valoración (módulo E)

Paquete `radar.predict`. Todo es lectura y simulación: no se envían órdenes.

## 1. Interfaz común

```python
predict(market: MarketView, evidence, as_of_time: datetime) -> Prediction
```

| Campo de `Prediction` | Contenido |
|---|---|
| `probability`, `outcome` | Probabilidad del resultado indicado (`Yes`/`Up`); `None` si se abstiene |
| `interval` | Intervalo de incertidumbre (ver §3) |
| `model`, `model_version`, `family` | p. ej. `cripto-rv`, `crypto-models-v1`, `cripto` |
| `data_used` | Cada fuente con URL, SHA-256, hora de descarga y último timestamp usado |
| `as_of`, `created_at` | Fecha de estimación y de cálculo |
| `calibration_status` | `validado` / `no_validado` / `sin_evaluar` / `abstencion`; lo fija la evaluación fuera de muestra, nunca el modelo |
| `abstain_reason` | Motivo concreto cuando no estima |

Regla central: un modelo solo lee datos con timestamp `<= as_of`. Las velas se cortan en
la última **cerrada**; el DVOL en la última hora cerrada; las velas REST abiertas al
recibirlas se descartan. `tests/test_predict_crypto.py` verifica que cambiar todo el
futuro no cambia la predicción.

## 2. Familias

| Familia | Modelo | Estado |
|---|---|---|
| Cripto | `cripto-rv`, `cripto-ewma`, `cripto-dvol`, `cripto-bootstrap` | Implementados y evaluados fuera de muestra (§5) |
| Elecciones | `elecciones-2t` (adaptador de `electoral-2t-v1`) | Implementado; no validado (9 contiendas < 15); ver `ELECTORAL_ENGINE.md` |
| Macro | `macro-sin-modelo` | Se abstiene: falta una serie verificable de la fuente de resolución y un conjunto de calibración |
| Corporativo | `corporativo-sin-modelo` | Se abstiene: sin conjunto de datos verificable |
| Deportes | `deportes-sin-modelo` | Se abstiene: sin fuente deportiva verificable |
| Clima | `clima-sin-modelo` | Se abstiene: requiere pronósticos por conjuntos con historial y la estación de resolución |
| Otros | `otros-sin-modelo` | Se abstiene |

Es preferible una interfaz que se abstiene a un modelo aparentemente sofisticado pero
inválido.

## 3. Modelos cripto

### Contratos (`crypto-terms-v1`)

Lectura determinista de la pregunta y las reglas. Sin IA y sin heurísticas difusas.

| Variante | Regla real (resumen) |
|---|---|
| `daily_above` / `daily_below` / `daily_range` | Cierre de la vela de 1 min de Binance que cierra a las 12:00 ET, sobre/bajo un nivel o en un rango; en el borde, el tramo superior |
| `hourly_above` | Cierre de la vela de 1 h que termina a la hora del título, mayor que el nivel |
| `hourly_updown` | Cierre ≥ apertura de la vela de 1 h que empieza a la hora del título |
| `daily_updown` | Cierre de las 12:00 ET de hoy frente al de ayer; empate = 50-50 |
| `touch_day` / `touch_range` / `touch_month` / `touch_until` / `touch_explicit` | Algún máximo (o mínimo) de vela de 1 min alcanza el nivel en la ventana |

Se rechazan con motivo, entre otros:

- resolución por Chainlink (mercados de 5 y 15 minutos);
- futuros de Binance;
- otras bolsas;
- dominancia, FDV, "días verdes";
- ventanas ambiguas.

El activo de la pregunta debe coincidir con el par de las reglas.

### Datos

- **Velas de 1 minuto de Binance spot:**
  - pasado: archivos mensuales y diarios de `data.binance.vision`, con el SHA-256
    verificado contra el `.CHECKSUM` oficial;
  - día en curso: REST de `data-api.binance.vision`.
  - `api.binance.com` responde 451 desde este entorno.
- **Volatilidad implícita:** índice DVOL de Deribit, velas horarias (solo BTC y ETH).

### Probabilidades (`crypto-models-v1`)

Supuesto: el precio es una martingala sin deriva. El modelo no intenta adivinar la
dirección, solo la dispersión.

| Modelo | Dispersión | Fórmula |
|---|---|---|
| `rv` | Volatilidad realizada con retornos de 5 min; ventana por horizonte ajustada en entrenamiento | Log-normal: `P(S_T > K) = Φ((ln(S/K) − v²/2)/v)`. Toque: primer paso con deriva −σ²/2 (reflexión). Ventana futura: integración de Gauss-Hermite |
| `ewma` | Pesos exponenciales; vida media ajustada en entrenamiento | Igual que `rv` |
| `dvol` | Volatilidad implícita a 30 días | Igual que `rv` |
| `bootstrap` | Bootstrap estacionario de bloques de retornos reales (30 días); 4.000 trayectorias; cruce entre pasos por puente browniano | Simulación |

**Intervalo:** se recalcula la probabilidad con σ multiplicada por los cuantiles 10 y 90
del cociente "volatilidad realizada después / volatilidad estimada", medido en
entrenamiento. Refleja la incertidumbre de la volatilidad, no la del modelo completo.

Las fórmulas se contrastan con simulaciones independientes en `tests/test_predict_models.py`.

## 4. Valoración (`valuation-v1`)

Por token (YES y NO), contra el libro del CLOB pedido en el momento:

| Concepto | Cálculo |
|---|---|
| Precio ejecutable | VWAP del ask para US$25 (llenado parcial informado) |
| Probabilidad del mercado | Punto medio del libro (solo referencia) |
| Diferencia | `p − ask` en p.p. |
| VE bruto | `p − ask` |
| Costos | Comisión del mercado `rate·p·(1−p)` + 0,005 de holgura |
| VE neto | VE bruto − costos |
| VE conservador | Con la cota desfavorable del intervalo |
| Riesgo de liquidez | Bajo / medio / alto (llenado, spread, profundidad) |

Recomendaciones:

- **`señal_operable`**, solo en papel. Exige todo esto:
  - modelo `validado` para ese tipo de contrato y que **supere al mercado** fuera de muestra;
  - discrepancia ≥ 5 p.p.;
  - VE neto ≥ 1 p.p.;
  - VE conservador > 0;
  - llenado completo, spread ≤ 0,05 y libro de menos de 3 minutos.
- **`alerta_investigacion`**: discrepancia ≥ 5 p.p., pero alguna puerta falla.
- **`sin_ventaja`**: no hay discrepancia relevante.
- **`informacion_insuficiente`**: falta libro, ask o comisión verificable.
- **`abstencion`**: el modelo no estimó.

## 5. Evaluación

Reglas fijadas antes de mirar la prueba: [`PREREGISTRO_CRIPTO.md`](PREREGISTRO_CRIPTO.md)
(SHA-256 `20c51324…`, registrado en el reporte). Reporte completo:
[`reports/backtest_cripto.md`](../reports/backtest_cripto.md). Comandos y tiempos en
[`EVIDENCE.md`](EVIDENCE.md) §9.

Corrida del 26-oct-2026 (backtest #4 en la base). Se ejecutó dos veces (#2 y #4) con
métricas idénticas.

### Datos

- `crypto-dataset-v1`: 25.895 mercados resueltos con fin entre el 1-may y el 26-oct-2026
  (SHA-256 `7e45cb27…`). 557 no tienen historia de precios. Se excluyen 12 contratos no
  interpretables, con su motivo.
- La resolución recalculada con las velas de Binance coincide con la oficial en 25.893 de
  25.895 mercados. Las 2 diferencias son toques mensuales con ventana de calendario.
- 129.378 instancias (mercado × momento), de las cuales 128.333 tienen precio de mercado.
- Se excluyen 3.183 instancias de toques ya ocurridos en el momento de predicción y 1.314
  que cruzan una frontera de partición.
- Instancias por partición:

  | Partición | Instancias | Mercados | Conglomerados (activo × día) |
  |---|---:|---:|---:|
  | Entrenamiento | 65.534 | 12.673 | 368 |
  | Validación | 32.916 | 6.481 | 184 |
  | Prueba | 30.928 | 6.069 | 164 |

- Velas de 1 minuto: 342.000 por activo (BTC, ETH, SOL, XRP), sin huecos.

### Resultado en prueba

**22 de 36** pares (modelo, variante) quedan **validados** y **13** superan al mercado:

| Variante | n | Referencia (elegida en validación) | Referencia − mercado, Δ log loss [IC95] | Validados | Superan al mercado |
|---|---:|---|---|---|---|
| `daily_above` | 11.270 | `bootstrap`, validado | −0,0025 [−0,0054; +0,0004] | los 4 | — |
| `daily_below` | 490 | `dvol`, no validado | −0,0016 [−0,0019; −0,0013] | `bootstrap` | los 4 |
| `daily_range` | 4.410 | `bootstrap`, validado | +0,0071 [+0,0007; +0,0156] | los 4 | — |
| `daily_updown` | 772 | `bootstrap`, validado | +0,0048 [−0,0109; +0,0224] | `rv`, `ewma`, `bootstrap` | — |
| `hourly_above` | 7.380 | `ewma`, validado | **−0,3334 [−0,3669; −0,2926]** | los 4 | los 4 |
| `hourly_updown` | 820 | `ewma`, no validado | −0,0038 [−0,0195; +0,0101] | ninguno | — |
| `touch_day` | 4.332 | `bootstrap`, validado | −0,0029 [−0,0082; +0,0033] | `rv`, `ewma`, `bootstrap` | — |
| `touch_month` | 290 | `rv`, no validado | −0,0087 [−0,0121; −0,0037] | ninguno | `rv`, `ewma`, `bootstrap` |
| `touch_range` | 1.164 | `ewma`, validado | −0,0100 [−0,0182; −0,0014] | `rv`, `ewma`, `bootstrap` | `ewma`, `bootstrap` |

Lectura:

- **En la mayoría de los contratos, el modelo empata con el mercado.** Está bien
  calibrado, pero el IC de la diferencia incluye 0. En `daily_range`, `bootstrap` es
  algo **peor** que el mercado.
- **`hourly_above` es la gran excepción:** el log loss del mercado es 0,413 y el de
  `ewma` 0,079. Aquí el precio de referencia está mal calibrado (ECE 0,108).
  - Ese precio **no** está desactualizado: la antigüedad mediana es 0,7 min.
  - Pero en el 57,6 % de las instancias de prueba está entre 0,1 y 0,9. En
    `daily_above` y `touch_day` eso pasa en el 7–9 %.
  - Cada mercado tiene una historia corta: mediana de 64 puntos.
  - Sin libros históricos no se puede saber si a ese precio se podía comprar. Una
    explicación probable son libros con spread amplio, pero **no está verificada**.
- **`daily_below` no se valida con `rv`, `ewma` ni `dvol` por un criterio
  degenerado.** Las probabilidades son casi 0, y entonces el IC de la calibración
  global es [+0,000; +0,000] y no incluye 0. El criterio no se cambió.
- **`touch_month` no se valida** porque tiene solo 4 conglomerados (el mínimo es 20).
- **`hourly_updown` no se valida** porque su ECE está entre 0,050 y 0,058 (el máximo
  es 0,05).
- **Una señal operable en vivo exige que el modelo de referencia esté validado y
  además supere al mercado.** Hoy eso solo se cumple en `hourly_above` y
  `touch_range`, en ambos casos con `ewma`.

### Operaciones hipotéticas (prueba)

**HIPOTÉTICO: precio de referencia no ejecutable; no son ganancias realizadas.**

| Concepto | Valor |
|---|---|
| Operaciones de US$25 | 1.896 (US$47.400 apostados) |
| Resultado total | +US$29.860 |
| Aciertos | 87,3 % |
| Caída máxima | US$342 |
| Resultado medio por operación [IC95 por conglomerados] | US$15,75 [14,69; 16,78] |

Por variante:

| Variante | Operaciones | Resultado |
|---|---:|---:|
| `hourly_above` | 1.432 | +US$29.237 |
| `daily_range` | 112 | −US$762 |
| Resto | 352 | +US$1.385 |

Casi todo el resultado viene de `hourly_above`, justo donde la referencia del mercado es
más dudosa. **No es evidencia de rentabilidad.**

### Corrida en vivo

La primera corrida completa (26-oct, `radar predict live`, ver `EVIDENCE.md` §9.5) dio
**0 señales operables**. Mostró dos problemas de sincronización de la corrida en vivo, que
siguen pendientes:

- **Libros pedidos después de cerrar el mercado.** Los libros se piden ~12 min después
  del `as_of`. Para los mercados que cerraron en ese lapso, el libro ya refleja el
  resultado. Así ocurrió en 6 de las 81 alertas.
- **Libros viejos al valorar.** La valoración de 1.329 mercados tarda ~1 h. Al valorar,
  el 95 % de los libros tenía más de 3 min. La puerta de antigüedad bloquea cualquier
  señal con esos libros, pero eso también impide detectar las válidas.
