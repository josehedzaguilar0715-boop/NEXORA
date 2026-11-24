# 28 · Implementado: Administrador autorizado, acceso financiero y Finanzas inteligentes

Rama `diseno-v0` (commits 12a6834, bb42f61, f7422ac). **Nada publicado, nada tocado en producción ni en datos de negocios activos.**
Tipo de prueba: **A** = automatizada (vitest, base en memoria) · **N** = en navegador real (Playwright, datos de demostración en memoria) · **S** = simulación de migración sobre una base con datos. **No hay pruebas con negocios reales ni con impresoras/hardware.**

## 1. Permisos (decisiones del propietario 1 y 4)
| Qué | Cómo | Prueba |
|---|---|---|
| Puesto **Administrador autorizado** | Columna `users.admin_authorized` (migración 43, aditiva, 0 por omisión). Nace **sin ninguna función**; el dueño marca cada una. Solo el dueño lo crea/edita. No hereda nada del dueño. Ve todas las sucursales, pero solo con lo que se le marcó. | A (6 pruebas), N |
| Funciones nuevas (solo para administrador) | `view_dashboard`, `view_finance`, `manage_finance`, `view_costs`. A un empleado o encargado no se pueden asignar (400) ni valen aunque estén guardadas. | A |
| **Causa del «Dashboard para empleados»** | El permiso único `view_reports` abría panel, utilidades, gastos y bitácora si el dueño se lo marcaba a un empleado. | `scripts/verificacion/empleado-con-reportes.ts`: antes 8 rutas en 200, ahora todas 403 |
| Corrección en servidor | `canFinance()` / `requireFinance()` en 17 rutas (panel, reportes, gastos, contabilidad, bitácora, valor de inventario, tendencia). **Empleado: nunca.** Encargado actual: **sin cambios**. | A |
| Datos sensibles en respuestas | `/products` sin `lastCost`, `marginBp`, `suggestedPrice` para quien no compra ni edita inventario; `/receivables` sin `total` para quien no ve finanzas. | A |
| Pantalla | `/auth/me` devuelve `access`; Inicio, Finanzas y Ventas usan eso. El empleado ve «Mi día». Entrar a `#/finanzas` por la dirección no muestra cifras (y el servidor responde 403). | N |

Pruebas anteriores que fijaban el comportamiento viejo (empleado con «ver reportes» veía finanzas) se **actualizaron** a la decisión del propietario: `permisos-reportes`, `puestos-decisiones`. También se ajustaron los tests de versión de esquema (42 → ≥42) y `productos.test.ts` (ya no hay paleta por producto; verifica identidad única y contraste AA de la paleta azul).

### Pendiente de tu decisión
**Encargados actuales:** siguen viendo panel y finanzas de su sucursal (para no tocar permisos activos). Tu regla final los excluiría. Opción A (implementada): no cambiar. Opción B: quitárselo a todos y que el dueño lo vuelva a dar. **Responde A o B.**

## 2. Finanzas inteligentes (prioridad 1, decisión 2)
- **Mi dinero**: Vendiste · Entró dinero · Salió dinero · Ganancia real · Dinero disponible · Por reservar · Puedes retirar (+ «Para ahorrar o reinvertir» si el reparto tiene esas partidas). Cada cifra tiene «¿Cómo se calcula?».
- **Fórmulas** (`src/finanzas.ts`, todo de registros reales): Entró/Salió = flujo de efectivo real (el fiado cuenta al cobrarlo). Ganancia real = ventas netas − costo de lo vendido − gastos − comisiones − mermas. Disponible = entradas − salidas acumuladas (efectivo y banco, lo que NEXORA ha registrado). Por reservar = proveedores por pagar + comisiones pendientes + anticipos/saldos de clientes + gastos fijos de N días + reposición de inventario. **Retirable = mín(disponible − por reservar, ganancia del periodo aún no retirada).**
- **Reparto**: el dueño crea las partidas que quiera (operación, gastos, nómina, ahorro, reinversión, inversiones, retiro, otro), en % o monto fijo, sobre ganancia real / bruta / ventas; varias configuraciones guardadas, una «En uso»; vista previa en vivo (calculada por el servidor); no se guarda si los porcentajes no suman 100 %. Plantillas: «En blanco» y dos ejemplos (el 50/30/20 es solo un ejemplo). **Nada viene activo.**
- **Plan anterior**: migración 44 conserva la regla de cada negocio (o 50/30/20) como configuración **histórica, inactiva, que no se edita ni se borra**; se puede duplicar. Datos y configuraciones existentes sin cambios.
- **Retiros**: cada uno guarda fecha, monto, categoría, motivo, forma, **responsable** y qué decidió el dueño con la sugerencia (aceptó/modificó/propio). Si sale en efectivo de una caja abierta, también baja en esa caja (el corte no marca faltante) y no se cuenta doble. Sacar más de lo conveniente pide confirmación y queda marcado. **La sugerencia es opcional** (aceptar / cambiar / «No, gracias» anotado en bitácora).
- **Menos duplicidad**: el 50/30/20 y el retiro sugerido obligatorio salieron de «Ventas y retiro» (ahora «Ventas»). Estado de resultados, Flujo, Balance y Movimientos quedan como **Reportes** secundarios. Las rutas viejas `/finance/plan*` siguen en el servidor (sin uso en pantalla) por reversibilidad.
- Pruebas: **A** 9 en `finanzas-inteligentes.test.ts` (reparto al centavo, sumas, plan anterior, retiros, caja, permisos por puesto, migración **S** con base que ya tenía datos); **N** `scripts/verificacion/mi-dinero.ts` (flujos en escritorio y celular, permisos, y auditoría de contraste/letra/desborde en las 9 pestañas, claro y oscuro: 0 hallazgos).
- Suite completa: **313/313** (vitest) y e2e de punta a punta OK.

## 3. Agenda Libre / Pro
Ver `26-agenda-libre-vs-pro.md`: **no existen** esos planes en el código; hay planes por límites, cuenta gratis y el extra «reservas». Sin cambios de suscripción.

## 4. No hecho todavía (honesto)
- Agenda → «pendiente de cobro» → Caja; privacidad de la página pública (logo/horario); tickets 58/80 mm y aviso «no es factura»; automatizaciones por giro; resto de productos.
- Revisión visual en navegador de la pantalla **Personal** al crear/editar un administrador (el flujo se probó por API y por compilación, no con capturas).
- «Disponible» depende de lo capturado en NEXORA: no conoce el saldo real del banco. Si el dueño quiere, se puede agregar un «saldo inicial» (decisión pendiente).
- Cierre del proyecto maestro: auditorías completas finales de todas las pantallas, informe general.
