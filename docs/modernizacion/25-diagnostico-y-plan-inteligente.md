# 25 · Diagnóstico, arquitectura propuesta y plan — «NEXORA inteligente, simple y profesional»

Rama `diseno-v0`. **Etapa de investigación y auditoría: no se modificó código de negocio.** Todo lo marcado «propuesta» espera aprobación.

## 1. Diagnóstico (hechos medidos en el código y con `scripts/verificacion/permisos-rutas.ts`)

### Finanzas
- `src/accounting.ts` impone el reparto **50/30/20** (`DEFAULT_RULE`) y un «retiro sugerido» (`financialPlan`). Es editable solo entre tres cubetas fijas (operación / dueño / ahorro), siempre sobre la *utilidad bruta*, no sobre dinero disponible.
- Ya existen los datos reales para algo mejor: ventas, devoluciones, costo de lo vendido, gastos, comisiones, mermas, gastos fijos, reserva, reposición necesaria, efectivo en cajas (`balanceSheet`), `cash_movements` (retiros/depósitos de caja).
- Falta: registro de **retiros del dueño** con categoría/responsable/motivo (hoy solo hay retiro de *caja*), compromisos/pagos pendientes en un mismo lugar, y una vista única «entró / salió / ganancia real / disponible / por reservar / retirable».
- Finanzas tiene 6 pestañas técnicas (Resumen, Estado de resultados, Flujo, Balance, Gastos, Movimientos) y `Reportes` repite «Ventas y retiro»: **duplicidad** con Dinero/Ventas/Comisiones.

### Permisos
- Matriz real: dueño 83 rutas GET con 200, encargado 68, empleado 44.
- `/dashboard/panel` responde **403 a empleado** (correcto) y el empleado ve «Mi día». No pude reproducir que un empleado vea el dashboard general; falta que el usuario indique en qué pantalla/rol lo vio (puede ser un *encargado*, que sí lo ve por diseño, o un usuario legado con `view_reports`).
- **Fugas menores reales** para empleado: `/products` devuelve `marginBp` y `lastCost` (margen y costo); `/receivables` devuelve `total` de cuentas por cobrar. Son datos confidenciales según el nuevo criterio.
- No existe rol «Administrador autorizado» (hoy: Dueño, Encargado, Empleado). Introducirlo cambia la estructura de puestos aprobada → **requiere tu decisión**.

### Agenda ↔ Caja
- `appointments.sale_id` existe (la cita puede ligarse a una venta). Estados activos: pendiente, confirmada, en_atencion.
- Página pública `/public/book/:code` devuelve nombre del negocio, teléfono, giro, servicios y personal con `publicName` (nombre + inicial del apellido). **No expone** nombre del dueño ni enlaces internos; falta mostrar logo y horario y auditar el resto de campos de la respuesta.
- «Agenda Libre vs Pro»: falta revisar contra la suscripción real (por auditar en etapa 3).

### Caja y tickets
- Existe lógica de ticket/venta y devoluciones; **no existe soporte de CFDI** (búsqueda en `src/` y `web/src` sin resultados). Por tanto todo comprobante debe decir que **no es factura**.
- Por auditar en etapa 4: anchos 58/80 mm, folios consecutivos, reimpresión, logo.

## 2. Arquitectura funcional propuesta
**Finanzas inteligentes** (un solo menú «Finanzas»):
1. **Hoy / Periodo**: Entró · Salió · Ganancia real · Disponible · Por reservar · Retirable · Para ahorro/reinversión. Cada cifra con «¿cómo se calcula?».
2. **Reparto del dueño**: configuraciones guardadas (nombre, partidas libres, % o monto fijo), recálculo en vivo, validación de suma = 100 % (o = disponible), una marcada «activa». El 50/30/20 deja de ser regla; queda como *plantilla opcional* entre otras.
3. **Retiros y salidas**: registro con fecha, monto, categoría, responsable, motivo; auditoría. El retiro sugerido es **opcional**: aceptar / modificar / rechazar (queda registrado).
4. **Reportes** (secundario): Estado de resultados, Flujo, Balance.
Cálculo de «retirable» = efectivo y bancos reales − compromisos próximos − reserva − reposición de inventario − comisiones/nómina pendientes (usa datos que ya existen; nunca ventas ni utilidad contable solas).

