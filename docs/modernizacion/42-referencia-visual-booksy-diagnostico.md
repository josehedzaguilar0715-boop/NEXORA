# 42 · Referencia visual oficial (estilo de plataformas de reservas como Booksy): diagnóstico

**Estado: solo diagnóstico. No se cambió código, producción ni datos.** Rama `diseno-v0` (producción: versión `34191efa`).

> **Aviso de transparencia:** la captura de Booksy **no llegó a mi sesión** (no la veo ni está en los archivos subidos; lo más reciente subido es del 18-nov y no es esa captura). Este diagnóstico se basa en (a) lo que **sí verifiqué en nuestro código** y (b) los patrones **generales** de las plataformas de reservas modernas. **Cuando reenvíes la captura, lo contrasto punto por punto y ajusto este documento.** No se copia ninguna marca, texto, imagen ni diseño exacto: se toman solo **principios**.

## Principios oficiales de dirección visual
1. **Portada atractiva** con identidad del negocio (imagen grande, logotipo, nombre, giro, valoración si la hay).
2. **Buscador claro** (qué servicio / negocio / producto busco) y filtros simples.
3. **Tarjetas con imagen** para servicios, productos, personal y negocios.
4. **Categorías** visibles y navegación intuitiva (pestañas o carrusel horizontal).
5. **Página pública = escaparate**: servicios con precio y duración, fotos, horario, ubicación, reservar en 1–2 toques.
6. **Móvil primero** y buen aspecto en tableta y computadora.
7. **Panel administrativo limpio**: lo importante primero, poca densidad.
**Límites (decisiones previas que se conservan):** identidad **azul única** de NEXORA con el nombre y logotipo de cada producto; cada giro mantiene su operación especializada; **no** convertir NEXORA en marketplace (cada negocio tiene su escaparate propio, sin buscador entre negocios) salvo decisión expresa; sin tocar producción ni datos; **no iniciar rediseño que ponga en riesgo el lanzamiento**.

## A. Página pública del negocio — diagnóstico
| Elemento | Hoy en NEXORA (verificado) | Qué falta frente a la referencia |
|---|---|---|
| Portada | Logotipo pequeño (URL) + nombre + horario en texto, columna de 720 px, fondo neutro | **Imagen de portada** grande, bloque de presentación (nombre, giro, ubicación, valoración), botón «Reservar» fijo y visible |
| Fotografías | **No existen**: la base solo guarda `logo_url`; servicios, personal y negocio no tienen foto | Galería del negocio, foto por servicio y por persona. **Dependencia:** hoy no hay carga de archivos (decisión pendiente: URL de imagen vs almacenamiento) |
| Servicios | Botones de texto con nombre, precio y duración, sin agrupar aunque el dato `categoría` ya existe | **Agrupar por categoría** (pestañas/carrusel), tarjetas con foto, descripción corta, «desde $», duración |
| Buscador | Ninguno | Buscar servicio dentro del negocio (útil con >10 servicios); **no** buscador entre negocios |
| Información | Horario por día, teléfono (solo en estado de cita). **No hay dirección, mapa, redes ni descripción** del negocio | Dirección, mapa/enlace, redes, descripción, formas de pago, políticas (cancelación) |
| Confianza | Nada | Valoraciones/reseñas (requiere flujo nuevo y moderación), personal con foto y especialidad |
| Personal | Nombre + inicial (el dueño aparece como el negocio) | Tarjetas de equipo con foto y especialidad (respetando la privacidad ya definida) |
| Boletos / tarjeta de sellos | Páginas públicas funcionales sin imagen | Misma portada y tarjetas para turístico/baños; tarjeta de sellos con marca |
| Adaptación | Funciona en celular (auditado), pero es una sola columna sin jerarquía visual | Diseño de 2 columnas en computadora (servicios + resumen de reserva), tarjetas grandes en celular |

