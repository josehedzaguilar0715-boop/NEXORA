# 52 · Aviso «te falta 1 sello» (tarjeta de sellos)

Autorización expresa del propietario (25-nov-2026) para publicar el commit `9c3eb6b3fe8fc916186b501a5e482003665aed08`.

## Qué hace
En Inicio → «Requiere tu atención» aparece **«N clientes están a 1 sello de su premio»**. Cada cliente trae su mensaje de WhatsApp listo («te falta solo 1 sello para tu Facial en tu negocio…»), uno por cada premio configurado (p. ej. Facial a los 5 sellos, Corte gratis a los 10). Al darle el sello que faltaba, el cliente sale del aviso y pasa a «ya puede canjear su premio». Solo con el programa de **sellos** y con premios de la tarjeta; el envío es manual (un toque en WhatsApp). La tarjeta que ve el cliente ya mostraba «Te faltan N sellos para X».

## Publicación
| Dato | Valor |
|---|---|
| **Despliegue (Version ID)** | **`69db41bc-b137-4304-a3ff-cced67e063be`** (100 %, 25-nov 18:02 UTC) |
| Anterior (reversión) | `585fbef6-17a6-4edd-b7ac-27cc39e8363a` |
| Commit | `9c3eb6b3fe8fc916186b501a5e482003665aed08` (rama `fidelidad-avisos`); frente a lo publicado solo cambia `src/today.ts` (+13 líneas) |
| Migraciones / datos | Ninguna; esquema 48; no se tocaron datos |

## Pruebas
354 pruebas automáticas (una nueva: 4 de 5 → Facial, 9 de 10 → Corte gratis, quien lleva 3 no sale, al dar el sello sale del aviso); navegador (escritorio y celular, claro y oscuro: tarjeta, lista, WhatsApp con el premio, contraste/letra/desborde sin hallazgos); verificación externa de GitHub (producción y staging) en verde; Cloudflare sin errores tras publicar.

## FENIX BARBERÍA (respaldo del 25-nov 09:17 UTC)
Tiene la tarjeta de sellos activa y **9 clientes con 4 sellos**, pero **ningún premio creado** (tampoco rifa). Para que el aviso les salga, debe crear el premio en Sellos y promociones → Premios (p. ej. «Facial», costo 5 sellos).

## Límites y pendientes
- No se envía solo: el envío automático a clientes requiere un proveedor de mensajes de pago (doc 35) y no se contrató.
- Solo avisa a quien le falta **exactamente 1** sello; no incluye los premios de una rifa (campañas).
