# 43 · Plan maestro de evolución de NEXORA (borrador para aprobación)

Basado en el benchmark (doc 42) y en tus decisiones 1–5. **No se desarrolla nada hasta que lo apruebes.** Sin cambios de código, migraciones, producción, permisos, roles, planes ni precios. Sin pago en línea ni mensajería automática. Sin servicios de pago.

## 1. Orden definitivo de etapas
| Orden | Etapa | Contenido | Quién / condición |
|---|---|---|---|
| **0 (en paralelo, siempre)** | Estabilizar producción | Validación de producción, `BACKUP_KEY`, respaldo manual y comparación programada, negocios reales autorizados | Requiere credenciales/acciones del dueño |
| **1** | Visual y facilidad de uso | Menús simplificados, primeros pasos guiados por giro, navegación, identidad azul única (incl. quitar `themeColor` por producto) | Pide tu autorización de desarrollo |
| **2** | Escaparates públicos Barber y Nails | Perfil, servicios, precios, imágenes por URL/ilustración, profesionales, reserva | Después de la etapa 1 |
| **3** | Planos gráficos de mesas | Solo productos que usan mesas (ver §2) | Después de 2 |
| **4** | Menús y listas compartibles | Mercado, Comedor, Restaurante, Taquería, Palapa; catálogos donde aporte | Después de 3 |
| **5** | Mejoras específicas | Perfumería, Papelería, Acceso | Después de 4 |
| **Continua** | Turismo | Conservar y mejorar venta pública de boletos y QR (portada, calendario/disponibilidad visual) | Se intercala con 2 por compartir el componente de escaparate |
| **Más adelante (no aprobado)** | Fotos reales, pedido/pago en línea, mensajes automáticos | Solo tras calcular costos y con tu autorización | — |

Cada etapa: rama propia, pruebas y auditorías existentes, ensayo con copia de datos si hay migración aditiva (solo con tu aprobación explícita), y publicación solo con tu autorización.

## 2. Mejoras por producto
| Producto | Etapa 1 | Funcional posterior |
|---|---|---|
| NEXORA (base) | Asistente «¿qué vendes?», primeros pasos, menú esencial | — |
| Barber | Menú reducido, primeros pasos (servicios→equipo→primera cita) | Escaparate público; notas en ficha de cliente (requiere decisión de datos) |
| Nails | Igual que Barber | Escaparate con galería por URL; recordatorios solo manuales |
| Tienda | Menú reducido, primeros pasos (productos→caja→fiado) | Lista de precios compartible (opcional); orden de compra (pendiente de aprobación aparte) |
| Ferretería | Menú reducido | Cotización compartible (enlace/PDF) |
| Papelería | Menú reducido, primeros pasos | **Tablero de encargos**, paquetes escolares |
| Perfumería | Menú reducido | Catálogo con imágenes por URL, ficha con notas olfativas, recompra |
| Acceso | **Menú muy reducido** (quitar lo que no usa a la vista) | Resumen del turno, alerta de limpieza, afluencia por hora |
| Turismo | Primeros pasos | Mejorar tienda pública: portada, calendario con disponibilidad, QR descargable |
| Palapa | Menú reducido | **Plano de mesas**, menú digital compartible, alerta de renta por vencer |
| Restaurante | Menú reducido (20 entradas hoy) | **Plano de mesas**, unir/transferir cuentas, menú digital |
| Comedor | Menú reducido | Menú del día compartible, estado de cuenta por oficina |
| Taquería | Menú reducido | Plano de mesas (si usa mesas), menú digital, control de merma de carne |
| Mercado | Menú reducido | **Lista de precios del día compartible**, alerta de merma |

**Antes de implementar cada mejora** se hará una revisión puntual de lo que ya existe en ese producto (el doc 42 lo resume; se verificará de nuevo en código al empezar cada etapa).
**Mesas:** Restaurante y Palapa seguro; Comedor y Taquería solo si el negocio las activa (hoy los cuatro tienen la pantalla «Mesas»). Propuesta: plano visible solo si el negocio usa mesas; si no, no aparece.