## B. Reservas — diagnóstico
| Elemento | Hoy | Falta |
|---|---|---|
| Flujo | 4 pasos en una tarjeta larga: servicio → persona → día/hora → datos | Flujo guiado por pasos con resumen fijo (servicio, precio total, duración), selección de varios servicios con total visible |
| Horas | Botones de hora; solo horas libres reales (ya correcto) | Calendario de días con disponibilidad marcada, «primer hueco disponible», horas agrupadas (mañana/tarde) |
| Persona | Chips con nombre | Tarjetas con foto/especialidad; «cualquiera» destacado |
| Confirmación | Mensaje «por confirmar» + enlace de estado | Pantalla de confirmación con resumen, «agregar al calendario», cómo llegar, política de cancelación; recordatorio (hoy manual; automático requiere proveedor, doc 35) |
| Cliente | Nombre y teléfono | Opcional: correo, notas; cuenta de cliente (no necesaria al inicio) |
| Pagos | No hay | Anticipo en línea opcional (requiere pasarela: decisión y costo del dueño) |
| Gestión | Ver/cancelar con enlace privado (ya existe) | Reprogramar desde el enlace |

## C. Panel administrativo — diagnóstico
| Elemento | Hoy | Falta |
|---|---|---|
| Estructura | Arquitectura v0 ya aplicada: barra superior, menú por módulos con color, buscador global, tarjetas de cifras, modo claro/oscuro, tarjetas en celular | Mantener; la referencia sugiere **más aire** y jerarquía visual en Inicio |
| Inicio | KPIs, «requiere tu atención», acciones rápidas, «Mi día», resumen de sucursal | Portada/encabezado del negocio con su imagen, accesos con ilustraciones/íconos más grandes, calendario del día más visual (agenda tipo línea de tiempo) |
| Catálogo | Productos/servicios en tabla o tarjeta de texto | **Tarjetas con imagen** y vista de cuadrícula; categorías como pestañas |
| Perfil del negocio | Nombre, teléfono, logo (URL) en Ajustes | Una sección «Mi escaparate»: portada, galería, descripción, dirección, redes, categorías, vista previa de la página pública |
| Agenda | Columnas por persona con huecos y estados (ya sólida) | Vista semanal/mensual, arrastrar para reprogramar |
| Marketing | No hay | Compartir enlace/QR, reseñas (futuro) |

## Brechas transversales y dependencias (lo que condiciona todo)
1. **Imágenes**: sin carga de archivos no hay fotos. Opciones: (a) URL de imagen externa (inmediato, frágil), (b) almacenamiento de archivos de Cloudflare (R2: puede tener costo/requiere configuración y tu autorización), (c) imágenes **ilustrativas por giro** propias (sin costo, sin datos del negocio). **Decisión tuya.**
2. **Modelo de datos**: faltan dirección, descripción, redes, galería, foto por servicio/persona (migraciones aditivas, a probar con el mismo ensayo del lanzamiento).
3. **Privacidad**: toda foto o dato público del personal pasa por el control actual (nombre + inicial; el dueño como negocio) y por consentimiento.
4. **No-marketplace**: el buscador es **dentro del negocio** (servicios/productos). Un directorio entre negocios sería otro producto y otra decisión.

## Propuesta de fases (NO iniciadas; ninguna toca producción hasta tu autorización)
| Fase | Alcance | Riesgo | Costo |
|---|---|---|---|
| 0 | Reenviar la captura; fijar tokens (espaciado, radios, tarjetas con imagen) en una **guía visual** dentro de `diseno-v0` | Nulo | $0 |
| 1 | **Página pública** con portada, categorías, tarjetas de servicio con imágenes ilustrativas por giro y buscador interno (sin migraciones; usa datos existentes) | Bajo (solo pantallas públicas) | $0 |
| 2 | **Flujo de reserva** guiado con resumen fijo y confirmación mejorada | Bajo-medio | $0 |
| 3 | **«Mi escaparate»** (dirección, descripción, redes, galería por URL) con migración aditiva y ensayo | Medio | $0 |
| 4 | Fotos reales (carga de archivos), reseñas, anticipos, recordatorios automáticos | Medio-alto | Posible costo: requiere tu autorización |
Cada fase: rama propia, auditorías visuales y pruebas ya existentes, ensayo de migración con copia, y **publicación solo con tu autorización** (nunca sobre un lanzamiento sin verificar).

## Lo que necesito de ti
1. **Reenviar la captura** (no la recibí).
2. Decidir qué imágenes usar (§ dependencias 1) y si el alcance es solo escaparate por negocio.
3. Autorizar la Fase 0–1 cuando quieras empezar; mientras, **no se ejecuta ningún cambio**.
