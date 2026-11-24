# 27 · Acceso de empleados al Dashboard: diagnóstico y diseño definitivo de permisos

Rama `diseno-v0`. Evidencia: `scripts/verificacion/empleado-con-reportes.ts` (datos de prueba en memoria).

## 1. Diagnóstico
**Causa raíz:** un único permiso, `view_reports` («Ver reportes y ventas de otros»), abre a la vez las ventas de otros, el **dashboard general**, utilidad, gastos, valor de inventario, tendencia financiera y bitácora. En el código el empleado «sin puesto guardado» no lo conserva, pero **si el dueño se lo marca a un empleado** (o se guarda su puesto) el servidor lo trata como válido. Es el único camino encontrado.

Prueba (empleado con «ver reportes» marcado): `/dashboard/panel` **200**, `/reports/summary` **200**, `/reports/daily` **200**, `/reports/recent` **200**, `/expenses` **200**, `/finance/trend` **200**, `/inventory/value` **200**, `/audit` **200**. (Bloqueados, por otros controles: contabilidad `/accounting/*`, `/fixed-expenses`, `/finance/plan`, `/users`.)

La interfaz lo refleja: `Inicio.tsx` decide con `can('view_reports')` entre «Mi día» y el panel del negocio; `Finanzas` y «Ventas y retiro» también. El menú muestra «Inicio» con icono de tablero: es lo que se percibe como «Dashboard».

Otras fugas (empleado sin «ver reportes»): `/products` incluye `marginBp` y `lastCost`; `/receivables` incluye `total` general.

Sin «ver reportes», el empleado **no** accede al dashboard (403 y «Mi día»): se confirmó en la auditoría anterior.

## 2. Diseño definitivo de permisos
**Puestos:** Dueño · **Administrador autorizado** (nuevo) · Encargado · Empleado.

| Puesto | Alcance de datos | Qué puede |
|---|---|---|
| Dueño | Todo el negocio | Todo |
| Administrador autorizado | Todo el negocio | **Solo lo que el dueño le marque.** No hereda nada. Nace sin permisos. |
| Encargado | Su sucursal | Sin cambios (conserva lo que tiene hoy) |
| Empleado | Lo propio | Operativo. **Nunca** finanzas ni dashboard general, aunque tenga «ver reportes». |

**Permisos nuevos (los asigna solo el dueño):**
| Permiso | Texto para el dueño | Abre |
|---|---|---|
| `view_dashboard` | Ver el resumen general del negocio | `/dashboard/panel`, `/reports/summary|daily|recent|board` |
| `view_finance` | Ver las finanzas (ganancias, gastos, dinero disponible) | `/finance/*`, `/accounting/*`, `/expenses`, `/fixed-expenses`, `/inventory/value`, `/finance/trend` |
| `manage_finance` | Registrar retiros, gastos y el reparto | escritura en finanzas |
| `view_costs` | Ver costos y márgenes de productos | campos `lastCost`, `marginBp` |

**Reglas del servidor** (función única `canFinance(u, 'dashboard'|'finance'|'manage')`):
- Dueño: sí. Administrador: solo si tiene el permiso. Encargado: sin cambios (usa su `view_reports` actual; no se le quita nada a usuarios existentes). **Empleado: nunca**, aunque se le asigne a mano (el servidor ignora esos permisos para ese puesto y la API de usuarios los rechaza al guardar).
- Un administrador no puede dar permisos que no tiene ni editar al dueño; solo el dueño crea administradores.
- Cada cambio de permisos queda en la bitácora (`audit`).
- Campos sensibles (costo/margen/total de fiados) se **quitan de la respuesta** si quien consulta no tiene permiso; no basta con ocultarlos en pantalla.

**Pantalla del empleado («Mi día», operativa):** sus ventas y caja del día, sus citas (si es agenda), sus comisiones si tiene `view_commissions`, accesos directos a Caja/Agenda/Asistencia. Sin utilidades, gastos ni valores del negocio.

## 3. Pendiente de tu decisión (afecta permisos de clientes activos)
Los **encargados actuales** hoy ven dashboard y finanzas de su sucursal con `view_reports`. Tu regla final dice «exclusivo del dueño y administradores autorizados». **No lo cambio por mi cuenta** (prometiste no tocar permisos actuales). Opciones:
- A (por defecto, implementada): los encargados conservan lo que ya tienen; el dueño puede quitárselo.
- B: migrar a todos los encargados a «sin finanzas» y que el dueño lo vuelva a dar.
Dime A o B.

## 4. Pruebas de aceptación
Empleado con `view_reports` → 403 en todas las rutas financieras; `/products` sin `lastCost`/`marginBp`; administrador nuevo → 403 hasta que el dueño le dé permisos, luego 200 solo en esas rutas; usuarios existentes sin cambios (prueba de regresión sobre la matriz `permisos-rutas.ts`).
