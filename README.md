# NEXORA

Sistema de punto de venta por giro con base común. Especificación: ver `NEXORA_SPEC.md` (v1, 2026-11-16).

## Estado

- **Bloque 1 (base)**: cuentas, acceso y roles, código de autorización, caja y corte, bitácora inmutable, tickets. ✅ con pruebas.
- **Bloque 2 (sin internet y nube)**: cola local de la caja (`src/client/outbox.ts`), llave de idempotencia, sincronización de cambios con conflictos "gana el más reciente" y panel del dueño (`/dashboard`). ✅ con pruebas.
- **Bloque 3 (super panel)**: estados prueba/activo/vencido/suspendido sin perder datos, pagos y reactivación, planes y límites, alta asistida, restablecer accesos, buzón de soporte y solicitudes de cambio. ✅ con pruebas.
- **Bloque 4 (módulo común)**: clientes finales con QR, escaneo validado por el servidor, membresías por usos y periodo, promociones automáticas, fidelidad (puntos o sellos), asistencia de clientes y personal. Cada módulo se activa por negocio. ✅ con pruebas.
- **Bloque 5 (abarrotes) — servidor**: catálogo con presentaciones y códigos de barras, granel por kilo o importe, lotes primero-entra-primero-sale con precio y costo real, compras con fletes repartidos, márgenes sugeridos, caducidad, mermas, conteos, traspasos, proveedores y cuentas por pagar, fiado con límite y abonos, gastos, reportes de utilidad y retiro sugerido, cajas asignadas. ✅ con pruebas.
- **Bloque 5 (abarrotes) — pantallas**: app web instalable (`web/`) con caja (lector de código de barras, granel por kilo o importe, cobro con cambio, fiado, descuento con código, ventas del turno, retiros, corte), productos con alertas, compras con fletes, clientes y fiado, reportes con retiro sugerido y personal con permisos. Funciona sin internet con contador visible. ✅ con prueba de punta a punta en navegador.
- **Bloque 6 (ferretería)**: varias unidades con equivalencias (caja, rollo; granel por metro y litro), escalas de precio por volumen que la caja aplica sola, cotizaciones que no apartan existencia, clientes constructores con límite (código del dueño), clave del proveedor por producto y devoluciones con o sin ticket (siempre con código). El negocio tiene un **giro** y las pantallas se adaptan. ✅ con pruebas y prueba en navegador.
- **Bloque 7 (papelería)**: servicios por hoja con precio por tamaño y color, consumibles de uso (tinta, tóner, papel) con costo vía recetas, contador de copiadoras por turno contra hojas cobradas, combos de temporada con un solo precio, encargos con anticipo (la devolución la decide el dueño con código) y mayoreo con escalas y crédito. ✅ con pruebas y prueba en navegador.
- **Bloque 8 (barbería)**: agenda por barbero con horarios, días de descanso y bloqueos; citas en mostrador y clientes sin cita en la misma agenda; combos con precio repartido; comisiones por barbero y servicio/producto/categoría sin valores predeterminados (sobre precio final, cada venta guarda su %); propinas aparte; productos en la misma cuenta; reserva pública por link con "el primero disponible", solo horas libres, pendiente hasta confirmar y estado visible. Sin recordatorios automáticos (botón para preparar WhatsApp). ✅ con pruebas y prueba en navegador.
- **Bloque 9 (estudio de uñas)**: agenda por técnica con tiempo de secado que bloquea; consumibles por técnica; comisiones por técnica (categoría) y propinas aparte; paquetes de sesiones (N usos en su vigencia); notas libres que solo escribe el dueño; a domicilio (todos o algunos servicios, dirección privada, traslado que bloquea la agenda, cargo opcional apagado y fuera de comisión); recordatorio de retoque opcional y apagado, que solo prepara el mensaje. ✅ con pruebas.
- **Bloque 10 (perfumería)**: variantes por marca, fragancia, ml y presentación (cada una con código de barras y costo); decants que abren frascos, descuentan ml y crean los chicos con costo proporcional (más envase); testers y muestras como inventario de uso; devoluciones solo de sellados, con ticket y código; sets con un precio y empaque como consumible; comisiones por asesora, marca o categoría. ✅ con pruebas.
- **Bloque 11 (baños públicos)**: tarifas editables combinadas en una entrada con ticket y hora; pases por día, semana o mes con QR que también registra asistencia; conteo de accesos por hora, día y servicio; insumos de uso descontados por acceso según la referencia del dueño; control de limpieza por turno; gastos fijos para la reserva; cobro por tiempo activable por servicio. ✅ con pruebas.
- **Bloque 12 (lugar turístico)**: boletos por tipo con precio editable, por fecha y horario con aforo (nunca se vende de más); aforo en tiempo real; venta anticipada por link con QR por boleto (queda por pagar y cuenta para el aforo); acceso con QR que rechaza repetidos, vencidos, cancelados y sin pagar; taquilla con corte por tipo de boleto; visitas guiadas con cupo y guía; tienda y estacionamiento aparte; cierre temporal con código que prepara avisos y cancela los afectados; reembolsos solo con código del dueño; grupos vía promociones; reportes por día, horario, tipo y canal. ✅ con pruebas.
- **Bloque 13 (palapa)**: mesas con cuenta abierta; comandas a cocina y barra con mesa y hora; cobro en mesa completo o dividido por persona o por producto; propinas por mesero aparte; reservas de mesa confirmadas por dueño o encargado; consumo mínimo por mesa; renta de sillas, camastros y sombrillas con su propio control; recetas e insumos; precio por kilo del día con código; merma de perecederos; bebidas y hielo con costo; tolera reenvíos sin señal. ✅ con pruebas.
- Siguiente: Bloque 14 (restaurante).

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

