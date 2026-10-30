# Reporte de ingesta — corrida #2

- Generado: `2026-10-25T23:15:21.218283+00:00` (UTC) a partir de la base de datos.
- Origen: Datos **reales** obtenidos de las APIs públicas de Polymarket.
- Disparo: `manual` · Estado: **partial**
- Inicio: `2026-10-25T22:47:19.297520+00:00` · Fin: `2026-10-25T23:15:20.938851+00:00` · Duración: 1681.6 s
- Descubierta completa: **sí**
- Fuentes: Gamma `GET /events/keyset`, `GET /markets/keyset`; CLOB `POST /books`.

## Embudo de cobertura

| Etapa | Cantidad | Nota |
|---|---:|---|
| Páginas Gamma leídas | 2421 | 100 mercados por página |
| Eventos abiertos descubiertos | 21879 | con etiquetas → categoría |
| Mercados abiertos descubiertos (únicos) | 242077 |  |
| Mercados duplicados en la paginación | 0 | descartados |
| Mercados inválidos (validación) | 0 | ver errores |
| Mercados nuevos (primera vez vistos) | 1859 |  |
| Mercados con reglas modificadas | 0 | hash de reglas |
| Cierres confirmados | 1463 | consulta por id |
| Desaparecidos sin confirmar | 0 | missing_since |
| Mercados elegibles (filtrados) | 208368 | 86.08% de descubiertos |
| Tokens solicitados al CLOB | 416736 | 2084 solicitudes |
| Libros recibidos OK | 416688 | 99.99% |
| Libros faltantes | 48 | el CLOB no devolvió libro |
| Libros inválidos | 0 |  |
| Libros fallidos (error de solicitud) | 0 |  |
| Mercados analizados (todos sus libros) | 208344 | 99.99% de elegibles |
| Mercados que pasan filtro de liquidez | 9762 | 4.69% de analizados |
| Snapshots insertados | 17480 | alcance: liquid |
| Snapshots sin cambios (no reinsertados) | 2044 | deduplicación |
| Errores registrados | 48 |  |

## Motivos de exclusión

Elegibilidad (metadatos de Gamma):

- `end_date_passed`: 33700
- `not_accepting_orders`: 107
- `order_book_disabled`: 54
- `no_clob_tokens`: 44

Liquidez (order book del CLOB; spread máx. 0.05, profundidad mín. US$100.0 por lado dentro de 0.02 del mejor precio; un mercado puede acumular varios motivos y se cuenta una vez por token afectado):

- `one_sided`: 185467
- `insufficient_bid_depth`: 177811
- `spread_too_wide`: 158475
- `insufficient_ask_depth`: 123330
- `book_missing`: 48

## Errores por etapa y tipo

- `clob_books:book_missing`: 48

## Tiempos por etapa (s)

- books: 331.48
- events: 65.59
- closures: 10.88
- discovery: 1273.63

## Mercados analizados por categoría (estado actual)

| Categoría | Analizados | Líquidos |
|---|---:|---:|
| sports | 177874 | 5609 |
| elections | 10039 | 1249 |
| crypto | 5839 | 1567 |
| economy | 4040 | 236 |
| politics | 2828 | 510 |
| weather | 2450 | 178 |
| tech | 2224 | 160 |
| culture | 1883 | 234 |
| unknown | 1151 | 16 |
| other | 40 | 3 |

## Muestra: 15 mercados líquidos con menor spread

Precios del order book del CLOB (bid/ask ejecutables en el instante del snapshot). `Precio prom. compra` = VWAP para comprar US$100 del primer resultado recorriendo el libro.

