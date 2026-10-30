# Backtest de modelos cripto (`crypto-backtest-v1`)

Generado 2026-10-26T21:03:50.029320+00:00. Datos reales: mercados resueltos de Polymarket (`crypto-dataset-v1`, SHA-256 `7e45cb27dd8da77a…`), velas de 1 minuto de Binance spot (archivos con checksum oficial) e índice DVOL de Deribit. Ningún resultado se usó para elegir mercados ni momentos de predicción.

Reglas fijadas antes de correr: [`docs/PREREGISTRO_CRIPTO.md`](../docs/PREREGISTRO_CRIPTO.md) (SHA-256 `20c51324f32bdec02408a27582d3fdf3c03c482be5e6eafb7a0d65660bb8979c`).

## Respuesta directa

- Pares (modelo, variante) **validados** en prueba: 22 de 36: cripto-bootstrap|daily_above, cripto-bootstrap|daily_below, cripto-bootstrap|daily_range, cripto-bootstrap|daily_updown, cripto-bootstrap|hourly_above, cripto-bootstrap|touch_day, cripto-bootstrap|touch_range, cripto-dvol|daily_above, cripto-dvol|daily_range, cripto-dvol|hourly_above, cripto-ewma|daily_above, cripto-ewma|daily_range, cripto-ewma|daily_updown, cripto-ewma|hourly_above, cripto-ewma|touch_day, cripto-ewma|touch_range, cripto-rv|daily_above, cripto-rv|daily_range, cripto-rv|daily_updown, cripto-rv|hourly_above, cripto-rv|touch_day, cripto-rv|touch_range.
- Pares que **superan al mercado** (log loss menor con IC < 0): 13: cripto-bootstrap|daily_below, cripto-bootstrap|hourly_above, cripto-bootstrap|touch_month, cripto-bootstrap|touch_range, cripto-dvol|daily_below, cripto-dvol|hourly_above, cripto-ewma|daily_below, cripto-ewma|hourly_above, cripto-ewma|touch_month, cripto-ewma|touch_range, cripto-rv|daily_below, cripto-rv|hourly_above, cripto-rv|touch_month.
- Operaciones **hipotéticas** en prueba: 1896, resultado 29860.35 US$ sobre 47400 US$ apostados. HIPOTÉTICO: precio de referencia no ejecutable; no son ganancias realizadas.
- Una señal operable en vivo exige además precio ask ejecutable, liquidez y que el par esté validado **y** supere al mercado.

## Datos

- Mercados en el conjunto: 25895 (sin historia de precios: 557).
- Por variante: {'daily_above': 8041, 'daily_below': 340, 'daily_range': 3060, 'daily_updown': 700, 'hourly_above': 5616, 'hourly_updown': 712, 'touch_day': 5202, 'touch_month': 628, 'touch_range': 1596}
- Contratos no interpretables (excluidos con motivo): {'evento Up or Down no encontrado por slug': 4, 'reglas Up or Down diarias no reconocidas': 8}
- Instancias (mercado × momento): 129378; con precio de mercado: 128333.
- Excluidas: {'toque_ya_ocurrido_en_as_of': 3183, 'embargo_entre_particiones': 1314}
- Evidencia: {'BTCUSDT': {'rows': 342000, 'gaps': 0, 'files': 33}, 'ETHUSDT': {'rows': 342000, 'gaps': 0, 'files': 33}, 'SOLUSDT': {'rows': 342000, 'gaps': 0, 'files': 33}, 'XRPUSDT': {'rows': 342000, 'gaps': 0, 'files': 33}, 'dvol': {'BTC': 5757, 'ETH': 5757}}

### Contraste del resultado oficial con Binance

