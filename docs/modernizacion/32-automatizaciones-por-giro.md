# 32 · Automatizaciones por giro (con datos reales)

Rama `diseno-v0`. **Regla de diseño:** solo se calcula y se aconseja con lo que el negocio ya registró; si falta algo, la pantalla lo dice («Para ver más claro, falta capturar…») y **no recomienda** sobre eso. Todo requiere permiso de finanzas (dueño o administrador autorizado), salvo seguimiento de clientes (permiso de clientes) y recordatorios (permiso de vender). A = prueba automatizada · N = navegador con datos de demostración.

| Giro | Qué hace | De dónde sale | Qué pasa si falta información |
|---|---|---|---|
| **Barbería y uñas** | Ganancia **por servicio** (cobrado − materiales/costo − comisión), con los materiales que gasta cada uno; ganancia **por persona** (también quien no gana comisión). Consejo si un servicio deja <30 % (con ≥3 hechos). | Ventas, `services.cost`, recetas de materiales, comisiones; nuevo `sale_items.staff_id` (quién atendió) | Servicio sin costo ni materiales: se avisa y no se aconseja sobre él. Ventas anteriores a esta versión: «sin responsable registrado». |
| **Seguimiento de clientes** (barbería, uñas) | «Dejaron de venir» (≥2 visitas y >45 días), «vinieron una vez y no regresaron» (14–90 días); mensaje de WhatsApp ya escrito; excluye a quien ya tiene cita próxima. | Ventas con cliente elegido al cobrar | Sin clientes registrados en ventas: explica que hay que elegir al cliente al cobrar. |
| **Recordatorios de citas** | Lista de citas de mañana con mensaje listo, botón «Recordarle» (abre WhatsApp) y marca «Avisado». | Agenda (`appointments.reminded_at`) | Cita sin teléfono: «sin teléfono». **No se envía nada solo**: no hay proveedor de mensajes contratado y sería un costo; requiere tu autorización. |
| **Restaurante, taquería, comedor, palapa** | Costo real y ganancia **por platillo** (receta × último costo), ventas y costo real; **consumo de ingredientes**; **desperdicio** (mermas) y su % de lo vendido; alertas: ingrediente que subió ≥10 % frente al mes anterior, ingrediente bajo mínimo, platillo con <30 % según receta. | Recetas, ventas, consumos y mermas de inventario, compras | Platillo sin receta o ingrediente sin costo: se lista qué capturar. Sin mermas: explica cómo registrarlas. |
| **Abarrotes, ferretería, perfumería, papelería, verdulería** | Margen real por producto, «lo que más ganancia deja», producto vendido **bajo su costo**, producto **por debajo de la ganancia que quiere el dueño**; en Compras: «Conviene comprar» y «Casi no se vende» (doc 30). | Ventas con costo, `last_cost`, margen del producto/categoría | Producto sin costo capturado: se lista. |

## Revisión de los demás productos oficiales
Baños y turístico (entradas/boletos), palapa y verdulería (precio del día) conservan su operación; la rentabilidad de platillos aplica a palapa y la de productos a verdulería. **No se inventó** un análisis específico para baños/turístico (no hay costos por entrada capturables hoy); papelería usa el margen de productos y su contador de copiadora ya existente. Queda como mejora futura decidida por ti.

## Pantallas
Finanzas → **«Qué deja ganancia»** (según el giro del negocio, también mixto); Clientes → «Seguimiento»; Agenda → «Recordatorios para mañana». Tablas que en celular se convierten en tarjetas con etiqueta por dato (`.cards-sm`).

## Pruebas
- A `automatizaciones.test.ts` (5): números exactos de ganancia por servicio y persona con comisión y materiales; servicio sin costo no recibe consejo; clientes que dejaron de venir tras 50 días simulados; platillo (costo 5.60, 77.6 %), consumo, merma y «sin receta»; producto bajo costo; recordatorio y marca de avisado. Suite completa 326/326.
- N `scripts/verificacion/giros-auto.ts`: barbería, uñas, restaurante y abarrotes × claro/oscuro × escritorio/celular: muestra su análisis y la auditoría de contraste/letra/desborde sale sin hallazgos.
- **No probado:** con datos reales de negocios activos; el envío real de mensajes (no existe).
