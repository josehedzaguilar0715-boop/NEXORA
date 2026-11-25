# 42 · Benchmark visual y funcional de los 14 productos y del Super Panel

**Estudio de solo lectura.** No se cambió código, base de datos, permisos, planes, precios ni producción (versión `34191efa`, esquema 48). Todo lo que sigue es **propuesta para tu aprobación**; no se ejecuta nada hasta que elijas qué desarrollar.
Método: inspección del repositorio (solo lectura) + documentación y páginas oficiales de las plataformas. No se repitió lo ya investigado (`24-investigacion-comparativa.md`, `34`, `35`); aquí se reutiliza y se amplía.
Aclaración de fuentes: casi todo lo externo viene de páginas **de los propios fabricantes** (marketing y ayuda). Prueba lo que **dicen ofrecer**, no su calidad real; no se probó ninguna app con cuenta propia.

---
## 1. Catálogo oficial de los 14 productos
**Fuente oficial:** `web/src/products/index.ts` (`PRODUCTS`, id, nombre, giro) y `GIROS` en `src/billing.ts` (13 giros). **Hay 14 productos = la plataforma base NEXORA + 13 productos de giro.** Los nombres son los del código, tal cual (el propio código los marca «provisionales hasta que el propietario los apruebe»).

| # | Producto (nombre exacto) | Id interno | Giro (clave) | Papel |
|---|---|---|---|---|
| 1 | **NEXORA** | `nexora` | — (ninguno) | **Plataforma base**: la usa cualquier negocio sin giro propio y las pantallas de acceso |
| 2 | **NEXORA Barber** | `barber` | barbería (`barberia`) | Servicios con agenda |
| 3 | **NEXORA Nails** | `nails` | estudio de uñas (`unas`) | Servicios con agenda |
| 4 | **NEXORA Tienda** | `market` | abarrotes (`abarrotes`) | Comercio con inventario y fiado |
| 5 | **NEXORA Ferretería** | `tools` | ferretería (`ferreteria`) | Comercio con cotizaciones |
| 6 | **NEXORA Papelería** | `paper` | papelería (`papeleria`) | Comercio con encargos y copias |
| 7 | **NEXORA Perfumería** | `scent` | perfumería (`perfumeria`) | Comercio con decants y asesoras |
| 8 | **NEXORA Acceso** | `access` | baños públicos (`banos`) | Entradas, pases y limpieza |
| 9 | **NEXORA Turismo** | `tour` | lugar turístico (`turistico`) | Taquilla, aforo y QR |
| 10 | **NEXORA Palapa** | `beach` | palapa (`palapa`) | Mesas, cocina y barra de playa |
| 11 | **NEXORA Restaurante** | `dining` | restaurante (`restaurante`) | Mesas, comandas y cocina |
| 12 | **NEXORA Comedor** | `fonda` | comedor (`comedor`) | Menú del día y cuentas de oficina |
| 13 | **NEXORA Taquería** | `taco` | taquería (`taqueria`) | Trompo, guisados y pedidos |
| 14 | **NEXORA Mercado** | `greens` | verdulería (`verduleria`) | Precio del día, merma y pedidos |

**Contradicciones entre documentos y código (no se modificó nada; se usa el código como oficial):**
1. `03-arquitectura-de-productos.md` describe **4 productos** (Barber, Nails, Tienda y «NEXORA base = los otros 10 giros»); el código ya tiene **14** (base + 13). Doc 03 está desactualizado en el conteo.
2. Doc 03 y 04 hablan de «identidad visual **completamente diferente** por producto»; la decisión vigente (aprobada después) es **identidad azul única**. El código aún conserva por producto un `themeColor` distinto (color de la barra del navegador en celular), que **contradice** la identidad única; es un detalle menor pendiente.
3. Los informes 33 y 38 decían «13 productos auditados»; son **13 giros + la base NEXORA = 14** (la base se auditó después con `SOLO=nexora`).
4. Nombres que difieren entre producto y giro: producto **Mercado** ↔ giro «Verdulería»; **Acceso** ↔ «Baños públicos»; **Nails** ↔ «Estudio de uñas» (en tus mensajes) / clave `unas`. No se unifican aquí.

---
## 2. Referencias externas estudiadas
Para cada plataforma: **(O)** lo que ofrece según su documentación/página oficial · **(I)** observación de interfaz según su material público (no se usó la app) · **(A)** adaptable · **(N)** no conviene.