| Variante | Coincide | Difiere | Sin datos |
|---|---:|---:|---:|
| daily_above|vela_etiquetada_12:00 | 7167 | 0 | 0 |
| daily_above|vela_etiquetada_12:00|vela_anterior | 7163 | 4 | 0 |
| daily_above|vela_etiquetada_12:00|vela_siguiente | 7154 | 13 | 0 |
| daily_above|vela_que_cierra_12:00 | 874 | 0 | 0 |
| daily_above|vela_que_cierra_12:00|vela_anterior | 873 | 1 | 0 |
| daily_above|vela_que_cierra_12:00|vela_siguiente | 872 | 2 | 0 |
| daily_below|vela_etiquetada_12:00 | 302 | 0 | 0 |
| daily_below|vela_etiquetada_12:00|vela_anterior | 302 | 0 | 0 |
| daily_below|vela_etiquetada_12:00|vela_siguiente | 301 | 1 | 0 |
| daily_below|vela_que_cierra_12:00 | 38 | 0 | 0 |
| daily_below|vela_que_cierra_12:00|vela_anterior | 38 | 0 | 0 |
| daily_below|vela_que_cierra_12:00|vela_siguiente | 38 | 0 | 0 |
| daily_range|vela_etiquetada_12:00 | 2718 | 0 | 0 |
| daily_range|vela_etiquetada_12:00|vela_anterior | 2715 | 3 | 0 |
| daily_range|vela_etiquetada_12:00|vela_siguiente | 2707 | 11 | 0 |
| daily_range|vela_que_cierra_12:00 | 342 | 0 | 0 |
| daily_range|vela_que_cierra_12:00|vela_anterior | 342 | 0 | 0 |
| daily_range|vela_que_cierra_12:00|vela_siguiente | 340 | 2 | 0 |
| daily_updown|vela_etiquetada_12:00 | 684 | 0 | 0 |
| daily_updown|vela_etiquetada_12:00|vela_anterior | 665 | 19 | 0 |
| daily_updown|vela_etiquetada_12:00|vela_siguiente | 675 | 9 | 0 |
| daily_updown|vela_que_cierra_12:00 | 16 | 0 | 0 |
| daily_updown|vela_que_cierra_12:00|vela_anterior | 15 | 1 | 0 |
| daily_updown|vela_que_cierra_12:00|vela_siguiente | 15 | 1 | 0 |
| hourly_above | 5616 | 0 | 0 |
| hourly_updown | 712 | 0 | 0 |
| touch_day|ventana_calendario | 5202 | 0 | 0 |
| touch_month|desde_creacion | 196 | 0 | 0 |
| touch_month|ventana_calendario | 430 | 2 | 0 |
| touch_range|desde_creacion | 194 | 0 | 0 |
| touch_range|ventana_calendario | 1402 | 0 | 0 |

`|vela_siguiente` = lectura alternativa (vela que abre a la hora indicada, en vez de la que cierra). Sirve para comprobar qué lectura de las reglas coincide con Polymarket.

## Partición temporal

- Entrenamiento: resolución < 2026-08-01T00:00:00+00:00
- Validación: as_of >= 2026-08-01T00:00:00+00:00 y resolución < 2026-09-15T00:00:00+00:00
- Prueba: as_of >= 2026-09-15T00:00:00+00:00
- Instancias: {'valid': 32916, 'test': 30928, 'train': 65534}; mercados: {'valid': 6481, 'test': 6069, 'train': 12673}; conglomerados (activo × día): {'valid': 184, 'test': 164, 'train': 368}

## Parámetros ajustados en entrenamiento

- Ventana de volatilidad realizada (min) por tramo: {'<=2h': 1440, '<=1d': 1440, '<=7d': 1440, '>7d': 43200}
- Vida media EWMA (min) por tramo: {'<=2h': 360, '<=1d': 1440, '<=7d': 360, '>7d': 4320}
- Cuantiles 10/90 del cociente de volatilidad (intervalos): {'rv': {'<=2h': [0.4064794984783878, 1.4358319255368244], '<=1d': [0.6905816607548906, 1.7149751795857433], '<=7d': [0.7371339054422807, 1.3079433789588613], '>7d': [0.741421985431872, 1.3180102576135047]}, 'ewma': {'<=2h': [0.42458083411345515, 1.379955232447311], '<=1d': [0.6546379928095876, 1.614538980193568], '<=7d': [0.7595855601128082, 1.3875281874823922], '>7d': [0.7516495710145101, 1.3463318712276942]}, 'dvol': {'<=2h': [0.30041212603635853, 1.358096471141447], '<=1d': [0.5287433760054715, 1.4783050142534129], '<=7d': [0.6734575145485966, 1.2411689052825452], '>7d': [0.75, 1.35]}, 'bootstrap': {'<=2h': [0.32782611941420736, 1.4474156657931299], '<=1d': [0.5474429353522783, 1.5669426052008397], '<=7d': [0.6339022454985449, 1.1686863822762643], '>7d': [0.741421985431872, 1.3180102576135047]}}

