# Fase 6: arquitectura comercial (100 a 500 negocios)

Fecha: 23 nov 2026. Rama `modernizacion`. **Producción no se tocó. No se contrató ni se compró nada.**

## 1. Qué ya existía (revisado en el código)

| Necesidad | Cómo funciona hoy | Dónde |
|---|---|---|
| Alta | Registro propio con código por SMS, o alta asistida desde el super panel | `src/auth.ts`, `src/admin.ts` |
| Prueba gratis | 14 días por defecto (ajustable en el super panel) | `settings.default_trial_days` |
| Planes | Inicial $500 (3 usuarios), Crecimiento $700 (5), Profesional $900 (10), en MXN sin IVA. Extras: sucursal $300 y paquete de 5 usuarios $200 | `src/billing.ts` |
| Renovación | El super panel registra el pago y extiende `paid_until` | `POST /admin/businesses/:id/payments` |
| Vencimiento | Al terminar la prueba o la mensualidad sin pago pasa a **Vencido**: puede entrar y ver, pero no operar. **Los datos no se borran.** | `refreshStatus`, `businessGate` |
| Suspensión | Solo desde el super panel, con motivo | `POST /admin/businesses/:id/suspend` |
| Usuarios y sucursales | Límites por plan. Si se baja de plan, se desactivan los sobrantes más nuevos, **sin borrar** | `enforceLimits` |
| Soporte | Buzón dueño ↔ super panel | `src/support.ts` |
| Cuentas gratis | Negocios marcados «gratis» que no vencen | `POST /admin/businesses/:id/free` |
| Respaldos | Diarios, 30 días, y cifrables (Fase 4) | `src/backup.ts` |
| Actualizaciones | Un solo despliegue actualiza a todos. Migraciones que solo agregan. | `docs/modernizacion/04-continuidad.md` |

## 2. Lo que faltaba y se implementó en esta fase

| Hueco | Riesgo | Solución | Prueba |
|---|---|---|---|
| **El dueño no recibía ningún aviso** antes de que terminara su prueba o su mensualidad: un día amanecía bloqueado. | Clientes molestos y abandono. | Aviso dentro de la app al dueño desde 5 días antes («Tu prueba gratis termina en N días / mañana / hoy»), con enlace a Soporte y la aclaración de que sus datos no se borran. No aparece en cuentas gratis. | `test/superpanel.test.ts` + navegador |
| **El super panel no tenía métricas** para operar muchos negocios. | Sin visibilidad de ingresos, vencimientos ni abandono. | Nueva pestaña **Resumen** (detalle abajo). | `test/superpanel.test.ts` |
| Tamaño de la base sin vigilar | Tope de Cloudflare (Fase 4) | *Ajustes → Espacio de la base* | Fase 4 |

La pestaña **Resumen** muestra:

* ingreso mensual de los negocios que pagan;
* negocios por estado y por giro, y nuevos del mes;
* cuántos vendieron en los últimos 7 días;
* pruebas y mensualidades que vencen en 7 días;
* vencidos, ordenados por días de atraso;
* negocios en prueba o pagando **sin ventas en 7 días**, que son el riesgo de abandono.

## 3. Lo que falta para 100 a 500 negocios (requiere decisiones o gasto)

| Pendiente | Por qué importa | Opciones | Costo | Decisión de |
|---|---|---|---|---|
| **Separar la base por negocio** | Tope de 1 GB del objeto compartido | Ver `08-seguridad.md` §5 | $0 hasta 5 GB; después el plan de pago de Cloudflare, $5 USD/mes | Propietario |
| **Cobro automático** | Hoy el pago se registra a mano en el super panel; con 500 negocios no es viable | Mercado Pago o Stripe (domiciliación o liga de pago); OXXO y transferencia SPEI con referencia | Comisión por cobro, del 3 al 4 % aprox. | Propietario (gasto y contrato) |
| **Facturación (CFDI)** | Muchos clientes piden factura de la mensualidad | Un PAC (Facturama, SW Sapien…) por API | Desde ~$1 MXN por factura | Propietario |
| **SMS** | Registro y recuperación de contraseña | Ya está programado con Twilio; hoy el registro funciona sin SMS cuando no hay proveedor | ~$0.80 a $1.50 MXN por SMS | Propietario |
| **Dominio propio** | Confianza y enlaces limpios | `02-enlaces-publicos.md` §3 | ~$200 a $400 MXN al año | Propietario (no se compró nada) |
| **Soporte a escala** | Un buzón para 500 negocios | Respuestas guardadas en el super panel y centro de ayuda (Fase 7) | $0 | — |

## 4. Costos de operación estimados

Infraestructura de Cloudflare, sin contar cobros ni SMS:

| Negocios | Plan de Cloudflare | Costo mensual aprox. | Ingreso mensual con plan Inicial |
|---|---|---|---|
| 3 a 10 | Gratis | $0 | $1,500 a $5,000 MXN |
| 100 | De pago | ~$5 a $8 USD (~$100 a $160 MXN) | ~$50,000 MXN |
| 500 | De pago | ~$10 a $20 USD (~$200 a $400 MXN) | ~$250,000 MXN |

La infraestructura queda por debajo del 1 % del ingreso. Lo que pesa son las comisiones de cobro (3 a 4 %) y el tiempo de soporte.
