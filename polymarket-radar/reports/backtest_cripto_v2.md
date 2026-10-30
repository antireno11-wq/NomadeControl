# Backtest de `cripto2-vol` (`crypto-eval-v2`)

Preregistro: `docs/PREREGISTRO_CRIPTO_V2.md` (SHA-256 `ebe898a46ae7…`). Parámetros v2: `9342b892cfae…`.

Diferencias de log loss: negativo = v2 mejor. IC del 95 % por conglomerados.

## Parámetros ajustados

- k_evento: 0.314
- ν por tramo (None = normal): {'<=2h': 3.0, '<=1d': 10.0, '<=7d': None, '>7d': None}
- recalibración (a, b) por tramo: {'<=2h': [0.008554819694514866, 1.1174608686584122], '<=1d': [-0.04002893647876555, 0.8737206506050591], '<=7d': [-0.891804378392758, 0.5028000363556833], '>7d': [-0.573436384773075, 0.29666807318991273]}

## Validación (en muestra para la recalibración: solo control)

| Variante | n | Log loss v2 | ECE | Estado | v2 − mercado | v2 − v1 (ref.) |
|---|---|---|---|---|---|---|
| daily_above | 11995 | 0.0523 | 0.007 | no_validado | -0.0000 [-0.0033; +0.0035] (n=11995) | -0.0024 [-0.0058; +0.0009] (n=11995) cripto-bootstrap |
| daily_below | 514 | 0.0002 | 0.000 | no_validado | -0.0006 [-0.0008; -0.0005] (n=514) | +0.0001 [+0.0001; +0.0002] (n=514) cripto-dvol |
| daily_range | 4626 | 0.1073 | 0.006 | no_validado | +0.0035 [-0.0023; +0.0111] (n=4626) | -0.0072 [-0.0140; -0.0010] (n=4626) cripto-bootstrap |
| daily_updown | 876 | 0.5112 | 0.062 | no_validado | +0.0136 [+0.0003; +0.0251] (n=872) | +0.0129 [+0.0051; +0.0211] (n=876) cripto-bootstrap |
| hourly_above | 7560 | 0.0400 | 0.006 | no_validado | -0.3476 [-0.3754; -0.3190] (n=7560) | -0.0031 [-0.0056; -0.0004] (n=7560) cripto-ewma |
| hourly_updown | 916 | 0.4130 | 0.054 | no_validado | -0.0095 [-0.0250; +0.0051] (n=916) | -0.0160 [-0.0279; -0.0041] (n=916) cripto-ewma |
| touch_day | 4573 | 0.0868 | 0.009 | validado | +0.0109 [-0.0003; +0.0249] (n=4573) | -0.0025 [-0.0109; +0.0058] (n=4573) cripto-bootstrap |
| touch_month | 435 | 0.3771 | 0.083 | no_validado | -0.0676 [-0.0908; -0.0515] (n=435) | -0.2637 [-0.3576; -0.2073] (n=435) cripto-rv |
| touch_range | 1421 | 0.1275 | 0.016 | validado | +0.0039 [-0.0067; +0.0179] (n=1421) | -0.0381 [-0.0931; -0.0003] (n=1421) cripto-ewma |

## Prueba (una sola vez)

| Variante | n | Log loss v2 | ECE | Estado | v2 − mercado | v2 − v1 (ref.) |
|---|---|---|---|---|---|---|
| daily_above | 11270 | 0.0625 | 0.006 | validado | -0.0057 [-0.0078; -0.0037] (n=11270) | -0.0033 [-0.0054; -0.0009] (n=11270) cripto-bootstrap |
| daily_below | 490 | 0.0003 | 0.000 | no_validado | -0.0014 [-0.0018; -0.0011] (n=490) | +0.0002 [+0.0001; +0.0002] (n=490) cripto-dvol |
| daily_range | 4410 | 0.1404 | 0.011 | no_validado | -0.0075 [-0.0132; -0.0013] (n=4410) | -0.0146 [-0.0235; -0.0068] (n=4410) cripto-bootstrap |
| daily_updown | 772 | 0.5109 | 0.056 | no_validado | +0.0084 [-0.0051; +0.0207] (n=772) | +0.0036 [-0.0170; +0.0212] (n=772) cripto-bootstrap |
| hourly_above | 7380 | 0.0723 | 0.008 | validado | -0.3405 [-0.3705; -0.3076] (n=7380) | -0.0071 [-0.0162; +0.0006] (n=7380) cripto-ewma |
| hourly_updown | 820 | 0.4715 | 0.057 | no_validado | -0.0038 [-0.0170; +0.0121] (n=820) | +0.0000 [-0.0158; +0.0179] (n=820) cripto-ewma |
| touch_day | 4332 | 0.0839 | 0.008 | validado | +0.0024 [-0.0031; +0.0098] (n=4332) | +0.0053 [-0.0002; +0.0123] (n=4332) cripto-bootstrap |
| touch_month | 290 | 0.1297 | 0.036 | no_validado | -0.0020 [-0.0063; +0.0011] (n=290) | +0.0067 [-0.0020; +0.0115] (n=290) cripto-rv |
| touch_range | 1164 | 0.0993 | 0.010 | validado | -0.0022 [-0.0111; +0.0075] (n=1164) | +0.0077 [+0.0026; +0.0136] (n=1164) cripto-ewma |