**Permisos**: matriz por función (no solo por rol), validada en backend. Propuesta de roles: Dueño · Administrador autorizado (funciones concedidas expresamente, p. ej. `ver_finanzas`) · Encargado · Empleado. Los datos financieros se filtran **en la consulta** (campos de costo/margen/total solo con permiso), no ocultándolos en la interfaz.

**Agenda**: Agenda independiente de Caja. Flujo: crear → confirmar → atender → completada → *operación pendiente de cobro* → Caja cobra → ticket → Finanzas.

**Ticket**: plantillas 58 y 80 mm, folio consecutivo por negocio/sucursal, leyenda «Comprobante de venta — no es factura (CFDI)».

## 3. Propuesta visual
Se conserva la identidad azul única de v0. Finanzas: seis tarjetas de cifras (container queries ya existentes), debajo el reparto como barra apilada editable y la lista de retiros. Botón de ayuda «¿cómo se calcula?» por cifra. Texto ≥ 18 px en celular. Sin pestañas técnicas en primer plano.

## 4. Flujos clave
- Dueño registra venta → Finanzas «Entró» sube → «Retirable» se recalcula.
- Dueño abre Reparto → cambia % → ve montos en vivo → guarda configuración → activa.
- Dueño retira → pide categoría y motivo → queda en bitácora → «Disponible» baja.
- Empleado abre Inicio → «Mi día»; cualquier URL financiera → 403.

## 5. Riesgos y dependencias
| Riesgo | Mitigación |
|---|---|
| Migración de la regla 50/30/20 existente | Convertirla en una configuración guardada llamada «Plan anterior 50/30/20», sin borrar datos (migración append-only) |
| Mal cálculo de «retirable» | Pruebas con fixtures numéricos + mostrar siempre el desglose |
| Nuevo rol cambia permisos de clientes activos | Solo aditivo; ningún usuario existente cambia de rol; **requiere tu aprobación** |
| Leyendas fiscales | Verificar en sat.gob.mx antes de fijar texto |
| Impresión 58/80 mm sin hardware real | Pruebas solo de vista previa/ancho; marcar «no probado en impresora real» |
| Cambios de API | Rutas nuevas bajo `/finance/*`; las actuales siguen funcionando hasta aprobar su retiro |

## 6. Plan de implementación (un módulo a la vez, cada uno con pruebas, documento y commit)
1. Finanzas inteligentes: migración (`distribution_configs`, `owner_withdrawals`), cálculo, API, pantalla, pruebas.
2. Dashboard y permisos: filtrado de campos en `/products` y `/receivables`; pruebas de acceso directo por rol; Administrador autorizado (tras tu decisión).
3. Agenda → cobro pendiente; revisar Libre/Pro; privacidad de la página pública.
4. Caja y tickets 58/80 mm.
5. Automatizaciones por giro (barbería, abarrotes, restaurante, ferretería, perfumería, uñas).
6. Revisión del resto de productos.

## 7. Criterios de aceptación (por módulo)
- Funciona con datos reales de prueba y supera pruebas automáticas (vitest) y de interfaz (Playwright).
- Un empleado recibe 403/ausencia de campos en toda ruta financiera, probado por acceso directo.
- Las cifras de Finanzas cuadran con los registros (prueba numérica) y distinguen ventas, ganancia y efectivo.
- Suma del reparto validada; retiro sin categoría/motivo rechazado.
- Texto ≥ 18 px en celular, contraste AA (auditor existente), sin errores en consola.
- Documentado qué es prueba automática, simulación o prueba real.

## 8. Decisiones que necesito de ti antes de implementar
1. ¿Apruebas el rol **Administrador autorizado** (aditivo, no cambia a usuarios actuales)?
2. ¿Convertimos el 50/30/20 existente en una configuración guardada («Plan anterior») en lugar de borrarlo?
3. ¿Qué plan incluye Agenda **Pro** y qué incluye **Libre**? (hoy no lo puedo deducir del código con certeza).
4. ¿En qué pantalla/rol viste a un empleado con acceso al Dashboard?
