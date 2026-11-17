# NEXORA

Sistema de punto de venta por giro con base común. Especificación: ver `NEXORA_SPEC.md` (v1, 2026-11-16).

## Estado

- **Bloque 1 (base)**: cuentas, acceso y roles, código de autorización, caja y corte, bitácora inmutable, tickets. ✅ con pruebas.
- **Bloque 2 (sin internet y nube)**: cola local de la caja (`src/client/outbox.ts`), llave de idempotencia, sincronización de cambios con conflictos "gana el más reciente" y panel del dueño (`/dashboard`). ✅ con pruebas.
- **Bloque 3 (super panel)**: estados prueba/activo/vencido/suspendido sin perder datos, pagos y reactivación, planes y límites, alta asistida, restablecer accesos, buzón de soporte y solicitudes de cambio. ✅ con pruebas.
- Siguiente: Bloque 4 (módulo común: promociones, membresías, fidelidad, asistencia y QR).

## Desarrollo local

```
npm install
npm test          # pruebas
npm run typecheck
npm run dev       # API en http://localhost:3000 (base SQLite en data/nexora.db)
ADMIN_PASSWORD=... npm run admin:create -- soporte "Soporte"   # usuario del super panel
```

Los códigos de verificación (WhatsApp/SMS) se imprimen en consola en desarrollo.
Importes siempre en centavos enteros (MXN).

## Decisiones de la base (para revisar)

- Un permiso no marcado → la API responde 403 y la pantalla no debe mostrarlo.
- Código de autorización: lo asigna solo el dueño (a sí mismo o a quien decida). Quien autoriza debe tener el permiso de la acción; el solicitante también lo necesita. 5 fallos → bloqueo de 15 min.
- Cancelar una venta solo es posible mientras su turno sigue abierto (después del corte se maneja como devolución, en ferretería).
- Folio por sucursal asignado por el servidor al recibir la venta (se revisará en el Bloque 2 para cajas sin internet).

## Sin internet (Bloque 2)

- La caja encola cada operación (`Outbox.enqueue`) con un id único que sirve de `Idempotency-Key`. `flush` reenvía en orden; sin señal todo queda pendiente (`pending()` es el contador visible). Los rechazos definitivos se marcan para revisión, nunca se pierden.
- Abrir caja, retiros, cortes y ventas aceptan `id` y hora (`at`/`createdAt`) del equipo, por lo que una caja puede operar días sin señal y conserva sus horas reales.
- `/sync/changes` (subir/bajar) aplica "gana el más reciente" y registra el conflicto en `/sync/conflicts` para revisión. Aún no hay productos; lo usará el Bloque 5.
- Folio: lo asigna el servidor al recibir la venta; el ticket impreso sin señal usará un número local provisional (se resuelve en la interfaz de caja).
- Pendiente: sincronización entre cajas por red local, y cancelar ventas sin señal (el código de autorización se valida contra el servidor).

## Super panel (Bloque 3)

- Acceso propio (`/admin/login`), separado del de los negocios. No tiene ninguna ruta a ventas, caja ni inventario.
- **Prueba → Vencido** al terminar la prueba o la mensualidad (automático). Vencido: puede entrar, ver su estado y escribir al buzón; todo lo demás responde 402 y los datos quedan intactos. Las ventas hechas sin señal quedan pendientes en la caja y se envían al reactivar.
- **Suspendido**: decisión del super panel, permitida solo tras `suspend_after_days` días vencido.
- **Pago** (`/admin/businesses/:id/payments`): vuelve a Activo, extiende el periodo y aplica el plan pendiente.
- Cambio de plan: se aplica al siguiente pago salvo `applyNow` (en prueba, al momento). Al bajar, los usuarios y sucursales sobrantes (los más nuevos) quedan desactivados, nunca borrados. El usuario del dueño cuenta dentro de los usuarios del plan.
- Valores provisionales, editables en `/admin/settings`: prueba 14 días, suspensión tras 30 días vencido. Las solicitudes de cambio no registran costo.
- Pendiente: verificación en dos pasos para el super panel; método para verificar identidad del dueño que perdió su teléfono (hoy el super panel escribe el motivo y queda en bitácora).