| Mercado | Cat. | Bid | Ask | Spread | Prof. mín. US$ | Precio prom. compra | Libro (fuente) | Recibido |
|---|---|---:|---:|---:|---:|---:|---|---|
| Will Bitcoin reach $250,000 by December 31, 2026? | crypto | 0.004 | 0.005 | 0.001 | 584 | 0.0072 | 2026-10-25T23:07:40.411000+00:00 | 2026-10-25T23:09:54.218144+00:00 |
| Will Bitcoin dip to $15,000 by December 31, 2026? | crypto | 0.006 | 0.007 | 0.001 | 404 | 0.0070 | 2026-10-25T23:07:40.424000+00:00 | 2026-10-25T23:09:54.218144+00:00 |
| Cilia Flores released from custody by December 31, 2026? | politics | 0.042 | 0.043 | 0.001 | 123 | 0.0490 | 2026-10-25T23:09:39.319000+00:00 | 2026-10-25T23:09:54.754606+00:00 |
| Will Marco Rubio be the leader of Venezuela end of 2026? | politics | 0.001 | 0.002 | 0.001 | 203 | 0.0020 | 2026-10-25T23:08:33.016000+00:00 | 2026-10-25T23:09:54.754606+00:00 |
| Will Pete Hegseth be the leader of Venezuela end of 2026? | politics | 0.001 | 0.002 | 0.001 | 257 | 0.0020 | 2026-10-25T23:09:49.757000+00:00 | 2026-10-25T23:09:54.754606+00:00 |
| Will Argentina’s annual inflation in 2026 be between 30% and 34.9%? | economy | 0.670 | 0.671 | 0.001 | 143 | 0.6710 | 2026-10-25T23:09:53.277000+00:00 | 2026-10-25T23:09:54.982129+00:00 |
| Will Satoshi move any Bitcoin in 2026? | crypto | 0.032 | 0.033 | 0.001 | 1120 | 0.0330 | 2026-10-25T23:09:25.408000+00:00 | 2026-10-25T23:09:54.982129+00:00 |
| Will the 2026 Midterm Elections happen as scheduled? | elections | 0.980 | 0.981 | 0.001 | 685 | 0.9810 | 2026-10-25T23:09:54.519000+00:00 | 2026-10-25T23:09:55.176633+00:00 |
| Will UK annual GDP growth in 2026 be between 1% and 2%? | economy | 0.886 | 0.887 | 0.001 | 120 | 0.8885 | 2026-10-25T23:09:34.053000+00:00 | 2026-10-25T23:09:55.176633+00:00 |
| Will the Republican Party win the IN-08 House seat? | elections | 0.930 | 0.931 | 0.001 | 312 | 0.9310 | 2026-10-25T23:09:56.496000+00:00 | 2026-10-25T23:09:56.608220+00:00 |
| Will the Republican Party win the MI-05 House seat? | elections | 0.936 | 0.937 | 0.001 | 156 | 0.9370 | 2026-10-25T23:09:56.651000+00:00 | 2026-10-25T23:09:56.677469+00:00 |
| Abstract FDV above $3B one day after launch? | crypto | 0.033 | 0.034 | 0.001 | 165 | 0.0454 | 2026-10-25T23:09:28.581000+00:00 | 2026-10-25T23:09:57.853514+00:00 |
| Epic Games IPO before 2027? | economy | 0.017 | 0.018 | 0.001 | 123 | 0.0288 | 2026-10-25T23:09:38.995000+00:00 | 2026-10-25T23:09:57.917228+00:00 |
| Will Bitcoin dip to $30,000 by December 31, 2026? | crypto | 0.015 | 0.016 | 0.001 | 581 | 0.0182 | 2026-10-25T23:07:41.307000+00:00 | 2026-10-25T23:09:57.917228+00:00 |
| Will Bitcoin dip to $20,000 by December 31, 2026? | crypto | 0.010 | 0.011 | 0.001 | 382 | 0.0110 | 2026-10-25T23:07:41.306000+00:00 | 2026-10-25T23:09:58.279766+00:00 |

## Limitaciones

- Los precios de Gamma (`outcomePrices`, `lastTradePrice`) no se usan como ejecutables; solo el order book del CLOB.
- Los libros se consultan en lotes secuenciales: no son una foto simultánea; cada snapshot lleva su propio timestamp de fuente y de recepción.
- El filtro de liquidez no es una señal de trading ni implica oportunidad alguna.
- No se calculan probabilidades, arbitrajes ni valor esperado en este hito.
