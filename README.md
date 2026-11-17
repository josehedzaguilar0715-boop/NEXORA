# NEXORA

Sistema de punto de venta por giro con base común. Especificación: ver `NEXORA_SPEC.md` (v1, 2026-11-16).

## Estado

- **Bloque 1 (base)**: cuentas, acceso y roles, código de autorización, caja y corte, bitácora inmutable, tickets. ✅ con pruebas.
- **Bloque 2 (sin internet y nube)**: cola local de la caja (`src/client/outbox.ts`), llave de idempotencia, sincronización de cambios con conflictos "gana el más reciente" y panel del dueño (`/dashboard`). ✅ con pruebas.
- **Bloque 3 (super panel)**: estados prueba/activo/vencido/suspendido sin perder datos, pagos y reactivación, planes y límites, alta asistida, restablecer accesos, buzón de soporte y solicitudes de cambio. ✅ con pruebas.
- **Bloque 4 (módulo común)**: clientes finales con QR, escaneo validado por el servidor, membresías por usos y periodo, promociones automáticas, fidelidad (puntos o sellos), asistencia de clientes y personal. Cada módulo se activa por negocio. ✅ con pruebas.
- **Bloque 5 (abarrotes) — servidor**: catálogo con presentaciones y códigos de barras, granel por kilo o importe, lotes primero-entra-primero-sale con precio y costo real, compras con fletes repartidos, márgenes sugeridos, caducidad, mermas, conteos, traspasos, proveedores y cuentas por pagar, fiado con límite y abonos, gastos, reportes de utilidad y retiro sugerido, cajas asignadas. ✅ con pruebas.
- **Bloque 5 (abarrotes) — pantallas**: app web instalable (`web/`) con caja (lector de código de barras, granel por kilo o importe, cobro con cambio, fiado, descuento con código, ventas del turno, retiros, corte), productos con alertas, compras con fletes, clientes y fiado, reportes con retiro sugerido y personal con permisos. Funciona sin internet con contador visible. ✅ con prueba de punta a punta en navegador.
- Siguiente: Bloque 6 (ferretería).

## Desarrollo local

```
npm install
npm test          # pruebas
npm run typecheck
npm run build     # pantallas (web/dist)
npm run dev       # http://localhost:3000 — pantallas en / y API en /api (base SQLite en data/nexora.db)
npm run web:dev   # pantallas con recarga en vivo en :5173 (usa la API de :3000)
npm run e2e       # prueba de punta a punta en navegador (requiere npm run build)
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

## Módulo común (Bloque 4)

- Activar con `PUT /modules` (`membresias`, `promociones`, `fidelidad`, `asistencia`). Un módulo apagado responde 409 `modulo_inactivo`.
- QR: cada cliente tiene un código aleatorio de 20 caracteres (`NX…`). `GET /public/qr/<código>.svg` le da su QR para descargar. `POST /scan` valida el código contra el negocio y aplica `entrada`, `membresia` o `consulta`.
- "Misma visita" = mismo día local: un código no registra dos entradas ni usa la membresía dos veces el mismo día.
- Membresías: usos por periodo (día, semana o mes, contados desde el inicio). Al venderse se copia el plan, así que editarlo no cambia lo ya vendido ni lo consumido.
- Promociones: porcentaje (en puntos base: 1000 = 10 %) o monto, con vigencia, a qué aplica (todo, productos o categorías) y cantidad mínima. Se aplica sola en la venta: la mejor no combinable o todas las combinables juntas, lo que convenga más. No requiere código porque la definió el dueño.
- Fidelidad: puntos por monto o sellos por visita, para todos o solo para clientes inscritos. Al cancelar una venta se registra un movimiento contrario; el saldo puede quedar negativo si ya canjeó.
- Pendiente: cobrar la membresía o el premio como línea de venta (se conecta con productos en el Bloque 5).

## Abarrotes (Bloque 5)

- Cantidades de inventario en milésimas de la unidad base (1 pieza = 1000; 1 kg = 1000 g), así no hay errores de redondeo.
- **Compras**: cada renglón crea un lote con su costo. Los fletes (gasolina, casetas…) se reparten por pieza o por kilo según el producto; el reparto es exacto al centavo. Se pueden dar de alta productos nuevos desde el mismo ticket. Contado (opcionalmente desde la caja) o crédito (cuentas por pagar con abonos).
- **Precio por lote**: cada lote guarda su precio de venta. Se vende primero el lote más viejo, así el precio nuevo entra solo al agotarse el anterior. Un cambio de precio del producto (con código) aplica también a lo que ya está en existencia.
- **Margen sugerido** por producto o, si no, por categoría (puntos base: 3000 = 30 %). Sin margen no hay sugerencia.
- **Venta**: por pieza, presentación (paquete) o granel por kilo (báscula) o por importe. Cambiar el precio en caja pide permiso y código. Efectivo recibido y cambio. Sin existencia registrada la venta no se rechaza (puede llegar de una caja sin señal): queda en negativo y sale en la alerta de stock mínimo.
- **Fiado**: límite por cliente; pasar el límite pide el código del dueño (no de un encargado). Los abonos en efectivo entran al corte como depósito. Cancelar una venta fiada devuelve el cargo.
- **Retiro sugerido** = utilidad del periodo − reserva (días de gastos fijos que define el dueño) − reposición (lo que cuesta llevar al mínimo los productos que están por debajo). Utilidad = ventas − costo de lo vendido − mermas − gastos.
- Para los giros siguientes, `saleHooks`, `cancelHooks` y `saleValidators` en `src/sales.ts` permiten agregar comisiones, recetas, propinas, etc. sin tocar la venta base.

## Pantallas (Bloque 5)

- Se sirven desde el mismo servidor; la API vive en `/api`. Navegación por permisos: lo que el usuario no puede hacer no aparece.
- Link único para empleados: `/?negocio=CODIGO` llena el código del negocio.
- Sin internet: la apertura, las ventas, los retiros y el corte se guardan en el equipo (cola local) y se envían solos al volver la señal. El botón verde/naranja de arriba es el contador de pendientes. Descuentos, cambios de precio y fiado necesitan señal porque el código se valida en el servidor.
- Ticket: se imprime con la impresora térmica del sistema (58 mm). Abrir el cajón y leer la báscula directo desde el navegador quedan pendientes (se capturan a mano por ahora).
