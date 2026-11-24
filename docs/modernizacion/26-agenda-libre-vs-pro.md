# 26 · Agenda «Libre» y «Pro»: cómo está implementado realmente

Rama `diseno-v0`. Solo lectura del código: **no se cambió ninguna suscripción ni se habilitó ninguna función de pago.**

## 1. Hallazgo central
**En el código no existen «Agenda Libre» ni «Agenda Pro».** No hay ningún campo, plan ni bandera con esos nombres (búsqueda en `src/`, `web/src/`, migraciones y docs). Lo que sí existe, y lo que puede explicar lo que viste:

| Concepto real | Dónde está | Qué controla |
|---|---|---|
| Plan **Inicial / Crecimiento / Profesional** (`PLANS`, `src/billing.ts`) | `businesses.plan` | Solo **límites**: usuarios (3 / 5 / 10), sucursales (1 + extras) y precio mensual ($500 / $700 / $900). **No activa ni desactiva funciones de Agenda.** |
| Cuenta **Gratis** (`businesses.free`) | Super Panel → «Cobrar mensualidad / Gratis» | No paga ni vence. No limita funciones; el panel la muestra con insignia «Gratis». |
| Extra de pago **«reservas»** (`PAID_ADDONS`, `src/common.ts`) | `businesses.addons` + `modules`, lo habilita solo el Super Panel con cobro de instalación | Activa **el link público de reservas** (`/reservar/…`). Sin él, la página pública responde «Este link de reservas no está disponible». |
| Módulo **«recordatorios»** | `businesses.modules` (lo enciende el dueño) | Lista de retoques por WhatsApp en Agenda. |
| Pantalla **Agenda** | `web/src/App.tsx`: `giros: ['barberia','unas']`, permiso `sell` | Se muestra **por giro**, no por plan. Toda barbería/uñas la tiene completa. |

## 2. Por qué «FENIX BARBERÍA aparece como Libre»
No puedo leer producción desde aquí (y no debo). Con el código, hay **dos explicaciones posibles**; necesito saber cuál viste:
1. **«Gratis»** en el Super Panel: si Fénix está marcada como cuenta de cortesía (`free = 1`), aparece con la insignia «Gratis». Eso **no** significa que le falte Agenda Pro: solo que no paga mensualidad.
2. **«Libre»** dentro de la Agenda: las horas disponibles de un barbero se llaman «Libre 10:00 – 11:00» (`Agenda.tsx`). Es un hueco en el horario, no un plan.

Si viste otra etiqueta (por ejemplo en el Super Panel, ficha del negocio), mándame la captura: no existe en este código y entonces habría que revisar si proviene de otra versión.

## 3. Comparativa real de funciones (lo que hoy tiene cualquier barbería/uñas)
| Función | ¿Existe? | Condición |
|---|---|---|
| Agenda del día por barbero/técnica, horarios, descansos y bloqueos | Sí | Giro barbería/uñas |
| Horas libres, «el primero disponible» | Sí | — |
| Crear, confirmar, iniciar, reprogramar, cancelar, «no asistió» | Sí | Permiso `sell` |
| Cobrar la cita (crea la venta ligada: `appointments.sale_id`) | Sí | Permiso `sell` |
| Cita a domicilio con cargo de traslado | Sí | Opcional |
| **Link público de reservas** | Sí | **Extra «reservas»** (pago de instalación) |
| Cliente ve/cancela su reserva con su enlace privado | Sí | Con link público |
| Aviso al dueño y al barbero de reserva nueva | Sí | Con link público |
| Recordatorios de retoque (WhatsApp manual) | Sí | Módulo «recordatorios» |
| Recordatorio automático al cliente (SMS/WhatsApp) antes de la cita | **No** | — |
| Depósito/anticipo para apartar la hora | **No** | — |
| Historial por cliente en la ficha de la cita | Parcial | Datos existen; sin pantalla dedicada |
| Flujo «completada → pendiente de cobro → Caja cobra» | **No**: hoy la cita se cobra desde la propia Agenda y salta directo a venta | Pendiente (ver doc 25) |

## 4. Propuesta para definir Libre y Pro (sin inventar: se basa en lo que ya existe)
Solo es propuesta; **nada se cobra ni se habilita sin tu autorización**.
- **Agenda Libre (incluida con el sistema):** agenda interna completa (todo lo marcado «Sí» sin el link): citas, horarios, confirmar/cancelar/no asistió, cobrar la cita, comisiones.
- **Agenda Pro (extra):** lo que ya hoy es de pago o requiere trabajo: link público de reservas con identidad del negocio (logo, servicios, horario), avisos de reserva, y a futuro recordatorios automáticos y anticipos. Hoy la única compuerta técnica es el extra «reservas»; Pro = ese extra.
- Implementación mínima: reutilizar `addons: ['reservas']`; mostrar en Ajustes y Super Panel el nombre «Agenda Pro» en lugar de «reservas». Sin tablas nuevas.
- Decisión tuya: ¿Pro cobra instalación (como hoy) o mensualidad? ¿Fénix debe tener Pro de cortesía? (en Super Panel: «Habilitar extra reservas», sin costo).