## Ferretería (Bloque 6)

- Unidades: la unidad base del producto (pieza, kg, metro, litro) más presentaciones con su equivalencia (Caja 100 = 100 piezas; Rollo = 100 m), capturada una vez por producto.
- Escalas por volumen (`PUT /products/:id/price-tiers`): aplica la escala de mayor cantidad mínima alcanzada. Un precio distinto en caja sigue pidiendo código.
- Cotizaciones (`/quotes`): fijan precio por su vigencia (15 días por defecto), no apartan existencia; `POST /quotes/:id/convert` crea la venta con esos precios y ahí descuenta. Un precio especial en la cotización pide código al cotizar.
- Devoluciones (`/returns`): con ticket (por renglón, sin pasar de lo vendido, en proporción a lo cobrado) o sin ticket (producto y monto). Siempre con código. Lo que regresa en buen estado vuelve al inventario; lo dañado (`restock: false`) no. Una venta fiada se devuelve bajando la deuda.

## Papelería (Bloque 7) y piezas comunes nuevas

- **Servicios** (`/services`): catálogo sin inventario propio, con precio, duración y atributos del giro (tamaño, color, técnica…). Se venden con `serviceId` en la venta. Lo usarán barbería, uñas, baños y turístico.
- **Recetas** (`PUT /recipes/:id`): lo que gasta un servicio o producto por unidad, en millonésimas (una copia = 1/20 000 de cartucho). La fracción sobrante se acumula para no perder consumo. Lo gastado se registra como "consumo" con su costo, que entra al costo de lo vendido.
- **Uso interno**: productos con `sellable: false` (tóner, papel, insumos) no aparecen ni se venden en la caja.
- **Combos** (`PUT /products/:id/combo`): un precio, y al venderse descuenta sus componentes.
- **Contador de copiadora**: lectura de inicio y fin por turno; `GET /shifts/:id/counters` marca la diferencia contra las hojas cobradas.
- **Encargos** (`/orders`): el anticipo se cobra como venta (entra al corte); al entregar se cobra el saldo. Cancelar con devolución de anticipo exige el código del dueño.
- Reportes: las devoluciones ya restan de la utilidad (y lo que regresa al inventario recupera su costo).

## Barbería (Bloque 8) y agenda común

- **Agenda** (`src/agenda.ts`): el dueño marca quién atiende y su horario semanal (`PUT /staff/:id/agenda`); un día sin horario es de descanso. Bloqueos con `POST /staff/:id/blocks`. Huecos de 15 minutos. La duración de una cita es la suma de sus servicios (más el bloqueo extra de cada servicio, p. ej. secado, en `attrs.extraBlockMin`).
- **Estados de cita**: pendiente (por link) → confirmada → en atención → atendida (al cobrar), o cancelada / no vino. Cobrar la cita (`/appointments/:id/checkout`) crea la venta con los servicios al precio agendado, productos extra, descuentos y propinas.
- **Comisiones** (`src/commissions.ts`): reglas del dueño por persona y por servicio, producto, categoría o todo; gana la más específica. Sin regla no hay comisión; sin quien atendió tampoco. Base = precio final con descuentos y promociones repartidos. Cada venta guarda el % aplicado. Cancelar la venta anula la comisión y la propina.
- **Propinas**: por persona, no son ingreso del negocio ni cuentan para comisión. Las de efectivo se suman a lo que debe haber en caja (están físicamente ahí) como renglón aparte.
- **Reserva por link**: `/reservar/<código del negocio>` (módulo `reservas`, apagado por defecto). Muestra solo horas libres, no expone datos de otros clientes, limita 3 reservas pendientes por teléfono, y `/cita/<token>` muestra el estado. Pendiente de decidir si se cobra como módulo o sitio aparte (sección 12).