## Modelo de referencia elegido en validación

| Variante | Referencia | log loss por modelo |
|---|---|---|
| daily_above | bootstrap | rv 0.0552, ewma 0.0559, bootstrap 0.0547 |
| daily_below | dvol | rv 0.0001, ewma 0.0001, dvol 0.0001, bootstrap 0.0001 |
| daily_range | bootstrap | rv 0.1216, ewma 0.1177, dvol 0.1165, bootstrap 0.1145 |
| daily_updown | bootstrap | rv 0.5193, ewma 0.5152, bootstrap 0.4983 |
| hourly_above | ewma | rv 0.0436, ewma 0.0431, dvol 0.0456, bootstrap 0.0431 |
| hourly_updown | ewma | rv 0.4302, ewma 0.4290, bootstrap 0.4303 |
| touch_day | bootstrap | rv 0.0931, ewma 0.0901, dvol 0.0926, bootstrap 0.0893 |
| touch_month | rv | rv 0.6408, ewma 0.7525, bootstrap 0.6997 |
| touch_range | ewma | rv 0.1671, ewma 0.1656, bootstrap 0.1719 |

## Prueba (fuera de muestra)

Criterios preregistrados: {'min_n': 200, 'min_clusters': 20, 'max_ece': 0.05, 'max_abs_calib_in_large': 0.03, 'brier_below_train_base_rate': True}

### Diario: cierre 12:00 ET sobre un nivel (`daily_above`), 11270 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 11270 | 0.0208 [0.0183; 0.0237] | 0.0682 [0.0603; 0.0772] | 0.008 | 0.005 | — | — |
| rv | 11270 | 0.0205 [0.0180; 0.0234] | 0.0677 [0.0576; 0.0801] | 0.008 | 0.005 | -0.0005 [-0.0042; 0.0042] | validado |
| ewma | 11270 | 0.0204 [0.0179; 0.0232] | 0.0668 [0.0572; 0.0789] | 0.008 | 0.005 | -0.0014 [-0.0050; 0.0030] | validado |
| dvol | 5880 | 0.0207 [0.0177; 0.0243] | 0.0670 [0.0562; 0.0813] | 0.008 | 0.005 | 0.0008 [-0.0025; 0.0053] | validado |
| bootstrap | 11270 | 0.0205 [0.0180; 0.0234] | 0.0657 [0.0573; 0.0761] | 0.008 | 0.005 | -0.0025 [-0.0054; 0.0004] | validado |

### Diario: cierre 12:00 ET bajo un nivel (`daily_below`), 490 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 490 | 0.0000 [0.0000; 0.0000] | 0.0017 [0.0014; 0.0021] | 0.002 | 0.002 | — | — |
| rv | 490 | 0.0000 [0.0000; 0.0000] | 0.0001 [0.0001; 0.0001] | 0.000 | 0.000 | -0.0016 [-0.0019; -0.0013] | no_validado |
| ewma | 490 | 0.0000 [0.0000; 0.0000] | 0.0001 [0.0001; 0.0001] | 0.000 | 0.000 | -0.0016 [-0.0019; -0.0013] | no_validado |
| dvol | 490 | 0.0000 [0.0000; 0.0000] | 0.0001 [0.0001; 0.0001] | 0.000 | 0.000 | -0.0016 [-0.0019; -0.0013] | no_validado |
| bootstrap | 490 | 0.0000 [0.0000; 0.0000] | 0.0001 [0.0001; 0.0001] | 0.000 | 0.000 | -0.0016 [-0.0019; -0.0013] | validado |

