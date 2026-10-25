# Reporte de ingesta — corrida #1

- Generado: `2026-10-25T22:46:42.182314+00:00` (UTC) a partir de la base de datos.
- Origen: Datos **reales** obtenidos de las APIs públicas de Polymarket.
- Disparo: `manual` · Estado: **partial**
- Inicio: `2026-10-25T22:20:24.649282+00:00` · Fin: `2026-10-25T22:46:41.955906+00:00` · Duración: 1577.3 s
- Descubierta completa: **sí**
- Fuentes: Gamma `GET /events/keyset`, `GET /markets/keyset`; CLOB `POST /books`.

## Embudo de cobertura

| Etapa | Cantidad | Nota |
|---|---:|---|
| Páginas Gamma leídas | 2417 | 100 mercados por página |
| Eventos abiertos descubiertos | 21903 | con etiquetas → categoría |
| Mercados abiertos descubiertos (únicos) | 241681 |  |
| Mercados duplicados en la paginación | 0 | descartados |
| Mercados inválidos (validación) | 0 | ver errores |
| Mercados nuevos (primera vez vistos) | 241681 |  |
| Mercados con reglas modificadas | 0 | hash de reglas |
| Cierres confirmados | 0 | consulta por id |
| Desaparecidos sin confirmar | 0 | missing_since |
| Mercados elegibles (filtrados) | 208765 | 86.38% de descubiertos |
| Tokens solicitados al CLOB | 417530 | 2088 solicitudes |
| Libros recibidos OK | 417398 | 99.97% |
| Libros faltantes | 132 | el CLOB no devolvió libro |
| Libros inválidos | 0 |  |
| Libros fallidos (error de solicitud) | 0 |  |
| Mercados analizados (todos sus libros) | 208697 | 99.97% de elegibles |
| Mercados que pasan filtro de liquidez | 9901 | 4.74% de analizados |
| Snapshots insertados | 19802 | alcance: liquid |
| Snapshots sin cambios (no reinsertados) | 0 | deduplicación |
| Errores registrados | 132 |  |

## Motivos de exclusión

Elegibilidad (metadatos de Gamma):

- `end_date_passed`: 32907
- `not_accepting_orders`: 107
- `order_book_disabled`: 54
- `no_clob_tokens`: 44

Liquidez (order book del CLOB; spread máx. 0.05, profundidad mín. US$100.0 por lado dentro de 0.02 del mejor precio; un mercado puede acumular varios motivos y se cuenta una vez por token afectado):

- `one_sided`: 184090
- `insufficient_bid_depth`: 179250
- `spread_too_wide`: 159865
- `insufficient_ask_depth`: 125559
- `book_missing`: 132

## Errores por etapa y tipo

- `clob_books:book_missing`: 132

## Tiempos por etapa (s)

- books: 330.64
- events: 59.84
- closures: 0.14
- discovery: 1186.64

## Mercados analizados por categoría (estado actual)

| Categoría | Analizados | Líquidos |
|---|---:|---:|
| sports | 177602 | 5758 |
| elections | 10042 | 1260 |
| crypto | 5854 | 1549 |
| economy | 4040 | 238 |
| politics | 2829 | 514 |
| weather | 2450 | 176 |
| tech | 2224 | 152 |
| culture | 1883 | 235 |
| unknown | 1801 | 16 |
| other | 40 | 3 |

## Muestra: 15 mercados líquidos con menor spread

Precios del order book del CLOB (bid/ask ejecutables en el instante del snapshot). `Precio prom. compra` = VWAP para comprar US$100 del primer resultado recorriendo el libro.

