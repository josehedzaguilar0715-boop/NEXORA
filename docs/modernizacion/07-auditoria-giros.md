# Fase 2: auditoría funcional de los 13 giros

Fecha: 23 nov 2026. Rama `modernizacion`. **Producción no se tocó.**

## 1. Método

No basta con que una pantalla abra. Cada operación se siguió desde que se registra hasta que aparece en **existencias, caja (corte), reportes, panel de Inicio, libro de dinero, fiado y bitácora**, y todo tiene que cuadrar.

* **Pruebas por giro** (ya existían, se revisaron): `test/<giro>.test.ts`, en total 100+ casos.
* **Pruebas nuevas de día completo** (`test/dia-completo.test.ts`). Se registra un día real de trabajo y al final se cuadra todo:

  | Prueba | Qué cubre |
  |---|---|
  | Abarrotes | Compra pagada de la caja, ventas en efectivo, transferencia y fiado, cancelación, abono, merma, gasto, retiro y corte Z con diferencia 0. |
  | Barbería | Comisiones por barbero, propina en efectivo y con tarjeta, producto en la misma cuenta, cancelación y corte. |
  | Restaurante | Mesa dividida por persona, propina, cortesía y platillo cancelado (con código y bitácora), receta que descuenta insumos, costo de lo vendido y caja. |
  | Dos días seguidos (ferretería) | Venta ayer con corte Z; devolución hoy. Cada día muestra lo suyo y el corte de ayer no se mueve. |
  | Cancelar cuando el efectivo ya salió | Ver hallazgo 2. |
  | Anular un gasto capturado por error | Ver hallazgo 3. |

* Todas las pruebas son **automatizadas** (base en memoria y datos ficticios). No se usaron datos reales.

## 2. Hallazgos de esta fase (corregidos)

| # | Problema | Riesgo real | Solución | Prueba |
|---|---|---|---|---|
| 1 | Una **compra, abono a proveedor, gasto o devolución «pagada de la caja»** podía ser mayor al efectivo que había. El corte quedaba esperando dinero negativo, y el sistema lo aceptaba. | Cortes que no cuadran y faltantes que no se detectan. | Una sola verificación compartida (`assertCashAvailable` en `src/cash.ts`). Cuando no alcanza, responde «No alcanza el efectivo de la caja… hay $X y se necesitan $Y. Págalo por transferencia o registra primero un depósito». Corre dentro de la transacción, así que no se guarda nada a medias. Aplica a compras, abonos a proveedor, gastos, devoluciones (ferretería y perfumería), anticipos de encargos, reembolsos de boletos y devoluciones de apartados. | `dia-completo` (abarrotes, dos días), `ferreteria` |
| 2 | **Cancelar una venta en efectivo** cuando ese dinero ya se había retirado dejaba la caja en negativo. | Igual que el 1. | Se rechaza solo si la cancelación baja el efectivo y lo deja negativo. Una venta por transferencia siempre se puede cancelar; con un depósito, la cancelación pasa. | `dia-completo` «cancelar cuando el efectivo ya salió» |
| 3 | **No había forma de corregir un gasto capturado por error.** Los gastos no se pueden borrar, a propósito, y el error se quedaba en las utilidades para siempre. | Reportes y 50/30/20 con datos falsos. | Nuevo **«Anular»** en Finanzas → Gastos. Pide motivo; el personal necesita además el código del dueño. El gasto queda en la lista tachado, con su motivo, y en la bitácora (no se borra). Sale de los reportes, del libro y del 50/30/20. Si se pagó de la caja, el dinero regresa a esa caja, y solo mientras ese turno siga abierto. Migración 39: solo agrega 3 columnas. | `dia-completo` «corregir un gasto» |

Lo que **ya funcionaba bien** y quedó comprobado de punta a punta:

* Las existencias cuadran con compras, ventas, cancelaciones (regresan a su lote), merma y recetas.
* Corte X y Z: el efectivo esperado incluye fondo, ventas en efectivo, abonos, propinas en efectivo, depósitos, retiros, gastos y compras de la caja. Un turno con corte ya no se puede cancelar.
* El fiado y las cuentas por cobrar cuadran. El fiado no cuenta como dinero hasta que se abona.
* El libro de dinero no cuenta doble (compra de la caja = una sola salida).
* Comisiones sobre el precio final. La propina va aparte, sin comisión, y no es ingreso del negocio. Al cancelar se anulan comisión y propina.
* Ventas reintentadas sin internet: no se duplican (`sync.test.ts`, `palapa`, mismo id).
* Aislamiento entre negocios: cubierto en ~90 rutas (`aislamiento-negocios.test.ts`).

## 3. Matriz por giro

Estado: ✅ completo y probado · 🟡 funciona, con huecos · 🔴 falta algo importante.

| Giro | Estado | Problema / hueco | Prioridad | Solución propuesta | Pruebas |
|---|---|---|---|---|---|
| **Abarrotes** (real) | ✅ | No hay **anulación de compra** ni **devolución a proveedor**. Hoy se corrige con ajuste de existencia y el costo promedio no se recalcula. | Media | Devolución a proveedor: baja existencia del lote, baja cuenta por pagar o regresa a la caja; con código. | 21 + día completo |
| **Barbería** (real, Fénix) | 🟡 | 1) Las comisiones se **calculan pero no se registra el pago** al barbero: no hay «pagué comisiones de la semana» que salga de la caja y quede en historial. 2) La propina con tarjeta no tiene registro de entrega al barbero. | **Alta** (negocio real) | «Pagar comisiones y propinas» por barbero y periodo: sale de la caja (con la verificación de efectivo) o por transferencia, queda en historial y no se puede pagar dos veces. | 10 + día completo |
| **Uñas** (real) | 🟡 | Mismo hueco de pago de comisiones y propinas que barbería. | **Alta** | El mismo módulo de pago de comisiones. | 7 |
| Ferretería | ✅ | Igual que abarrotes: devolución a proveedor. | Media | Igual que abarrotes. | 9 + dos días |
| Papelería | ✅ | — | — | — | 7 |
| Perfumería | 🟡 | Pago de comisiones a asesoras: mismo hueco que barbería. | Media | Módulo de pago de comisiones. | 7 |
| Baños públicos | ✅ | — | — | — | 5 |
| Lugar turístico | ✅ | — | — | — | 7 |
| Palapa | 🟡 | Propinas por mesero sin registro de entrega. | Media | El mismo módulo, para propinas. | 8 |
| Restaurante | 🟡 | Igual que palapa (propinas). | Media | Igual. | 6 + día completo |
| Comedor | ✅ | Propinas apagadas por defecto. | Baja | — | 7 |
| Taquería | ✅ | — | — | — | 5 |
| Verdulería | ✅ | — | — | — | 6 |

### Huecos comunes a todos los giros

| Hueco | Prioridad | Propuesta |
|---|---|---|
| **Anular un abono de fiado** capturado por error (hoy no se puede) | Media | Movimiento de corrección en el fiado (nunca borrar), con código. Si fue en efectivo, sale de la caja con la verificación de efectivo. El libro de dinero lo resta. |
| Anular una compra o devolver a proveedor | Media | Ver abarrotes. |
| Corregir un depósito o retiro manual | Baja | Hoy se compensa con el movimiento contrario, que queda en bitácora. Es aceptable. |

## 4. Lo que no se probó (y por qué)

* **Impresora de tickets, báscula, lector y cajón de dinero reales**: requieren el dispositivo. Está probado con la báscula y el lector simulados en el navegador.
* **Push a un teléfono real y SMS reales**: requieren el celular y el servicio de producción.
* **Varias sucursales con mucho volumen**: solo hay pruebas de traspaso. La carga está en la Fase 8.

## 5. Siguiente (Fase 3, especialización)

1. **Pago de comisiones y propinas** (barbería, uñas, perfumería, palapa y restaurante). Es lo más importante para los negocios reales.
2. Devolución a proveedor y anulación de compra.
3. Anulación de abono de fiado.
