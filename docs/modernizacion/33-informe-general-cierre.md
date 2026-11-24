# 33 · Informe general de cierre (rama `diseno-v0`)

Nada se publicó ni se fusionó con producción; no se tocaron datos de negocios activos ni suscripciones. Producción sigue en 72bda7f0. Todo es reversible con `git revert` (un commit por módulo).
**Tipos de prueba:** A = automatizada (vitest, base en memoria) · N = navegador real (Playwright) con datos de demostración en memoria · S = simulación de migración sobre una base con datos. **No hubo pruebas con negocios reales ni con impresora física.**

## 1. Funciones implementadas (desde el último cierre)
- **Permisos y roles:** Administrador autorizado (nace sin funciones; el dueño marca cada una); acceso financiero decidido en servidor (dueño y administrador autorizado; encargado y empleado nunca — opción B); **costos y márgenes como permiso independiente `view_costs`** por persona; campos sensibles se quitan de las respuestas, no solo de la pantalla. (docs 27, 28, 29, 31)
- **Finanzas inteligentes:** Mi dinero (vendiste, entró, salió, ganancia real, disponible, por reservar, puedes retirar, con «¿cómo se calcula?»), reparto configurable con varias configuraciones y vista previa, «Plan anterior» histórico, retiros registrados, reportes contables como secundarios. (doc 28)
- **Agenda y Caja:** Agenda sin botón «Cobrar»; Terminar → «Pendiente de cobro» → «Ver en Caja»; cobro solo en Caja; sin cobros duplicados; Finanzas y reportes se actualizan solos. Página pública con logotipo, horario y servicios, sin nombre personal del dueño. Planes reales documentados (no existen Agenda Libre/Pro). (docs 26, 30, 31)
- **Tickets:** 58 y 80 mm, sucursal, folio consecutivo, reimpresión, logotipo, comprobante digital con enlace privado, leyenda «no es una factura (CFDI)». (doc 30)
- **Automatizaciones por giro** con datos reales: barbería/uñas (rentabilidad por servicio y persona, seguimiento de clientes, recordatorios), restaurante (costo por platillo, consumo, desperdicio, alertas), tiendas (margen real, producto bajo costo, qué comprar, producto sin movimiento). Sin datos capturados, la pantalla dice qué falta y no recomienda. (docs 30, 32)
- **Pantallas operativas (parcial):** formulario de producto por secciones con opciones avanzadas plegadas; tablas de Productos y de las nuevas pantallas como tarjetas en celular.

## 2. Cambios visuales
Identidad azul única v0 (sin temas por giro; los 14 productos conservan logotipo y nombre); claro por defecto y oscuro opcional; Finanzas rediseñada (tarjetas de cifras, reparto editable); «Qué deja ganancia», «Seguimiento», «Recordatorios» y comprobante digital nuevos; tablas → tarjetas en celular (`.cards-sm`); formularios por secciones.

## 3. Pruebas aprobadas (última ejecución completa)
- **A:** 63 archivos, **327 pruebas, 0 fallas**; compilación de servidor y de interfaz sin errores.
- **N:** e2e de punta a punta OK (incluye Terminar → Ver en Caja → cobro → «Atendida»); navegación, puestos, dashboards, tema, teclado, páginas públicas (18), guía visual (84 combinaciones), panel administrativo (36), mi-dinero (permisos de los 4 puestos, flujos de Finanzas, auditoría de 9 pestañas), giros-auto (4 giros × claro/oscuro × 2 tamaños), ticket (logo, 58/80 mm, comprobante), agenda-caja: **todas en orden**.
- **Auditoría de pantallas** (contraste AA, letra ≥18 px en celular, desbordes, textos encimados/cortados, controles sin nombre): **13 productos × todas sus pantallas**: escritorio+celular claro y oscuro 414/414 y tableta claro y oscuro 207/207, **0 hallazgos finales**.
- **S:** migraciones 43–47 aditivas sobre una base con datos (usuarios y configuraciones intactos; «Plan anterior» sembrado).

## 4. Pruebas fallidas y errores corregidos en este cierre
- Auditoría halló encimado del precio de mayoreo con la existencia en la tarjeta de Productos (celular) → corregido y re-auditado (0).
- Auditoría halló etiqueta «Restaurante» cortada en Alta asistida del panel → corregido y re-auditado (0).
- El folio del ticket se cortaba en 58 mm (lo detectó una prueba) → corregido.
- Pruebas antiguas que fijaban comportamientos que cambiaron por tus decisiones (empleado con «ver reportes», encargado con finanzas, paleta por producto, versión de esquema, campos de la página pública) → actualizadas, no borradas.

## 5. Lo que NO se pudo probar
Impresión en impresora térmica real (cortes, densidad, acentos ESC/POS); uso con datos reales de negocios; envío real de recordatorios (no existe proveedor contratado); CFDI (no hay integración); rendimiento con mucho volumen; navegadores distintos a Chromium; lectores de pantalla.

## 6. Riesgos y limitaciones
- Encargados y empleados que veían costos **dejan de verlos hasta que el dueño marque «Ver costos y márgenes»**; el encargado ya no ve Ventas (trae utilidad): no hay un resumen de ventas sin utilidades para supervisar.
- «Dinero disponible» solo conoce lo capturado en NEXORA (no el saldo real del banco). Un «saldo inicial» sería decisión tuya.
- Recordatorios y seguimiento abren WhatsApp con el mensaje escrito: no se envía nada solo.
- El cobro directo de citas ya no existe fuera de Caja: un negocio donde quien atiende no tiene permiso de vender no podrá cobrar sus citas.
- El logotipo es una dirección (URL) de imagen; no hay carga de archivos.
- Análisis específico para baños/turístico: no se inventó (no hay costos capturables hoy).
- Migraciones 43–47 son aditivas pero **se aplicarán a producción al publicar**; antes conviene el ensayo con respaldo (ya existen los scripts).

## 7. Commits (rama `diseno-v0`, de más reciente a más antiguo, desde el cierre de la etapa visual)
Ver `git log e1bec56..HEAD`: permisos y finanzas (12a6834, bb42f61, f7422ac), opción B (d092cbc), tickets (84daf2c, 6a8229b), Agenda→Caja (4e5bd1c, 8481985), costos (6aa014d), automatizaciones (b311770, 2f51b51), documentos 24–33 y correcciones del cierre.

## 8. Lista de tareas
**Realmente terminadas (con prueba):** permisos y roles; Finanzas inteligentes; Agenda/Caja; tickets (excepto impresión física); costos como permiso; automatizaciones por giro; fases 6–8 (identidad única en los 14, claro/oscuro, 3 tamaños, accesibilidad por auditoría, auditoría final); documentación.
**Parciales / pendientes:**
- **Fase 4 (pantallas operativas) está PARCIAL:** hecho Finanzas completa, formulario y tabla de Productos, tablas nuevas. **No rediseñado a fondo:** la cuadrícula de Caja, Clientes (lista y ficha), Compras/Inventario (formularios), y pantallas particulares de giro (Mesas, Cocina, Agenda interna, Apartados, Taquilla…) heredan el estilo general pero conservan su organización anterior.
- Impresión física de tickets sin verificar; recordatorios automáticos (decisión y costo tuyos); resumen de ventas sin utilidad para encargados; saldo inicial bancario; carga de logotipo como archivo.
- **Decisiones tuyas pendientes:** ¿nombre comercial «Agenda Pro» para el extra de reservas?; ¿resumen de ventas sin utilidades para encargados?; ¿saldo inicial?; ¿proveedor de mensajes para recordatorios automáticos?; ¿publicar? (solo con tu autorización expresa).