| Mercado | Cat. | Bid | Ask | Spread | Prof. mín. US$ | Precio prom. compra | Libro (fuente) | Recibido |
|---|---|---:|---:|---:|---:|---:|---|---|
| Will Bitcoin reach $250,000 by December 31, 2026? | crypto | 0.004 | 0.005 | 0.001 | 584 | 0.0072 | 2026-10-25T22:41:01.703000+00:00 | 2026-10-25T22:41:15.909130+00:00 |
| Will Bitcoin dip to $15,000 by December 31, 2026? | crypto | 0.006 | 0.007 | 0.001 | 404 | 0.0070 | 2026-10-25T22:36:07+00:00 | 2026-10-25T22:41:15.909130+00:00 |
| Jeffrey Epstein confirmed to be alive before 2027? | politics | 0.007 | 0.008 | 0.001 | 209 | 0.0136 | 2026-10-25T22:41:05+00:00 | 2026-10-25T22:41:15.909130+00:00 |
| Cilia Flores released from custody by December 31, 2026? | politics | 0.042 | 0.043 | 0.001 | 121 | 0.0492 | 2026-10-25T22:41:14.237000+00:00 | 2026-10-25T22:41:17.240830+00:00 |
| Will Marco Rubio be the leader of Venezuela end of 2026? | politics | 0.001 | 0.002 | 0.001 | 203 | 0.0020 | 2026-10-25T22:41:09.001000+00:00 | 2026-10-25T22:41:17.240830+00:00 |
| Will Pete Hegseth be the leader of Venezuela end of 2026? | politics | 0.001 | 0.002 | 0.001 | 257 | 0.0020 | 2026-10-25T22:41:08.718000+00:00 | 2026-10-25T22:41:17.240830+00:00 |
| Will Argentina’s annual inflation in 2026 be between 30% and 34.9%? | economy | 0.670 | 0.671 | 0.001 | 147 | 0.6710 | 2026-10-25T22:41:16.311000+00:00 | 2026-10-25T22:41:17.400283+00:00 |
| Will Satoshi move any Bitcoin in 2026? | crypto | 0.032 | 0.033 | 0.001 | 1120 | 0.0330 | 2026-10-25T22:41:10.724000+00:00 | 2026-10-25T22:41:17.400283+00:00 |
| Will the 2026 Midterm Elections happen as scheduled? | elections | 0.980 | 0.981 | 0.001 | 662 | 0.9810 | 2026-10-25T22:41:12.006000+00:00 | 2026-10-25T22:41:17.668802+00:00 |
| Will UK annual GDP growth in 2026 be between 1% and 2%? | economy | 0.886 | 0.887 | 0.001 | 113 | 0.8917 | 2026-10-25T22:41:07.948000+00:00 | 2026-10-25T22:41:17.668802+00:00 |
| Will the Republican Party win the MI-05 House seat? | elections | 0.936 | 0.937 | 0.001 | 168 | 0.9370 | 2026-10-25T22:41:14.872000+00:00 | 2026-10-25T22:41:19.028560+00:00 |
| Abstract FDV above $3B one day after launch? | crypto | 0.033 | 0.034 | 0.001 | 179 | 0.0449 | 2026-10-25T22:39:50.305000+00:00 | 2026-10-25T22:41:19.802024+00:00 |
| Epic Games IPO before 2027? | economy | 0.017 | 0.018 | 0.001 | 136 | 0.0288 | 2026-10-25T22:41:00.662000+00:00 | 2026-10-25T22:41:19.988152+00:00 |
| Will Bitcoin dip to $30,000 by December 31, 2026? | crypto | 0.015 | 0.016 | 0.001 | 562 | 0.0180 | 2026-10-25T22:36:07.008000+00:00 | 2026-10-25T22:41:19.988152+00:00 |
| Will Bitcoin dip to $20,000 by December 31, 2026? | crypto | 0.010 | 0.011 | 0.001 | 382 | 0.0110 | 2026-10-25T22:39:48.393000+00:00 | 2026-10-25T22:41:20.843523+00:00 |

## Limitaciones

- Los precios de Gamma (`outcomePrices`, `lastTradePrice`) no se usan como ejecutables; solo el order book del CLOB.
- Los libros se consultan en lotes secuenciales: no son una foto simultánea; cada snapshot lleva su propio timestamp de fuente y de recepción.
- El filtro de liquidez no es una señal de trading ni implica oportunidad alguna.
- No se calculan probabilidades, arbitrajes ni valor esperado en este hito.
