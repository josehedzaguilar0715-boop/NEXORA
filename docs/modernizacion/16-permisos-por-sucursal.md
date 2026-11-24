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

## Decisiones que conviene conocer

1. Clientes y fiado se comparten entre sucursales (un cliente es del negocio).
2. Permisos ya guardados no se tocaron: un empleado que ya tenía `view_reports` guardado lo conserva hasta que el dueño lo quite.
3. `/staff/sellers` muestra nombres de compañeros de la misma sucursal (para elegir quién atendió).
4. La agenda es de la sucursal (no por empleado).
5. En negocios de una sola sucursal, «su sucursal» y «el negocio» coinciden: contabilidad sigue disponible para quien tenga «ver reportes».

## Pruebas

* `test/puestos-sucursales.test.ts` (14): encargado de la sucursal 2 no lee ni modifica la 1 (exploración de todas las rutas GET con marcas de la sucursal 1, más lectura/escritura por identificador); empleado no ve operaciones de otro; `branchId`/ids manipulados en dirección y cuerpo; el dueño lee y administra ambas; «Mi día».
* `scripts/verificacion/puestos.ts`: navegador real, escritorio 1366×900 y celular 390×844, con dueño, encargado 2 y empleado (32 comprobaciones).
* `test/permisos-reportes.test.ts` actualizado a la nueva política.