## Estudio de uñas (Bloque 9)

- Técnicas = servicios con `attrs.technique`, duración y `attrs.extraBlockMin` (secado). Comisión por técnica con reglas de categoría.
- Paquetes de sesiones: plan con `kind: 'paquete'`, `usesPerPeriod` sesiones en total y `validityDays`.
- A domicilio: la clienta puede tener `homeAll` (todas sus citas a domicilio) o elegir en cada cita. La dirección se guarda en el cliente y nunca sale en el link público. El traslado (`travelMin`) bloquea antes y después de la cita. Cargo por traslado en `PUT /settings { travelFee }` (apagado por defecto), sin comisión.
- Retoque: `attrs.retouchDays` en el servicio y módulo `recordatorios` (apagado). `GET /reminders/retouch` lista a quién le toca y prepara el WhatsApp; no envía nada.

## Perfumería (Bloque 10)

- Variantes = productos con `attrs` (`brand`, `fragrance`, `sizeMl`, `presentation`). La búsqueda también busca en marca y fragancia.
- Decants (`POST /decants`): usa primero frascos ya abiertos (`GET /open-bottles`) y abre los que falten; el costo por ml sale del costo del frasco. Envase opcional como consumible.
- Testers y muestras: productos de uso interno (`sellable: false`); su gasto se registra con `POST /testers/use`. No se venden ni se devuelven.
- Devoluciones: en perfumería exigen ticket y que el renglón venga marcado `sealed: true`.
- Comisiones: nueva regla `brand` (por marca), además de producto, categoría y persona.

## Baños públicos (Bloque 11)

- Tarifas = servicios. `POST /baths/entry` cobra varias en una entrada y registra el acceso. Un servicio con `attrs.timeRate { blockMin, blockPrice }` no se cobra al entrar: se cobra a la salida (`/baths/accesses/:id/exit`) por bloques empezados.
- Pases: plan de membresía `kind: 'pase'` con periodo día/semana/mes. `POST /baths/pass-entry` valida el QR, cuenta el acceso y registra asistencia (una por día). No vuelve a entrar dentro de `passReentryMin` minutos (30 por defecto, en `/settings`).
- Insumos por acceso: `PUT /baths/access-supplies` (ej. 0.025 rollo por acceso = uno cada 40), descontados con acumulación exacta.
- Limpieza: tareas del dueño, y cada quien marca la que hizo con hora y turno. No se muestra fuera del negocio.

## Lugar turístico (Bloque 12)

- Tipos de boleto = servicios con `category: 'boleto'`. Horarios con aforo por día de la semana (`PUT /tourism/slots`).
- Cada persona tiene su boleto con código propio (`entry_tickets`). `POST /tourism/scan` lo marca usado y suma al aforo; `POST /tourism/exit` resta salidas.
- Venta anticipada: `/boletos/<código del negocio>` (módulo `reservas`). Los boletos quedan "por pagar" (sin pasarela de pago en línea: se cobran en taquilla con el folio). No entran sin pagar.
- Cierres (`POST /tourism/closures`) y cancelaciones (`POST /tickets/cancel`) exigen el código del dueño; reembolsar es decisión explícita, nunca automática.
- Pendiente: cobro en línea (requiere elegir una pasarela de pago).

## Comida: núcleo común (Bloque 13, `src/dining.ts`)

- **Platillos**: productos con `trackStock: false` y receta; al venderse descuentan solo sus insumos. `attrs.station` decide a qué estación va (cocina, cocina_caliente, cocina_fria, barra, postres…) y `attrs.modifiers` sus variantes con precio extra.
- **Cuentas** (`/tabs`): mesa, para llevar o para recoger. Los precios quedan fijos al pedir. `send` arma una comanda por estación; `GET /kitchen?station=` es la pantalla de cada estación; `POST /comandas/:id/ready` la marca lista (tiempos de cocina en `/reports/kitchen-times`).
- **Cobro** (`/tabs/:id/checkout`): una o varias partes (todo, por persona o por renglones). Cada parte es una venta normal, con propina para el mesero. Al cerrar, la mesa pasa a limpieza y el mesero la libera.
- **Cancelar o regalar** un renglón siempre pide el código del dueño y queda en bitácora.
- **Consumo mínimo** por mesa: al cerrar se cobra la diferencia. (Por horario: pendiente.)
- **Renta de activos** (`/rental-assets`, `/tabs/:id/rentals`): disponibilidad propia; regresan al cerrar la cuenta.
