# 30 · Agenda → Caja, tickets, página pública y automatización de inventario

Rama `diseno-v0`. Nada publicado. **A** = automatizada (vitest) · **N** = navegador con datos de demostración · No hay pruebas con impresora real ni con negocios reales.

## Agenda → Caja (flujo pedido)
Crear → confirmar → atender → **Terminar (pasa a Caja)** → *por cobrar* → Caja cobra → ticket → Finanzas.
- Migración 45: `appointments.completed_at` (columna nula, aditiva; no se creó un estado nuevo para no reconstruir la tabla).
- `POST /appointments/:id/complete` (no toca dinero ni crea venta; una sola vez; auditado) y `GET /agenda/to-charge` (citas terminadas sin venta, de la sucursal, con su total; requiere permiso de vender).
- Cobrar usa el mismo `checkout` de siempre, así que la venta, comisiones, sellos y Finanzas se actualizan como antes; una cita no se cobra dos veces (409).
- Pantalla: en Agenda, botón «Terminar (pasa a Caja)» y etiqueta «Por cobrar en Caja»; en Caja, «Citas por cobrar (N)». El botón «Cobrar» directo desde la Agenda se **conserva** (negocios chicos donde quien atiende cobra); si quieres que sea solo desde Caja, es un cambio de una línea, dime.
- Pruebas: A `agenda-cobro-publica.test.ts`; N `scripts/verificacion/agenda-caja.ts` (Terminar → Caja → Cobrar → nada pendiente) y e2e de punta a punta sigue OK.

## Página pública de reservas
`/public/book/:code` ahora devuelve **logotipo, horario (por día) y servicios**; si quien atiende es el **dueño**, se muestra el **nombre del negocio**, no su nombre personal (en la lista y en el estado de la reserva); los demás aparecen con nombre e inicial. Sin identificadores internos ni permisos (A: busca esas palabras en la respuesta). El teléfono mostrado es el que el negocio capturó como suyo: si es personal, conviene cambiarlo en Ajustes (decisión del dueño). Pantalla: logotipo y horario sobre el nombre.

## Caja y tickets
- `GET /sales/:id/ticket?paper=58|80&reprint=1`: 32 o 48 columnas; negocio, **sucursal** (solo si hay varias), **folio consecutivo por sucursal**, fecha y hora, responsable, renglones (los nombres largos pasan a otra línea, no se cortan), descuento, total, forma(s) de pago, recibido y cambio, «REIMPRESIÓN» y «CANCELADO» cuando aplica.
- **«Comprobante de venta. No es una factura (CFDI).»** en todos. NEXORA no emite CFDI; la leyenda exacta debe confirmarse con tu contador/SAT antes de usarla como texto legal.
- Pantalla: selector 58/80 mm (se recuerda en el equipo) y «Reimprimir» en «Ventas del turno».
- Un defecto propio: en una primera versión el folio se cortaba en 58 mm; lo detectó la prueba y se corrigió.
- Pruebas: A `ticket-formatos.test.ts` (ningún renglón excede el ancho, importes completos, folios 000001/000002, reimpresión, sucursal solo si hay varias); N `scripts/verificacion/ticket.ts` (impresión interceptada: 58 mm ≤ 32 columnas, 80 mm ≤ 48). **No probado en impresora térmica real.**
- Pendiente: logotipo impreso en el ticket (hoy solo texto), impuestos desglosados (el sistema no los maneja), ticket digital por mensaje.

## Automatización por giro (inventario: abarrotes, ferretería, perfumería, papelería…)
`GET /inventory/replenishment`: **Conviene comprar** (alcanza para N días al ritmo real de ventas de los últimos 30, nunca menos que el mínimo, con costo estimado) y **Casi no se vende** (con existencia y sin ventas en 60 días, con el dinero parado). En Compras aparecen dos tarjetas; «Agregar» pasa la sugerencia a la compra. Requiere permiso de editar inventario (muestra costos). A `reposicion.test.ts`.

## Aún sin hacer (por giro)
Barbería (rentabilidad por barbero/servicio, clientes que no regresan automáticos), restaurante (costo de platillo, desperdicio, compras), uñas (insumos por servicio), recordatorios automáticos de cita. Quedan para la siguiente entrega; no se marcan como hechos.

## Actualización (cierre): logotipo, comprobante digital e historial
- **Logotipo**: el que el dueño configura en Ajustes («Logo, dirección de la imagen») se imprime arriba del ticket (blanco y negro, ancho máximo 40 mm, apto para 58 mm) y aparece en el comprobante digital y en la página de reservas. Sigue siendo una **dirección (URL) de imagen**; subir el archivo directamente no se implementó (requeriría almacenamiento de archivos).
- **Comprobante digital**: botón «Enviar comprobante digital» tras cobrar; crea (una vez, se reutiliza) un enlace privado e inadivinable `/comprobante/{token}` (migración 47, `sales.receipt_token`), que se comparte con el menú de compartir del celular o WhatsApp. Muestra negocio, sucursal, folio, fecha, renglones, total, pago y cambio; quien atendió con nombre e inicial; **sin datos del cliente**; leyenda «Comprobante de venta. No es una factura (CFDI)». Un empleado no puede crearlo para la venta de otro.
- **Historial y reimpresión**: «Ventas del turno» (Caja) y «Tickets del día» (Ventas, para quien ve finanzas) tienen **Reimprimir** (marca REIMPRESIÓN, respeta 58/80 mm y logotipo).
- **Facturación CFDI**: NO existe integración; nada en el sistema dice que se emita factura. Impuestos desglosados: el sistema no los maneja, por lo que el ticket no los muestra.
- **Pruebas**: A `ticket-formatos.test.ts` (4); N `scripts/verificacion/ticket.ts` (logotipo en la impresión, comprobante público, escritorio y celular). **Impresión física: NO se pudo verificar** (no hay impresora térmica en este entorno); se verificó el contenido que se manda a imprimir y los anchos de columnas, no el resultado en papel (corte, densidad, codificación de acentos en impresoras ESC/POS).
