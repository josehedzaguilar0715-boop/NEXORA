# Permisos por sucursal: situación actual y recomendación

Fecha: 24 nov 2026. Rama `modernizacion`. **Es una recomendación: no se cambió el código.** Implementarla requiere tu decisión.

## 1. Cómo funciona hoy (comprobado con una prueba real, no supuesto)

* Los usuarios son **dueño** (uno por negocio) o **personal**.
* El personal se crea con una plantilla editable de permisos: Cajero, Encargado, Barbero, Empleado de piso y Cocina (`src/permissions.ts`).
* **No existe un rol «administrador»**: hoy el encargado hace de administrador.
* Cada empleado tiene una **sucursal asignada**. Se usa como **valor por omisión**: su caja, su turno y el inventario que ve al entrar.
* **Pero no limita lo que puede consultar o cambiar.** Prueba con un negocio de 2 sucursales, un cajero y un encargado asignados a la sucursal 2:

| Qué se probó | Resultado hoy |
|---|---|
| El cajero de la sucursal 2 consulta la existencia de la sucursal 1 | ✅ La ve (8 piezas) |
| El cajero ve el resumen de ventas de la sucursal 1 y el de todo el negocio | ✅ Los ve ($60.00) |
| El cajero lista las ventas | Ve **todas** las del negocio (todos tienen «ver reportes») |
| El encargado de la sucursal 2 ajusta el inventario de la sucursal 1 | ✅ **Puede** (respuesta 200) |
| Un empleado de **otro negocio** intenta cualquiera de lo anterior | ❌ Bloqueado: el aislamiento entre negocios está probado en 87 listas y ~90 rutas |

**Conclusión.** Entre negocios no hay ningún riesgo. Dentro de un negocio con varias sucursales, cualquier empleado puede ver la información de todas, y quien edita inventario puede editar el de cualquier sucursal.

En un negocio de **una sola sucursal** (el plan base) esto no importa: todo es de la misma sucursal.

## 2. Recomendación

| | **Dueño** | **Administrador** (nuevo) | **Encargado** | **Empleado** (cajero, barbero, técnica, mesero, cocina) |
|---|---|---|---|---|
| Para quién | El propietario | Gerente general de confianza con varias sucursales | Responsable de **una** sucursal | Quien vende o atiende |
| Sucursales que ve | Todas | Todas | **Solo la suya** | **Solo la suya** |
| Ventas y reportes | Todo, con comparación entre sucursales | Todo, con comparación entre sucursales | Los de su sucursal | **Solo sus ventas y su turno**. Hoy ve todo: es la decisión pendiente de «ver reportes para todos». |
| Finanzas (utilidad, 50/30/20, retiro sugerido, balance) | Sí | Sí, solo lectura | No | No |
| Caja | Cualquiera; corte de cualquier caja | Cualquiera | Las de su sucursal; autoriza con su código | Solo la suya |
| Cancelar, descontar, cambiar precio | Directo | Con su código | Con su código, en su sucursal | Pide el código del encargado o del dueño |
| Inventario: ver | Todas las sucursales | Todas | Su sucursal (y la existencia de otras **solo para pedir un traspaso**) | Su sucursal |
| Inventario: compras, ajustes, mermas | Todas | Todas | **Solo su sucursal** | No |
| Traspasos entre sucursales | Sí | Sí | Solicita; envía desde la suya | No |
| Catálogo y precios del negocio | Sí | Sí | No (o solo precios locales, si se usan) | No |
| Personal | Crea, edita y da de baja a todos | Crea y edita personal (no dueños ni administradores) | Ve a su equipo; asistencia de su sucursal | Su asistencia |
| Comisiones y pagos al personal | Todo | Todo | Las de su sucursal; paga con código del dueño | Solo las suyas |
| Plan, pagos de NEXORA, enlace público, respaldos | Sí | No | No | No |
| Bitácora | Toda | Toda | La de su sucursal | No |

**Principios:**

1. **La sucursal asignada debe ser un límite, no solo un valor por omisión**, para todo el que no sea dueño ni administrador.
2. **Menos es más para el empleado:** que vea lo que necesita para vender. Las cifras del negocio (utilidad, ventas totales) son información sensible para el dueño.
3. **Un negocio de una sola sucursal no nota ningún cambio.**

## 3. Cómo implementarlo (si lo autorizas)

1. Permiso nuevo **«Todas las sucursales»**, que solo tienen el dueño y la plantilla nueva **Administrador**.
2. Un solo punto de control: la función que decide la sucursal de cada consulta (`branchOf` en `src/inventory.ts`, y los filtros de reportes y ventas). Si el usuario no tiene «Todas las sucursales» y pide otra sucursal, responde «No tienes acceso a esa sucursal» (403).
3. Reportes, ventas, cortes, comisiones y bitácora filtran por la sucursal del usuario cuando no tiene «Todas las sucursales».
4. Decidir si «ver reportes» sigue siendo de todos (hoy sí) o solo de encargado en adelante.
5. **Pruebas:** extender el barrido automático de aislamiento (`test/aislamiento-listas.test.ts`) a sucursales. Un empleado de la sucursal 2 pidiendo los ids de la sucursal 1 no debe recibir nada.
6. Estimado: **2 a 3 días** con pruebas. No requiere migración destructiva: solo un permiso nuevo en la lista.

**Efecto en los 3 negocios actuales:** si tienen una sola sucursal, ninguno. Los empleados seguirían viendo lo mismo, salvo lo que decidas sobre «ver reportes» (punto 4).