## 3. Mapa de páginas públicas
| Producto | Página pública | Estado hoy | Tipo |
|---|---|---|---|
| Barber, Nails | Perfil: servicios, precios, imágenes, profesionales, reservar | Solo `/reservar/:slug` básica y requiere el complemento «reservas» | Escaparate + reserva |
| Turismo | Catálogo de experiencias, horarios, disponibilidad, boletos con QR | Venta de boletos y `/mis-boletos` existen | Tienda de boletos (mejorar) |
| Restaurante, Taquería, Comedor, Palapa | Menú digital + datos del negocio (horario, ubicación, contacto) | No existe | Solo consulta/compartir, **sin pedido** |
| Mercado | Lista de precios del día | No existe | Compartible |
| Perfumería, Ferretería, Papelería, Tienda | Catálogo/lista compartible (solo si aporta) | No existe | Consulta, sin carrito |
| Acceso | Ninguna (opcional: tarifas) | — | — |
| NEXORA base | Ninguna | — | — |
Ya existentes sin cambio: `/cita/:token`, `/mis-boletos/:token`, `/tarjeta/:code`, `/comprobante/:token`. **Faltan campos** para datos del negocio (descripción, dirección, horario, redes) y para imagen de servicio/producto: son cambios de datos (migración) que requerirán tu aprobación al llegar a esa etapa. Ningún producto será marketplace.

## 4. Estrategia de imágenes
1. **Ilustraciones profesionales por giro**: conjunto propio del proyecto (SVG), sin costo ni almacenamiento.
2. **Imágenes de ejemplo** cuando el negocio no tenga fotos (marcadas como ilustrativas).
3. **URLs de imágenes** que el negocio pegue (cuidado: se mostrará solo `https`, tamaño no controlado, enlace que puede romperse; se mostrará la ilustración si falla).
4. **Carga real de fotos**: etapa posterior; antes se calculará costo de almacenamiento y de respaldos. No se contrata nada ahora.
Riesgos: contenido ajeno/derechos de imagen (responsabilidad del negocio), privacidad (no usar fotos de clientes), y que las URLs externas expongan la visita del cliente al sitio de origen.

## 5. Tabla de nombres (sin cambios; solo recomendación)
Fuentes: `web/src/products/index.ts` (código), `web/src/giros.ts` (nombre del giro), documentos 03/04/42. Ningún nombre se modifica.

| # | Nombre actual (código) | Giro comercial | Nombre del giro en código | Nombre en documentación | Posibles contradicciones | Recomendación (a tu decisión) |
|---|---|---|---|---|---|---|
| 1 | NEXORA | — (base) | — | «NEXORA base» (doc 03: «los otros 10 giros») | Doc 03 define la base de otro modo | Conservar «NEXORA» |
| 2 | NEXORA Barber | Barbería | Barbería | NEXORA Barber | «Barber» en inglés vs giro en español | Conservar |
| 3 | NEXORA Nails | Estudio de uñas | Estudio de uñas (`unas`) | NEXORA Nails | Inglés vs giro español | Conservar |
| 4 | NEXORA Tienda | Abarrotes | Abarrotes | NEXORA Tienda | Nombre de producto ≠ giro (id interno `market`) | Conservar; opcional «Tienda de abarrotes» en descripciones |
| 5 | NEXORA Ferretería | Ferretería | Ferretería | Doc 42 | Ninguna | Conservar |
| 6 | NEXORA Papelería | Papelería | Papelería | Doc 42 | Ninguna | Conservar |
| 7 | NEXORA Perfumería | Perfumería | Perfumería | Doc 42 | Ninguna | Conservar |
| 8 | NEXORA Acceso | Baños públicos | Baños públicos (`banos`) | Doc 42 | «Acceso» no dice el giro; sirve a otros usos de entrada/pase | Conservar el nombre, con subtítulo «Baños y accesos» |
| 9 | NEXORA Turismo | Lugar turístico | Lugar turístico (`turistico`) | Doc 42 | Ninguna relevante | Conservar |
| 10 | NEXORA Palapa | Palapa | Palapa | Doc 42 | Ninguna | Conservar |
| 11 | NEXORA Restaurante | Restaurante | Restaurante | Doc 42 | Ninguna | Conservar |
| 12 | NEXORA Comedor | Comedor | Comedor | Doc 42 | Ninguna | Conservar |
| 13 | NEXORA Taquería | Taquería | Taquería | Doc 42 | Ninguna | Conservar |
| 14 | NEXORA Mercado | Verdulería | Verdulería (`verduleria`) | Doc 42 | **Producto «Mercado» ≠ giro «Verdulería»** (id `greens`); «Mercado» sugiere algo más amplio | Decidir: «NEXORA Verdulería» (claro) o mantener «Mercado» y explicar «frutas y verduras» |
Notas generales: los nombres están marcados en el código como «provisionales hasta que el propietario los apruebe»; las claves internas (`market`, `tools`, `greens`…) no son visibles al cliente y no necesitan cambiar. Mezcla de idiomas (Barber/Nails vs resto en español) es la única inconsistencia de estilo.

