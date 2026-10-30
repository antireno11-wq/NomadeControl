# Evaluación sobre múltiples elecciones

- Generado: `2026-10-26T03:17:06.788160+00:00` (UTC). Todo es retrospectivo.
- **Muestra pequeña, precios históricos no ejecutables y operaciones hipotéticas: esto no demuestra rentabilidad ni calibración.**

## 1. Calibración solo con encuestas (dejar una contienda fuera)

- `weighted`: estado **no_validado**, 9 contiendas, Brier 0.158, log loss 0.477, cobertura 50 % 0.44, cobertura 90 % 0.85.
  - solo 9 contiendas fuera de muestra (mínimo 15)
- `median`: estado **no_validado**, 9 contiendas, Brier 0.151, log loss 0.456, cobertura 50 % 0.48, cobertura 90 % 0.85.
  - solo 9 contiendas fuera de muestra (mínimo 15)

| Contienda | Horizonte (días) | Promedio A | Resultado A | P(A) | ¿Ganó A? |
|---|---:|---:|---:|---:|---|
| br-2022-presidente-2t | 1 | 51.74 % | 50.90 % | 78.2 % | sí |
| br-2022-presidente-2t | 7 | 52.35 % | 50.90 % | 81.2 % | sí |
| br-2022-presidente-2t | 14 | 52.73 % | 50.90 % | 81.5 % | sí |
| br-2018-presidente-2t | 1 | 58.03 % | 55.13 % | 99.1 % | sí |
| br-2018-presidente-2t | 7 | 59.59 % | 55.13 % | 99.1 % | sí |
| br-2018-presidente-2t | 14 | 57.75 % | 55.13 % | 98.0 % | sí |
| br-2010-presidente-2t | 1 | 56.32 % | 56.05 % | 98.0 % | sí |
| br-2010-presidente-2t | 7 | 54.81 % | 56.05 % | 94.2 % | sí |
| br-2010-presidente-2t | 14 | 53.33 % | 56.05 % | 86.0 % | sí |
| fr-2017-presidente-2t | 1 | 61.40 % | 66.10 % | 99.9 % | sí |
| fr-2017-presidente-2t | 7 | 60.86 % | 66.10 % | 99.7 % | sí |
| fr-2017-presidente-2t | 14 | 62.72 % | 66.10 % | 99.6 % | sí |
| fr-2022-presidente-2t | 1 | 55.41 % | 58.55 % | 97.9 % | sí |
| fr-2022-presidente-2t | 7 | 53.38 % | 58.55 % | 91.0 % | sí |
| fr-2022-presidente-2t | 14 | 52.44 % | 58.55 % | 81.8 % | sí |
| pl-2025-presidente-2t | 1 | 50.57 % | 49.11 % | 60.9 % | no |
| pl-2025-presidente-2t | 7 | 53.15 % | 49.11 % | 88.4 % | no |
| pl-2025-presidente-2t | 14 | 54.53 % | 49.11 % | 93.5 % | no |
| pe-2021-presidente-2t | 1 | 50.09 % | 50.13 % | 51.1 % | sí |
| pe-2021-presidente-2t | 7 | 50.28 % | 50.13 % | 54.5 % | sí |
| pe-2021-presidente-2t | 14 | 52.25 % | 50.13 % | 77.2 % | sí |
| co-2022-presidente-2t | 1 | 50.03 % | 51.57 % | 50.4 % | sí |
| co-2022-presidente-2t | 7 | 50.03 % | 51.57 % | 50.4 % | sí |
| co-2022-presidente-2t | 14 | 49.63 % | 51.57 % | 44.9 % | sí |
| ro-2025-presidente-2t | 1 | 49.88 % | 53.60 % | 47.2 % | sí |
| ro-2025-presidente-2t | 7 | 49.60 % | 53.60 % | 42.9 % | sí |
| ro-2025-presidente-2t | 14 | 50.75 % | 53.60 % | 60.6 % | sí |

Contiendas de calibración y problemas de datos:

- `br-2022-presidente-2t`: revisión `1368964934` (2026-08-12), 69 encuestas, resultado A 50.9 / B 49.1 (valid_votes)
- `br-2018-presidente-2t`: revisión `1365268056` (2026-07-21), 22 encuestas, resultado A 55.13 / B 44.87 (unknown)
- `br-2010-presidente-2t`: revisión `1373536970` (2026-09-06), 18 encuestas, resultado A 56.05 / B 43.95 (unknown)
- `fr-2017-presidente-2t`: revisión `1213598918` (2024-03-14), 143 encuestas, resultado A 66.1 / B 33.9 (unknown)
- `fr-2022-presidente-2t`: revisión `1363121499` (2026-07-08), 177 encuestas, resultado A 58.55 / B 41.45 (unknown)
- `pl-2020-presidente-2t`: revisión `1380193388` (2026-10-14), 66 encuestas, resultado A None / B None (None)
- `pl-2025-presidente-2t`: revisión `1328916009` (2025-12-22), 52 encuestas, resultado A 49.11 / B 50.89 (unknown)
- `cl-2021-presidente-2t`: revisión `1373173252` (2026-09-04), 4 encuestas, resultado A None / B None (None)
- `cl-2025-presidente-2t`: revisión `1369398847` (2026-08-14), 85 encuestas, resultado A None / B None (None)
- `pe-2021-presidente-2t`: revisión `1352211104` (2026-05-02), 43 encuestas, resultado A 50.13 / B 49.87 (unknown)
- `co-2022-presidente-2t`: revisión `1357951000` (2026-06-05), 23 encuestas, resultado A 50.42 / B 47.35 (unknown)
- `ro-2025-presidente-2t`: revisión `1379809836` (2026-10-12), 19 encuestas, resultado A 53.6 / B 46.4 (unknown)
- `ec-2025-presidente-2t`: revisión `1315289337` (2025-10-05), 20 encuestas, resultado A None / B None (None)
- ⚠ br-2022-presidente-2t: tabla 11: fecha ilegible '— N/a' (Atlas)
- ⚠ br-2018-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ br-2010-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ fr-2017-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ fr-2022-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ pl-2020-presidente-2t: tabla 3: fecha ilegible 'N/A May 2020' (Maison & Partners)
- ⚠ pl-2020-presidente-2t: tabla 3: fecha ilegible 'N/A May 2020' (N/A)
- ⚠ pl-2020-presidente-2t: la página no tiene fila de resultado; se descarta
- ⚠ pl-2025-presidente-2t: tabla 5: fecha ilegible 'May 2025' (Opinia24 / "Fakty" TVN, TVN24)
- ⚠ pl-2025-presidente-2t: tabla 5: fecha ilegible 'Apr 2025' (Opinia24 / "Fakty" TVN, TVN24)
- ⚠ pl-2025-presidente-2t: tabla 5: fecha ilegible 'Apr 2025' (Opinia24 / "Fakty" TVN, TVN24)
- ⚠ pl-2025-presidente-2t: tabla 5: fecha ilegible 'Feb 2025' (Social Changes / wPolsce24)
- ⚠ pl-2025-presidente-2t: tabla 5: fecha ilegible 'Dec 2024' (Opinia24 / RMF FM)
- ⚠ pl-2025-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ cl-2021-presidente-2t: la página no tiene fila de resultado; se descarta
- ⚠ cl-2025-presidente-2t: la página no tiene fila de resultado; se descarta
- ⚠ pe-2021-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ co-2022-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ ro-2025-presidente-2t: tabla 41: fecha ilegible '' (Men)
- ⚠ ro-2025-presidente-2t: tabla 41: fecha ilegible '' (Women)
- ⚠ ro-2025-presidente-2t: tabla 41: fecha ilegible '' (18–30)
- ⚠ ro-2025-presidente-2t: tabla 41: fecha ilegible '' (31–60)
- ⚠ ro-2025-presidente-2t: tabla 41: fecha ilegible '' (61 or older)
- ⚠ ro-2025-presidente-2t: el resultado no indica 'votos válidos'; se usa igual
- ⚠ ec-2025-presidente-2t: la página no tiene fila de resultado; se descarta

## 2. Comparación con el mercado (walk-forward)

Reglas: {'calibracion': 'walk-forward (solo contiendas anteriores)', 'disponibilidad_encuestas': 'fin de campo + 2 días', 'momentos_decision_dias': [7, 3, 1, 0.5], 'operacion_hipotetica': 'primera alerta con compras observadas; máx. precio pagado en 60 min + comisión + 0,5 c; US$25; hasta resolución'}

| Contienda | Calibrado con | Ganador (mercado) | Brier modelo | Brier mercado | Alertas | Operación hipotética | P&L hipotético US$ |
|---|---:|---|---:|---:|---:|---|---:|
| br-2026-presidente-2t | 9 | Lula | 0.448 | 0.640 | 16 | Flávio Bolsonaro NO @ 0.207 | 95.77 |
| pl-2025-presidente-2t | 8 | Karol Nawrocki | 0.490 | 0.429 | 12 | Karol Nawrocki NO @ 0.635 | -25.00 |
| ro-2025-presidente-2t | 7 | Nicușor Dan | 0.355 | 0.327 | 8 | George Simion NO @ 0.355 | 45.42 |
| ec-2025-presidente-2t | 7 | Daniel Noboa | 0.402 | 0.336 | 4 | — | — |
| cl-2025-presidente-2t | 9 | José Antonio Kast | 0.000 | 0.000 | 0 | — | — |

- Contiendas evaluadas: 5 de 5; con alerta: 4; señales operables: 0.
- Operaciones hipotéticas: 3; P&L hipotético total: 116.20 US$ sobre 75.0 US$ comprometidos. **No son ganancias realizadas.**
- Brier medio: modelo 0.339 vs mercado 0.347.
