# 16 · Puestos y alcance por sucursal (IMPLEMENTADO, 24 nov 2026)

Decisión del propietario: **tres puestos, ni uno más**. No se agrega un cuarto rol de administrador y esta estructura no se cambia sin consultarlo.

| Puesto | Alcance |
|---|---|
| **Dueño** (`role = owner`) | Todas las sucursales y toda la información del negocio. Administra todo. |
| **Encargado** (`position = encargado`) | Solo **su sucursal**, con los permisos operativos que el dueño le autorice. Solo el dueño nombra encargados. Puede crear/editar **empleados** de su sucursal (si el dueño le dio «Crear empleados») y no puede dar permisos que él no tiene. |
| **Empleado** (`position = empleado`) | Solo lo **propio**: sus ventas, su caja, sus encargos y las actividades autorizadas. No ve ventas privadas de otros empleados ni administra inventario, caja general, usuarios o reportes generales, salvo permisos que el dueño le dé expresamente. |

## Dónde se hace cumplir (servidor, no botones)

* `src/context.ts`: `puestoOf(u)`, `isManager(u)`. Los usuarios existentes sin puesto se clasifican solos (con «cancelar/descuento» → encargado; si no → empleado), así que **no hubo migración de datos**; la migración 41 solo agrega la columna `users.position` (aditiva, nullable).
* `src/scope.ts`:
  * `scopeGuard` (middleware global, después de la sesión): rechaza (403 `otra_sucursal`) cualquier `branchId`, `fromBranch`, `toBranch`, `fromBranchId`, `toBranchId` ajeno en la dirección o en el cuerpo; revisa los identificadores en la ruta, dirección o cuerpo (venta, turno, compra, gasto, cita, cuenta, mesa, apartado, cotización, encargo, usuario…) contra su sucursal; y, para un empleado sin «ver reportes», contra su propio usuario (403 `no_es_tuyo`).
  * `scopeBranch(c)` / `scopeOwn(c)`: filtros que cada lista, reporte y total aplica (dueño: todas, opcionalmente `?branchId=`; los demás: la suya; empleado: solo lo suyo).
  * `wholeBusinessOnly`: información que junta todas las sucursales (contabilidad, estados financieros, gastos fijos, conflictos de sincronización) es solo del dueño cuando el negocio tiene más de una sucursal.
* «Ver reportes» **ya no es gratis**: solo lo traen el dueño, el encargado o quien el dueño autorice. Con ese permiso, un empleado ve también ventas de compañeros **de su misma sucursal**, nunca de otra.
* Traspasos entre sucursales: solo dueño.
* Para el empleado, el Inicio es **«Mi día»** (`GET /dashboard/mine`): solo sus ventas del día y su caja.

## Decisiones (resueltas por el propietario, 24 nov 2026)

1. **Clientes compartidos** entre sucursales; el historial de operaciones siempre indica su sucursal (`branchId` en ventas y en cada movimiento de fiado).
2. **Fiado y saldos compartidos**: un cliente tiene un solo saldo; cargos y abonos se pueden hacer desde cualquier sucursal, quedan con quién y en qué sucursal (`createdBy`, `branchId`) y reenviar el mismo identificador no duplica la deuda.
3. **Traspasos entre sucursales**: solo dueño.
4. **Contabilidad consolidada, estados financieros y gastos fijos**: solo dueño en negocios con varias sucursales (con una sola, siguen disponibles para quien tenga «ver reportes»).
5. **Permisos antiguos no amplían el alcance**: un empleado anterior al sistema de puestos (sin puesto guardado) ya **no** conserva «ver reportes» de antes; el dueño debe autorizarlo de nuevo, y al guardar sus permisos queda registrado su puesto. Los encargados anteriores conservan su alcance de sucursal.
6. **Nombres de compañeros**: `/staff/sellers` entrega solo `id` y `nombre` de los compañeros de la misma sucursal (para saber quién atendió), sin datos privados.
7. **Agenda**: compartida dentro de cada sucursal (citas, bloqueos y horarios), nunca entre sucursales.

## Pruebas

* `test/puestos-decisiones.test.ts` (7): decisiones 1–7 (fiado compartido sin duplicar, `branchId` en historial, permisos antiguos, nombres, traspasos y contabilidad, agenda por sucursal).
* `test/migracion-41.test.ts` (1): base en versión 40 con datos → migración 41 aditiva, sin cambiar usuarios, ventas ni puestos.
* `test/puestos-sucursales.test.ts` (15): encargado de la sucursal 2 no lee ni modifica la 1 (exploración de todas las rutas GET con marcas de la sucursal 1, más lectura/escritura por identificador); empleado no ve operaciones de otro; `branchId`/ids manipulados en dirección y cuerpo; el dueño lee y administra ambas; «Mi día».
* `scripts/verificacion/puestos.ts`: navegador real, escritorio 1366×900 y celular 390×844, con dueño, encargado 2 y empleado (32 comprobaciones).
* `test/permisos-reportes.test.ts` actualizado a la nueva política.