## 6. Estimación de costos
| Etapa | Costo en dinero | Esfuerzo (relativo) |
|---|---|---|
| 0 Estabilizar | $0 | Bajo; depende de tus acciones |
| 1 Visual/primeros pasos | $0 | Medio |
| 2 Escaparates | $0 con URLs/ilustraciones | Medio-alto |
| 3 Planos de mesas | $0 | Medio-alto |
| 4 Menús/listas compartibles | $0 | Bajo-medio |
| 5 Perfumería/Papelería/Acceso | $0 | Medio |
| Fotos reales | **Por calcular** (almacenamiento + respaldos; hoy no se estima sin cifras de tarifa verificadas) | Medio |
| Mensajería automática / pago en línea | **Costo de terceros; excluidos** | Alto |
Las etapas 1–5 usan solo la infraestructura actual; aumentan algo las peticiones a la base y el tamaño de datos, sin cambio de plan esperado, pero no he medido el consumo: se medirá al terminar cada etapa.

## 7. Riesgos y dependencias
- **Producción recién publicada:** cualquier cambio se prueba con copia y se publica por separado; dependemos de tu autorización.
- **Datos:** escaparates, imágenes y datos del negocio necesitan campos nuevos (migraciones aditivas) → aprobación expresa antes; ensayo con copia como en el lanzamiento.
- **Páginas públicas = exposición:** más datos visibles públicamente (privacidad, textos del negocio, contenido ofensivo en URLs, enlaces rotos); límites por negocio y opción de ocultar.
- **Reservas requieren el complemento «reservas»:** definir si el escaparate se incluye o no con él, **sin cambiar precios ni planes** (decisión tuya).
- **Imágenes por URL:** dependen de sitios externos; siempre habrá ilustración de reserva.
- **Planos de mesas:** mayor complejidad móvil; mantener la lista actual como alternativa.
- **Alcance:** evitar convertir catálogos en tiendas; no hay carrito ni pedido.
- **Pendientes de tu lado:** `BACKUP_KEY`, sesiones reales, aprobar nombres, qué negocios participan en validación.

## 8. Qué falta para considerar estable la producción
1. Instalar `BACKUP_KEY` (secreto, por tu cuenta) y comprobar que el siguiente respaldo automático queda cifrado y se puede abrir.
2. Respaldo manual desde el Super Panel (con tu acceso) y verificación de su contenido.
3. Comparación programada del 25-nov (09:35 UTC): resultados anexados al doc 40 (solo lectura; hoy es 25-nov, se revisará su resultado).
4. Panel «Salud del sistema» sin alertas (migraciones 48, sin errores).
5. Checklist con sesiones reales (dueño, administrador, encargado, empleado) en 1–2 negocios autorizados, sin tocar sus datos más allá del uso normal.
6. Revisión de errores de la plataforma durante varios días sin incidentes nuevos.
7. Prueba de recuperación documentada (ya hecha en copia; falta con respaldo cifrado real).
Cuando 1–6 estén en verde, se declara producción estable.

## Qué necesito para empezar
1. Autorización de desarrollo de la **etapa 1** (rama `diseno-v0`, sin publicar).
2. Decisión de nombres (tabla §5), especialmente «Mercado».
3. Los negocios reales autorizados para validar y cuándo.
4. Tus pasos 0.1–0.2 (BACKUP_KEY y respaldo manual); puedo darte la guía exacta.