Motivos de no validación: rv: calibración global +0.000 (IC +0.000…+0.000); ewma: calibración global +0.000 (IC +0.000…+0.000); dvol: calibración global +0.000 (IC +0.000…+0.000)

### Diario: cierre 12:00 ET en un rango (`daily_range`), 4410 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 4410 | 0.0482 [0.0408; 0.0569] | 0.1479 [0.1272; 0.1724] | 0.017 | 0.002 | — | — |
| rv | 4410 | 0.0488 [0.0417; 0.0569] | 0.1528 [0.1290; 0.1787] | 0.022 | 0.000 | 0.0049 [-0.0018; 0.0137] | validado |
| ewma | 4410 | 0.0490 [0.0418; 0.0572] | 0.1519 [0.1300; 0.1770] | 0.018 | 0.000 | 0.0039 [-0.0021; 0.0116] | validado |
| dvol | 4410 | 0.0487 [0.0421; 0.0565] | 0.1499 [0.1294; 0.1726] | 0.016 | 0.000 | 0.0020 [-0.0057; 0.0106] | validado |
| bootstrap | 4410 | 0.0504 [0.0427; 0.0594] | 0.1550 [0.1325; 0.1824] | 0.021 | 0.000 | 0.0071 [0.0007; 0.0156] | validado |

### Diario: Up/Down mediodía a mediodía (`daily_updown`), 772 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 772 | 0.1681 [0.1499; 0.1875] | 0.5025 [0.4572; 0.5529] | 0.038 | -0.020 | — | — |
| rv | 772 | 0.1700 [0.1518; 0.1902] | 0.5191 [0.4632; 0.5828] | 0.050 | -0.024 | 0.0166 [-0.0059; 0.0436] | validado |
| ewma | 772 | 0.1680 [0.1513; 0.1871] | 0.5088 [0.4602; 0.5653] | 0.046 | -0.024 | 0.0063 [-0.0088; 0.0207] | validado |
| dvol | 386 | 0.1824 [0.1616; 0.2086] | 0.5419 [0.4792; 0.6233] | 0.074 | -0.053 | 0.0054 [-0.0162; 0.0293] | no_validado |
| bootstrap | 772 | 0.1685 [0.1510; 0.1881] | 0.5073 [0.4583; 0.5611] | 0.043 | -0.026 | 0.0048 [-0.0109; 0.0224] | validado |

Motivos de no validación: dvol: ECE=0.074 > 0.05, calibración global -0.053 (IC -0.140…+0.027)

### Horario: cierre de vela 1 h sobre un nivel (`hourly_above`), 7380 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 7380 | 0.1446 [0.1323; 0.1554] | 0.4128 [0.3793; 0.4417] | 0.108 | -0.050 | — | — |
| rv | 7380 | 0.0199 [0.0137; 0.0276] | 0.0794 [0.0492; 0.1242] | 0.009 | -0.002 | -0.3334 [-0.3665; -0.2940] | validado |
| ewma | 7380 | 0.0198 [0.0136; 0.0275] | 0.0794 [0.0485; 0.1239] | 0.008 | -0.002 | -0.3334 [-0.3669; -0.2926] | validado |
| dvol | 7380 | 0.0209 [0.0145; 0.0287] | 0.0822 [0.0542; 0.1223] | 0.010 | -0.002 | -0.3305 [-0.3613; -0.2946] | validado |
| bootstrap | 7380 | 0.0201 [0.0133; 0.0287] | 0.0761 [0.0507; 0.1089] | 0.004 | -0.003 | -0.3367 [-0.3651; -0.3065] | validado |

