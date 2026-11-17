# NEXORA

Sistema de punto de venta por giro con base común. Especificación: ver `NEXORA_SPEC.md` (v1, 2026-11-16).

## Estado

- **Bloque 1 (base)**: cuentas, acceso y roles, código de autorización, caja y corte, bitácora inmutable, tickets. ✅ con pruebas.
- **Bloque 2 (sin internet y nube)**: cola local de la caja (`src/client/outbox.ts`), llave de idempotencia, sincronización de cambios con conflictos "gana el más reciente" y panel del dueño (`/dashboard`). ✅ con pruebas.
- Siguiente: Bloque 3 (super panel).

## Desarrollo local

```
npm install
npm test          # pruebas
npm run typecheck
npm run dev       # API en http://localhost:3000 (base SQLite en data/nexora.db)
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