| Plataforma | (O) Funciones oficiales relevantes | (I) Interfaz | (A) Adaptable a NEXORA | (N) No conviene |
|---|---|---|---|---|
| **Booksy** | Reservas en línea, perfil público del negocio, recordatorios, comisiones y propinas al cobrar, protección contra faltas con políticas/depósitos ([biz.booksy.com](https://biz.booksy.com/en-za), [reseñas](https://www.softwareadvice.com/appointment-scheduling/booksy-profile)) | Perfil con portada y fotos, servicios por categoría, reserva en pocos toques | Escaparate por negocio, servicios agrupados, política de cancelación, confirmación clara | Marketplace entre negocios (modelo de captación de la plataforma) |
| **Fresha** | Página de reservas gratuita (web, redes, Google, marketplace); calendario multi-personal y multi-sucursal con horarios, descansos y permisos por servicio; notas de cliente; inventario y órdenes de compra ([fresha.com](https://www.fresha.com/for-business/features), [agenda](https://www.fresha.com/for-business/features/scheduling), [marketplace](https://www.fresha.com/for-business/features/marketplace)) | Calendario por especialista, ficha de cliente con notas | Reserva desde Instagram/enlace, ficha de cliente con historial y notas, reservas recurrentes | Cobro de comisión por marketplace/pagos como modelo de negocio |
| **Shopify POS** | Productos y variantes ilimitados; inventario por ubicación; transferencias entre ubicaciones; roles de personal con permisos por rol y por ubicación; aprobación de gerente para descuentos ([features](https://www.shopify.com/ae/pos/features), [ubicaciones](https://help.shopify.com/en/manual/locations/shopify-pos), [roles](https://help.shopify.com/manual/sell-in-person/setup/staff-permissions)) | Cuadrícula de productos con imagen, deslizar variantes | **Variantes** (talla/presentación) con inventario propio; permisos por rol con nombre; ubicación por dispositivo | Roles por plan de pago (NEXORA ya da permisos por persona); tienda en línea completa |
| **Lightspeed Retail** | Punto de reorden y nivel deseado, reporte de reabastecimiento, recomendaciones por ventas diarias, órdenes de compra (doc 24; [soporte](https://retail-support.lightspeedhq.com/hc/articles/115000271633)) | Reportes de inventario por columnas | Ya adaptado (compra sugerida y sin movimiento); falta orden de compra al proveedor | Analítica avanzada en planes altos |
| **Toast** | Mesas con transferencia y división de cuenta, tiempos por curso, pantalla de cocina (KDS), pedidos en línea integrados, reportes en vivo ([toasttab.com](https://pos.toasttab.com/restaurant-pos), [KDS/cocina](https://pos.toasttab.com/solutions/back-of-house)) | Plano de mesas, comandas por estación | Dividir/transferir cuentas, tiempos de cocina, pedido en línea del restaurante | Hardware propietario y 200+ integraciones |
| **Loyverse** | POS gratuito con inventario, reportes y lealtad (doc 24) | Interfaz muy simple | Mantener sencillez de la caja | Complementos de pago por función |
| **Odoo** | Ecosistema modular: POS, **plano de pisos y mesas** (editar, transferir/unir), tickets de cocina por categoría, KDS bar/cocina; citas en línea (marketing); inventario y contabilidad como apps ([documentación restaurante](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/restaurant.html), [mesas](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/restaurant/floors_tables.html)) | Editor gráfico de plano de mesas | **Plano de mesas editable**, unir/transferir mesas; modularidad (activar solo lo que se usa, ya existe como «módulos») | Un ERP completo: más complejo que lo que un dueño pequeño usa |
| Otras (doc 24) | Square, QuickBooks, Vagaro, Booksy, Treinta, Profit First | — | Ver doc 24 | — |

---
## 3. Hallazgos comunes a los 14 productos (para no repetirlos en cada ficha)
**Hechos verificados en el código:** el menú tiene **16–21 entradas** según el giro (agrupadas en 5 portales: Vender, Inventario, Clientes, Dinero, Mi negocio). Pantallas comunes a todos: Inicio, Caja, Escanear QR, Productos, Compras, Clientes, Membresías y promos, Finanzas, Ventas, Configurar negocio, Mi asistencia, Personal, Soporte, Importar, Ajustes. Páginas públicas existentes: reservas (barbería, uñas, con el complemento), boletos (turístico/baños), tarjeta de sellos, estado de cita, comprobante digital. **No hay fotos** (solo `logo_url`), ni dirección/descripción del negocio, ni reseñas, ni pedido o catálogo en línea.
**Problemas de navegación comunes (observación):** 17–21 entradas es mucho para un dueño no técnico; «Escanear QR» y «Membresías y promos» aparecen aun donde casi no se usan; «Soporte», «Importar» y «Ajustes» son de uso ocasional pero ocupan el mismo nivel; «Ventas» y «Finanzas» están separadas pero se entienden bien ahora; la entrada de Inicio varía poco entre giros (solo agenda/tienda).
**Duplicidades:** Agenda↔Caja ya resuelta; «Precio del día» (palapa, taquería, verdulería) vs Productos: dos lugares para precios; recetas (Productos) vs Configurar.
**Qué falta en casi todos:** imágenes de producto/servicio, vista de cuadrícula con foto, orden de compra al proveedor, pedido/catálogo en línea (solo donde aplique), reportes por sucursal sin utilidad (hecho para encargados), ayuda contextual y primer uso guiado.

---
## 4. Fichas individuales

> Convención: **E-mejoras**: prioridad (Crítica/Alta/Media/Opcional) · beneficio · complejidad (B/M/A) · dependencias. «Público» = página pública para el cliente.

### 4.1 NEXORA (plataforma base)
**A. Diagnóstico.** Módulos: los 15 comunes. Lo usa un negocio sin giro propio y las pantallas de acceso/registro. Problemas: no ayuda a elegir giro ni configura nada por defecto; el menú completo sin especialización; `themeColor` propio. Faltan: **asistente de inicio** («¿qué vendes?» → activa el producto adecuado), plantillas por rubro.
**B. Benchmark.** Loyverse (simplicidad de arranque), Odoo (activar solo las apps necesarias), Square (alta guiada).
**C. Visual.** Es la referencia de la identidad azul; falta pantalla de bienvenida con pasos (crear productos, abrir caja, invitar equipo).
**D. Especializadas.** No aplica; es el punto de entrada.
**E. Mejoras.** Asistente de primer uso — **Alta** · menos abandono · M · ninguna migración si se guarda en ajustes existentes. Unificar `themeColor` azul — Media · coherencia · B.

### 4.2 NEXORA Barber (barbería)
**A.** Módulos propios: **Agenda**, Comisiones, reservas públicas, retoques (recordatorios), a domicilio, rifa/campañas de sellos. Ya hay: terminar→pendiente de cobro→Caja, ganancia por servicio/persona, seguimiento de clientes, recordatorios manuales. Problemas: menú de 17 entradas con Productos/Compras/Importar al mismo nivel que Agenda; Inicio ya prioriza agenda. Duplicado: ninguna grave. **Faltan:** foto de personal/servicios, página pública atractiva, recordatorio automático, política de cancelación/no asistió visible, ficha de cliente con notas y fotos del corte.
**B.** Booksy (perfil y reserva), Fresha (calendario por especialista, ficha de cliente), Vagaro (re-agendar, comisiones). Aprender: reserva en pocos toques, agenda por barbero, notas de cliente. No copiar: marketplace ni depósitos obligatorios.
**C.** Inicio con agenda del día (bien); falta línea de tiempo visual por barbero, tarjetas de servicio con foto, fichas de cliente con avatar; móvil: reservas pendientes primero.
**D.** Automatizar: recordatorio/confirmación (requiere proveedor), lista de espera, «cliente que no regresa» (hecho), cumpleaños/sellos. Indicadores: ocupación de agenda, no asistencias, ticket por barbero, retención. Controles: comisiones por servicio.
**E.** Página pública con portada/servicios por categoría — **Alta** · más reservas · M · fotos (decisión de imágenes). Notas y foto en ficha de cliente — **Alta** · fidelización · M · migración aditiva. Vista semanal/arrastrar para reprogramar — Media · A. Recordatorio automático — Media · menos faltas · M · proveedor de mensajes (costo). Lista de espera — Opcional.

### 4.3 NEXORA Nails (estudio de uñas)
**A.** Como Barber (agenda, comisiones, materiales por servicio con recetas, rentabilidad, reservas). Problemas/faltas: igual que Barber más **galería de diseños**, duración variable por técnica, paquetes/sellos con marca.
**B.** Fresha, Vagaro (clasificación de servicios, productos/insumos), Booksy.
**C.** Mismo patrón; la galería de trabajos es lo más visual de este giro.
**D.** Consumo de materiales por servicio (hecho), costo por servicio (hecho), recordatorio de retoque/relleno por servicio, anticipo opcional para citas largas.
**E.** Galería y página pública — **Alta** · M · fotos. Recordatorio de retoque automático — Media · M · proveedor. Anticipo — Opcional · A · pasarela.

### 4.4 NEXORA Tienda (abarrotes)
**A.** Módulos: Caja, Apartados, Productos (mayoreo, granel, presentaciones), Compras, Cierre del día, Clientes y fiado, reposición y sin movimiento. Es el producto más completo en inventario/fiado. Problemas: pantallas largas de Productos; no hay orden de compra formal a proveedor; no hay catálogo en línea. Duplicado: Cierre del día vs conteo en Productos.
**B.** Loyverse (simplicidad), Lightspeed (reorden y compras), Shopify POS (variantes, ubicación).
**C.** Caja ya reorganizada; falta cuadrícula con fotos de producto, escáner más visible, tarjetas de producto con existencia en color.
**D.** Fiado con recordatorio de cobro, caducidades, margen por producto (hecho), orden de compra al proveedor, lista de precios por proveedor.
**E.** Orden de compra al proveedor (PDF/WhatsApp) — **Alta** · M · ninguna. Fotos de producto — Media · M. Recordatorio de cobro de fiado — Media · B/M. Catálogo en línea — Opcional · A · decisión de modelo.

### 4.5 NEXORA Ferretería
**A.** Caja, **Cotizaciones**, **Devoluciones** con ticket, mayoreo/escalas, Compras. Faltan: **variantes** (medida/calibre), códigos de varios proveedores, conversión cotización→PDF/WhatsApp, apartado por obra, cuentas de crédito por empresa.
**B.** Shopify POS (variantes e inventario por ubicación), Lightspeed (proveedores, compras), Odoo (cotización→venta).
**C.** Cotizaciones tabla simple; propuesta: cotización con vista previa imprimible/compartible, buscador de producto muy rápido, existencia visible en caja.
**D.** Escalas por volumen (hecho), cotización vigente/vencida, producto por pieza/metro/kg, devolución a proveedor (existe). Indicadores: margen por categoría, rotación.
**E.** Variantes de producto — **Alta** · menos catálogo duplicado · A · migración. Cotización compartible (PDF/enlace) — **Alta** · M · ninguna. Crédito por cliente empresa — Media · M. Fotos — Opcional.

### 4.6 NEXORA Papelería
**A.** Caja con **contador de copiadora**, **Encargos** con anticipo, productos por hoja (`sheets_per_unit`), Compras. Faltan: **paquetes escolares** (lista de útiles → venta), temporada, plantillas de encargo (impresión, engargolado), seguimiento de encargos por estado visible.
**B.** Loyverse (POS simple), Shopify POS (kits/paquetes), Square (órdenes con anticipo).
**C.** Encargos ahora con pasos; falta tablero de estados (por hacer/listo/entregado).
**D.** Costo real de copia/impresión (insumos), avisos de entrega, listas de útiles, combos.
**E.** Tablero de encargos con aviso al cliente (WhatsApp manual) — **Alta** · M. Listas/paquetes escolares — Media · M. Costo por copia — Media · B (datos existen).

### 4.7 NEXORA Perfumería
**A.** Caja, Devoluciones, Comisiones (asesoras), **decants** y sets, productos por marca/fragancia/ml. Faltan: perfil de fragancia (notas), recomendador simple, muestras/testers con costo (existe uso interno), lealtad por compra, catálogo con foto (el giro más visual).
**B.** Shopify POS (variantes de tamaño, imágenes), Fresha (productos y cliente), Lightspeed (inventario por frasco abierto).
**C.** Cuadrícula con foto grande y marca; ficha de producto con notas olfativas.
**D.** Costo por mililitro de decant (existe), alerta de frasco bajo, comisión por asesora (existe), cumpleaños/recompra.
**E.** Fotos y catálogo visual — **Alta** · M · imágenes. Ficha con notas/etiquetas — Media · M. Recompra/cumpleaños — Media · B/M.

### 4.8 NEXORA Acceso (baños públicos)
**A.** **Entradas** (cobro por tipo/tiempo, pases), escaneo de pase, **limpieza por turno**, accesos por hora, productos de venta. Problemas: el menú trae Clientes, Membresías, Compras que casi no usa. Faltan: tablero de **afluencia por hora**, **bitácora de limpieza** visible para auditoría, reporte por turno/persona, tarifas por tipo de usuario.
**B.** Square (venta rápida), Loyverse (turnos y reportes), referencias de control de acceso (no hay estándar claro; se omite).
**C.** Pantalla Entradas con botones grandes (bien); falta resumen del turno y alertas de limpieza pendiente.
**D.** Aforo, pases con vigencia, limpieza programada, consumo de insumos (jabón, papel).
**E.** Resumen del turno + alerta de limpieza — **Alta** · M. Afluencia por hora — Media · B. Simplificar menú — Media · B.

### 4.9 NEXORA Turismo (lugar turístico)
**A.** **Taquilla** por horario y aforo, **Acceso con QR**, tienda de boletos en línea (pública), mis boletos, productos. Base sólida y única con venta pública. Faltan: pago en línea (hoy se cobra en taquilla), calendario de disponibilidad visual, grupos/escolares, reportes por tipo de boleto.
**B.** Fresha/Booksy (calendario y confirmación), Toast (pedido en línea integrado), Odoo (citas/reservas).
**C.** Tienda pública funcional; falta portada con fotos del lugar, calendario con disponibilidad, página de confirmación con QR descargable.
**D.** Aforo, QR (hecho), horarios; indicadores: ocupación por horario, ventas por tipo.
**E.** Portada + calendario visual en la tienda de boletos — **Alta** · más ventas · M · fotos. Pago en línea — Media · A · pasarela (costo). Reporte por tipo de boleto — Media · B.

### 4.10 NEXORA Palapa
**A.** **Mesas** (con cuentas), Cocina, **rentas** de camastros/sillas (también fuera), Precio del día, Comisiones/propinas. Faltan: plano visual de mesas/sombras, mapa de camastros, reservas con anticipo, tiempos de renta, menú digital por QR.
**B.** Toast (mesas, división), Odoo (plano editable), Fresha (reservas).
**C.** Mesas ya con filtros; propuesta: **plano gráfico** editable (Odoo) y estado por color + texto.
**D.** Mesa↔comanda↔cocina (hecho), renta por hora con alerta de vencimiento, división de cuenta por persona (existe).
**E.** Plano de mesas editable — **Alta** · M/A. Alerta de renta por vencer — Media · B. Menú QR — Media · M.

### 4.11 NEXORA Restaurante
**A.** Mesas, Pedidos (llevar/recoger), Cocina por estación, Menú del día, recetas, costo por platillo, desperdicio, comisiones/propinas. Es el producto con más módulos de operación (20 entradas). Problemas: menú largo; Menú del día vs Productos; faltan **dividir/transferir cuentas** (parcial), **tiempos por curso**, pedido en línea, menú QR.
**B.** Toast, Odoo (plano, KDS), Lightspeed (compras/proveedores).
**C.** Cocina con urgencia por tiempo (hecho); propuesta: plano de mesas, tablero de pedidos en 3 columnas, KDS a pantalla completa.
**D.** Recetas y costo real (hecho), desperdicio (hecho), consumo de ingredientes (hecho), alertas de costo (hecho); faltan merma por turno y pedido de compra automático.
**E.** Plano de mesas + transferir/unir — **Alta** · M/A. KDS a pantalla completa — Media · B/M. Pedido en línea propio — Opcional · A · costo operativo/pagos. Menú QR — Media · M.

### 4.12 NEXORA Comedor
**A.** Menú del día, venta rápida, cuentas de oficina (fiado), Pedidos, Mesas y Cocina. Faltan: **publicar el menú a clientes** (hoy se arma, no se difunde), pedidos anticipados de oficinas, cobro semanal a cuentas de empresa, porciones/rendimiento por receta.
**B.** Loyverse (rapidez), Toast (pedido anticipado), Odoo (kits y recetas).
**C.** Menú del día con tarjetas; propuesta: botón «compartir menú» (imagen/WhatsApp) y vista de pedidos del día por oficina.
**D.** Menú diario, rendimiento de ollas, cuentas por cobrar a oficinas (existe fiado), pedidos recurrentes.
**E.** Compartir menú del día (imagen/enlace) — **Alta** · alcance a clientes · B/M. Pedidos recurrentes de oficina — Media · M. Estado de cuenta por empresa — Media · M.

### 4.13 NEXORA Taquería
**A.** **Trompo/Carne** (kilos puestos vs vendidos), Mesas, Pedidos, Cocina, Precio del día. Faltan: rendimiento por kilo de carne (tacos por kilo), comanda por estación (trompo/plancha/bebidas), corte rápido para turnos largos.
**B.** Toast (KDS por estación), Loyverse (venta rápida), Odoo (tickets por categoría).
**C.** Pantalla Carne con formulario simple; propuesta: tablero «Hoy» (puesto/vendido/sobrante) con indicador de merma.
**D.** Rendimiento por kilo, merma de carne, producción por hora, ticket por mesa.
**E.** Rendimiento y merma de carne con alerta — **Alta** · control del insumo clave · B/M (datos existen). KDS por estación — Media · B. Menú QR — Opcional.

### 4.14 NEXORA Mercado (verdulería)
**A.** **Precio del día** (cambio masivo), venta por peso/granel, Pedidos, **Cierre del día** (merma y conteo), Compras. Faltan: lista de precios compartible con clientes frecuentes, pedidos recurrentes de restaurantes, historial de precios del proveedor, alerta de producto perecedero.
**B.** Loyverse (POS simple con báscula), Lightspeed (compras y merma), Shopify POS (unidades de medida).
**C.** Precio del día con tabla ayer/hoy (bien); móvil ya en tarjetas; propuesta: indicadores de frescura y merma en Inicio.
**D.** Precio diario, merma, pedidos a restaurantes, caducidad corta.
**E.** Lista de precios del día compartible — **Alta** · B/M. Pedidos recurrentes — Media · M. Alerta de merma/caducidad — Media · B.

---
## 5. Comparación de funciones (resumen NEXORA vs referencias)
| Capacidad | NEXORA hoy | Booksy/Fresha | Shopify/Lightspeed | Toast/Odoo |
|---|---|---|---|---|
| Agenda por persona | ✔ (barbería/uñas) | ✔ | — | — |
| Reserva pública | ✔ básica (sin fotos) | ✔ con perfil/fotos/marketplace | — | Odoo citas (marketing) |
| Fotos de producto/servicio | ✘ | ✔ | ✔ | ✔ |
| Variantes de producto | ✘ (presentaciones sí) | — | ✔ | — |
| Inventario multisucursal | ✔ (por sucursal) | ✔ (Fresha) | ✔ | — |
| Orden de compra a proveedor | Parcial (pedido sugerido) | Fresha ✔ | ✔ | — |
| Plano de mesas editable | ✘ (lista por zonas) | — | — | ✔ |
| KDS/cocina | ✔ comandas por estación | — | — | ✔ |
| Dividir/transferir cuentas | Parcial | — | — | ✔ |
| Pedido en línea | ✘ | Fresha tienda | Shopify | Toast |
| Permisos por rol/persona | ✔ por persona + puestos + Administrador | Básico | ✔ por rol/ubicación | ✔ |
| Reportes por giro con datos reales | ✔ (doc 32) | Parcial | ✔ | ✔ |
| Finanzas explicadas (reparto/retiros/saldos) | ✔ (diferenciador) | — | — | — |

---
## 6. Propuestas visuales (sin reabrir la identidad azul)
1. **Escaparate público por negocio**: portada, categorías, tarjetas con foto, buscador interno, reserva en 2 columnas (doc 42-referencia anterior: `42-referencia-visual-booksy-diagnostico.md`).
2. **Tarjetas con imagen** en catálogos (con imágenes ilustrativas por giro mientras no haya fotos).
3. **Inicio por rol y giro**: dueño (qué requiere atención), encargado (mi sucursal), empleado (mi día), con encabezado del negocio.
4. **Plano visual** para giros de mesas/palapa/aforo.
5. **Menú reducido a lo esencial** (5–8 entradas visibles; lo ocasional en «Más») y primer uso guiado.
6. Unificar `themeColor` azul y revisar jerarquía tipográfica; mantener ≥18 px en celular y las auditorías.

## 7. Propuestas funcionales (resumen transversal)
Fotos y galería (decisión de almacenamiento) · variantes · orden de compra · plano de mesas · compartir menú/lista de precios/cotización · tablero de encargos · asistente de primer uso · recordatorios automáticos (proveedor) · pedido en línea solo donde aplique.
**Qué productos necesitan página pública / catálogo / pedidos (sin marketplace):**
| Necesidad | Productos |
|---|---|
| **Página pública con reservas** | Barber, Nails (y, a futuro, restaurante/palapa para reservar mesa) |
| **Venta pública de boletos** | Turismo (ya existe), Acceso (opcional) |
| **Menú/lista compartible** (imagen o enlace, sin pedido) | Comedor, Restaurante, Taquería, Mercado (precio del día) |
| **Catálogo con foto** (consulta, sin carrito) | Perfumería, Ferretería, Papelería, Tienda |
| **Pedido en línea** | Solo opcional y a futuro: Restaurante, Taquería, Comedor, Mercado (aumenta costo operativo) |
| **Nada público** | Base NEXORA |

---
## 8. Super Panel (administración central)
**Estado real (código):** 37 rutas `/admin/*`: Resumen (ingreso mensual, negocios por estado, uso, vencimientos), Negocios (ficha, plan, sucursales extra, giros, pagos, suspender/reactivar, cuenta gratis, módulos de pago, restablecer acceso, cambio de teléfono, reiniciar demo), Buzón de soporte, Alta asistida, Demos de 13 giros, Ajustes (valores por defecto, salud del sistema, espacio, respaldos y restauración, interruptores). Rediseñado al estilo v0 (36 pantallas auditadas).
| Área | Diagnóstico | Propuesta |
|---|---|---|
| Negocios y sucursales | Buena ficha; sin vista de «salud del negocio» (uso reciente, ventas, errores) | Columna de actividad (última venta, usuarios activos), filtros guardados — Alta · B |
| Usuarios y permisos | Restablecer accesos; sin vista de puestos por negocio | Vista de equipo por negocio (solo lectura) — Media · B |
| Suscripciones | Planes por límites (3/5/10 usuarios), extras de sucursal/usuarios/reservas, gratis, pruebas | **No cambiar** planes ni precios; mejor **línea de tiempo de pagos y vencimientos** y recordatorio interno de cobro — Media · B |
| Pruebas y mensualidades | Pruebas y vencimientos en Resumen | Calendario de renovaciones — Media · B |
| Estado por producto | Demos por giro; no hay vista «por producto» | Tarjetas por producto (negocios, uso, errores) — Media · M |
| Salud y actividad | Panel de salud (migraciones, respaldos, errores, ventas incoherentes) | Alerta visual en Inicio del panel; histórico de salud — Alta · B |
| Reportes generales | Resumen mensual | Reporte de adopción por giro y función (cuántos usan Finanzas, Agenda…) — Media · M |
| Seguridad | Acceso propio con 2º paso opcional, auditoría, respaldos | **Instalar `BACKUP_KEY`** (pendiente), 2º paso obligatorio, bitácora de acciones del soporte visible — **Crítica/Alta** · B |
| Experiencia | Navegación por módulos v0 | Buscador global del panel, accesos directos a «negocios por vencer» — Media · B |

---
## 9. Matriz de prioridades
| Prioridad | Mejora | Productos | Beneficio | Complejidad | Dependencia |
|---|---|---|---|---|---|
| **Crítica** | Cifrado de respaldos (`BACKUP_KEY`) y verificación | Super Panel | Protección de datos | B | Acción del dueño |
| **Crítica** | Validación con sesiones reales tras el lanzamiento | Todos | Estabilidad | B | Credenciales del dueño |
| **Alta** | Escaparate público: portada, categorías, tarjetas, buscador interno | Barber, Nails, Turismo | Captación | M | Decisión de imágenes |
| **Alta** | Ficha de cliente con notas/foto | Barber, Nails | Fidelización | M | Migración aditiva |
| **Alta** | Orden de compra al proveedor | Tienda, Ferretería, Papelería, Mercado | Control de compras | M | — |
| **Alta** | Plano de mesas + unir/transferir cuentas | Restaurante, Palapa, Comedor, Taquería | Operación | M/A | — |
| **Alta** | Compartir menú / lista de precios / cotización | Comedor, Mercado, Ferretería | Alcance | B/M | — |
| **Alta** | Variantes de producto | Ferretería, Perfumería, Tienda | Catálogo limpio | A | Migración |
| **Alta** | Asistente de primer uso + menú reducido | Todos | Facilidad | M | — |
| Media | Tarjetas con imagen en catálogos | Todos | Atractivo | M | Imágenes |
| Media | Rendimiento/merma de carne; alerta de merma | Taquería, Mercado | Control | B/M | — |
| Media | Tablero de encargos | Papelería | Seguimiento | M | — |
| Media | Resumen del turno y alerta de limpieza | Acceso | Control | M | — |
| Media | Panel: actividad por negocio y adopción | Super Panel | Gestión | B/M | — |
| Opcional | Pedido en línea, pago en línea, reseñas, recordatorios automáticos, fotos con almacenamiento | Varios | Crecimiento | A | Servicios de pago |

## 10. Plan de evolución por etapas
| Etapa | Contenido | Costo | Riesgo |
|---|---|---|---|
| **1 · Visual y usabilidad** | Menú reducido, asistente de primer uso, unificar `themeColor`, tarjetas con imágenes ilustrativas por giro, guía visual de la referencia | $0 | Bajo (solo pantallas) |
| **2 · Funcional especializada** | Plano de mesas y cuentas, orden de compra, variantes, cotización/menú/lista compartibles, tablero de encargos, rendimiento de carne, resumen de turno | $0 | Medio (algunas migraciones aditivas con ensayo) |
| **3 · Automatizaciones** | Fiado y recordatorios internos, alertas de merma/limpieza/renta, reposición a orden de compra, adopción en el panel | $0 | Medio |
| **4 · Público y captación** | Escaparate por negocio, reserva guiada, «Mi escaparate», catálogos con foto | $0 con URLs/ilustraciones; con carga de archivos puede haber costo | Medio |
| **5 · Avanzado** | Pedido y pago en línea, reseñas, recordatorios automáticos, fotos reales, integraciones | **Costos de terceros** (mensajes, pasarela, almacenamiento) | Alto |
Cada etapa: rama propia, auditorías y pruebas existentes, **ensayo de migración con copia** (método del lanzamiento) y publicación **solo con tu autorización**.

## 11. Riesgos, dependencias y costos potenciales
- **Riesgo operativo:** tocar producción recién publicada → mitigar con ramas, ensayo y publicación por etapas pequeñas.
- **Datos:** variantes, fotos, escaparate y orden de compra requieren migraciones aditivas (ya hay método probado).
- **Imágenes:** sin carga de archivos solo se pueden usar URLs o ilustraciones; la carga real puede requerir almacenamiento de pago.
- **Costos externos (no contratar sin autorización):** mensajes (doc 35), pasarela de pagos, almacenamiento de archivos, mapas. Todo el resto de las etapas 1–3 cuesta $0.
- **Alcance:** convertir todo en marketplace aumentaría costos y complejidad; no se recomienda.
- **Dependencias de decisión tuya:** nombres comerciales definitivos de los productos, imágenes, qué giros tendrán público, y el orden de las etapas.

## 12. Conclusión y recomendaciones
NEXORA ya tiene una **base operativa sólida** (caja, inventario, finanzas explicadas, permisos, agenda conectada con caja, automatizaciones por giro) y una **identidad unificada**. Lo que separa a NEXORA de las referencias es sobre todo **presentación y captación** (fotos, escaparate, plano visual de mesas, compartir menús/listas) y algunas **funciones de catálogo** (variantes, orden de compra), no la operación.
**Recomendación:** empezar por la **Etapa 1** (bajo riesgo, costo cero) y, en paralelo, cerrar lo crítico de producción (cifrado de respaldos y validación con sesiones reales). Después, la Etapa 2 priorizando **plano de mesas** (restaurante/palapa/comedor/taquería), **orden de compra** (comercios) y **escaparate** (barbería/uñas). Dejar pedido y pago en línea para el final.

### Resumen ejecutivo
- **Productos con mejor base:** **Barber** y **Nails** (agenda, comisiones, rentabilidad, seguimiento, reservas públicas), **Tienda** (inventario, fiado, apartados, reposición), **Restaurante** (mesas, cocina, recetas, costo y desperdicio) y **Turismo** (única con venta pública de boletos y QR).
- **Productos que más necesitan mejoras:** **Acceso** (poca especialización y menú recargado), **NEXORA base** (sin asistente de inicio), **Perfumería** y **Papelería** (muy visuales o de proceso, sin fotos ni tablero), **Mercado** y **Comedor** (no difunden precios/menú), y las **mesas** de Palapa/Restaurante/Taquería (sin plano gráfico).
- **Lo más rentable de mejorar primero:** menú reducido + primer uso (todos), escaparate público de servicios (Barber/Nails), plano de mesas y compartir menú/lista de precios.
- **Super Panel:** buena base (v0, salud, respaldos); pendientes críticos de seguridad (`BACKUP_KEY`) y mejoras de actividad/adopción.

### Fuentes consultadas (hoy)
Booksy: [biz.booksy.com](https://biz.booksy.com/en-za), [Software Advice](https://www.softwareadvice.com/appointment-scheduling/booksy-profile) · Fresha: [funciones](https://www.fresha.com/for-business/features), [agenda](https://www.fresha.com/for-business/features/scheduling), [marketplace](https://www.fresha.com/for-business/features/marketplace) · Shopify POS: [funciones](https://www.shopify.com/ae/pos/features), [ubicaciones](https://help.shopify.com/en/manual/locations/shopify-pos), [roles de personal](https://help.shopify.com/manual/sell-in-person/setup/staff-permissions) · Odoo: [restaurante](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/restaurant.html), [plano y mesas](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale/restaurant/floors_tables.html) · Toast: [restaurante](https://pos.toasttab.com/restaurant-pos), [cocina](https://pos.toasttab.com/solutions/back-of-house) · Lightspeed y Loyverse: ver `24-investigacion-comparativa.md`. **Limitación:** son páginas comerciales; los límites por plan y precios no se verificaron.