### Horario: Up/Down de vela 1 h (`hourly_updown`), 820 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 820 | 0.1623 [0.1484; 0.1788] | 0.4753 [0.4403; 0.5179] | 0.050 | -0.045 | — | — |
| rv | 820 | 0.1606 [0.1493; 0.1747] | 0.4702 [0.4418; 0.5036] | 0.058 | -0.043 | -0.0051 [-0.0214; 0.0097] | no_validado |
| ewma | 820 | 0.1611 [0.1495; 0.1750] | 0.4715 [0.4425; 0.5048] | 0.057 | -0.045 | -0.0038 [-0.0195; 0.0101] | no_validado |
| dvol | 410 | 0.1659 [0.1491; 0.1849] | 0.4848 [0.4436; 0.5307] | 0.060 | -0.041 | 0.0021 [-0.0259; 0.0270] | no_validado |
| bootstrap | 820 | 0.1586 [0.1463; 0.1735] | 0.4658 [0.4340; 0.5023] | 0.050 | -0.039 | -0.0095 [-0.0239; 0.0044] | no_validado |

Motivos de no validación: rv: ECE=0.058 > 0.05, calibración global -0.043 (IC -0.095…+0.006); ewma: ECE=0.057 > 0.05, calibración global -0.045 (IC -0.095…+0.004); dvol: ECE=0.060 > 0.05, calibración global -0.041 (IC -0.113…+0.029); bootstrap: ECE=0.050 > 0.05, calibración global -0.039 (IC -0.088…+0.012)

### Toque en el día (`touch_day`), 4332 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 4332 | 0.0236 [0.0189; 0.0293] | 0.0814 [0.0662; 0.1002] | 0.009 | -0.001 | — | — |
| rv | 4332 | 0.0250 [0.0207; 0.0300] | 0.0897 [0.0706; 0.1137] | 0.011 | 0.002 | 0.0083 [0.0013; 0.0169] | validado |
| ewma | 4332 | 0.0242 [0.0202; 0.0293] | 0.0858 [0.0669; 0.1087] | 0.008 | 0.003 | 0.0043 [-0.0032; 0.0133] | validado |
| dvol | 4332 | 0.0236 [0.0197; 0.0284] | 0.0800 [0.0667; 0.0971] | 0.010 | 0.009 | -0.0015 [-0.0076; 0.0058] | no_validado |
| bootstrap | 4332 | 0.0232 [0.0189; 0.0286] | 0.0785 [0.0646; 0.0964] | 0.005 | 0.003 | -0.0029 [-0.0082; 0.0033] | validado |

Motivos de no validación: dvol: calibración global +0.009 (IC +0.001…+0.016)

### Toque en el mes (`touch_month`), 290 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 290 | 0.0419 [0.0286; 0.0584] | 0.1316 [0.0933; 0.1751] | 0.039 | 0.021 | — | — |
| rv | 290 | 0.0419 [0.0270; 0.0603] | 0.1230 [0.0811; 0.1714] | 0.026 | 0.019 | -0.0087 [-0.0121; -0.0037] | no_validado |
| ewma | 290 | 0.0422 [0.0282; 0.0597] | 0.1237 [0.0843; 0.1695] | 0.029 | 0.015 | -0.0079 [-0.0091; -0.0058] | no_validado |
| dvol | 153 | 0.0570 [0.0465; 0.0676] | 0.1657 [0.1405; 0.1913] | 0.049 | 0.028 | 0.0024 [-0.0010; 0.0057] | no_validado |
| bootstrap | 290 | 0.0420 [0.0265; 0.0607] | 0.1244 [0.0788; 0.1747] | 0.035 | 0.019 | -0.0072 [-0.0156; -0.0004] | no_validado |

Motivos de no validación: rv: conglomerados=4 < 20, calibración global +0.019 (IC +0.007…+0.028); ewma: conglomerados=4 < 20, calibración global +0.015 (IC +0.003…+0.025); dvol: n=153 < 200, conglomerados=2 < 20, calibración global +0.028 (IC +0.021…+0.035); bootstrap: conglomerados=4 < 20, calibración global +0.019 (IC +0.003…+0.032)

### Toque en la semana (`touch_range`), 1164 instancias

