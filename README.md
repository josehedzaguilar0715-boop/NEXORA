# NEXORA

Sistema de punto de venta por giro con base común. Especificación: ver `NEXORA_SPEC.md` (v1, 2026-11-16).

## Estado

- **Bloque 1 (base)**: cuentas, acceso y roles, código de autorización, caja y corte, bitácora inmutable, tickets. ✅ con pruebas.
- Siguiente: Bloque 2 (sincronización sin internet).

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