| Modelo | n | Brier [IC95] | log loss [IC95] | ECE | Calib. global | vs mercado (Δ log loss [IC95]) | Estado |
|---|---:|---|---|---:|---|---|---|
| Mercado (precio ref.) | 1164 | 0.0302 [0.0210; 0.0438] | 0.1015 [0.0736; 0.1431] | 0.015 | 0.006 | — | — |
| rv | 1164 | 0.0319 [0.0227; 0.0444] | 0.1017 [0.0745; 0.1406] | 0.012 | 0.005 | 0.0001 [-0.0104; 0.0111] | validado |
| ewma | 1164 | 0.0293 [0.0201; 0.0418] | 0.0916 [0.0652; 0.1290] | 0.011 | 0.006 | -0.0100 [-0.0182; -0.0014] | validado |
| dvol | 587 | 0.0418 [0.0264; 0.0630] | 0.1302 [0.0874; 0.1889] | 0.022 | 0.013 | -0.0028 [-0.0163; 0.0079] | no_validado |
| bootstrap | 1164 | 0.0285 [0.0197; 0.0410] | 0.0894 [0.0653; 0.1235] | 0.009 | 0.007 | -0.0121 [-0.0217; -0.0034] | validado |

Motivos de no validación: dvol: conglomerados=10 < 20

## Modelo de referencia frente al mercado por horizonte (prueba)

| Horizonte | n | Brier modelo | Brier mercado | log loss modelo | log loss mercado |
|---|---:|---:|---:|---:|---:|
| <=1d | 15295 | 0.0399 | 0.0394 | 0.1249 | 0.1245 |
| <=2h | 14837 | 0.0245 | 0.0868 | 0.0843 | 0.2514 |
| <=7d | 724 | 0.0401 | 0.0408 | 0.1268 | 0.1375 |
| >7d | 72 | 0.0931 | 0.0940 | 0.2626 | 0.2763 |

## Operaciones hipotéticas (prueba)

**HIPOTÉTICO: precio de referencia no ejecutable; no son ganancias realizadas.** Reglas: {'alerta_pp': 5.0, 'holgura': 0.01, 'monto_usd': 25.0, 'una_por_mercado': True}.

- Operaciones: 1896; aciertos: 0.873; resultado total: 29860.35 US$; caída máxima: 342.11 US$.
- Resultado medio por operación [IC95 por conglomerados]: 15.75 [14.69; 16.78]
- Por variante: {'daily_range': {'n': 112, 'pnl': -761.8656000000002, 'wins': 59}, 'daily_above': {'n': 149, 'pnl': 253.52139999999991, 'wins': 117}, 'daily_updown': {'n': 56, 'pnl': 238.84320000000008, 'wins': 33}, 'hourly_above': {'n': 1432, 'pnl': 29236.93200000049, 'wins': 1375}, 'hourly_updown': {'n': 62, 'pnl': 346.8553999999999, 'wins': 29}, 'touch_range': {'n': 47, 'pnl': 399.1529000000001, 'wins': 19}, 'touch_day': {'n': 31, 'pnl': 134.231, 'wins': 17}, 'touch_month': {'n': 6, 'pnl': 11.242499999999998, 'wins': 5}, 'daily_below': {'n': 1, 'pnl': 1.4411, 'wins': 1}}

## Abstenciones

- 15029 × dvol: sin volatilidad implícita verificable para SOL (DVOL solo BTC/ETH)
- 15017 × dvol: sin volatilidad implícita verificable para XRP (DVOL solo BTC/ETH)

## Limitaciones

- Polymarket no publica libros históricos: el precio del mercado es una referencia no ejecutable y las operaciones son hipotéticas.
- Mercados del mismo día y activo comparten la trayectoria del precio: los IC se calculan por conglomerados (activo × día), y aun así el período de prueba cubre pocas semanas de un solo régimen de mercado.
- Los contratos horarios se muestrean (una hora por día, rotando); los de 5 y 15 minutos (Chainlink) quedan fuera por falta de historial verificable.
- El modelo supone precio sin deriva: no intenta predecir dirección, solo dispersión.
