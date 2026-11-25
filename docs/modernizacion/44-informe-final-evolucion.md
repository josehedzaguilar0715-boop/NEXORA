# 44 · Informe final único: evolución de NEXORA lista para publicar

**Estado: terminado en `diseno-v0`, NO publicado.** Producción sigue en la versión `34191efa` (esquema 48), sin tocar. Documentos rectores: 42 (benchmark), 43 (plan maestro), 40 y 41 (lanzamiento y validación), 38/39 (cierres anteriores).

## 0. Resumen en cinco líneas
- Se ejecutaron las 5 etapas aprobadas del plan 43, **sin migraciones, sin cambios de esquema, planes, precios, permisos ni roles** y sin servicios de pago.
- Pruebas: 349 pruebas automáticas, 5 verificaciones nuevas en navegador, auditoría visual de 414 pantallas (claro 0 hallazgos / oscuro 0 hallazgos), motor de Cloudflare (local) y ensayo de migración sobre copia de producción.
- **Pendientes que no pude hacer por falta de acceso** (explicados en §9): `BACKUP_KEY`, validación con sesiones de los tres negocios reales y revisión del cron de comparación de respaldos (se ejecuta hoy 09:35 UTC).
- El commit propuesto está en §10; al no haber migraciones, publicar y revertir son operaciones solo de código.

## 1. Qué se desarrolló en cada producto
Antes de cada mejora se revisó el código existente para no duplicar (por ejemplo: **ya existía** una guía de «primeros pasos» dentro de «Pendientes de hoy»; se retiró un componente nuevo duplicado y se amplió la existente).

| Producto | Mejoras de esta evolución |
|---|---|
| **NEXORA (base)** | Menú diario corto con «Otras herramientas». Páginas públicas y escaparate no aplican. |
| **NEXORA Barber** | Escaparate público de reservas: portada, descripción, horario, dirección, redes, servicios por categoría con foto/ilustración, profesionales. Editor «Mi escaparate». Foto por servicio. |
| **NEXORA Nails** | Igual que Barber (el servicio conserva el tiempo de secado al editar su foto). |
| **NEXORA Tienda** | Menú corto; catálogo/lista compartible opcional con fotos por URL (producto → campo Foto). |
| **NEXORA Ferretería** | Catálogo compartible opcional. (La cotización compartible queda **pendiente**, ver §9.) |
| **NEXORA Papelería** | **Tablero de encargos**: «Por hacer» / «Listos para entregar», aviso de vencido/entrega hoy/en N días, **aviso manual por WhatsApp** (enlace; no se envía nada solo). Catálogo opcional. |
| **NEXORA Perfumería** | Notas olfativas en la ficha del producto → se muestran en el catálogo público; foto por URL. |
| **NEXORA Acceso** (Baños y accesos) | Subtítulo «Baños y accesos»; menú diario sin Compras/Clientes/Membresías a la vista (van en «Otras herramientas»); **alerta de limpieza** por tarea («Pendiente · Sin limpiar hoy / Hace X h»). Primeros pasos con tarifas. |
| **NEXORA Turismo** | Tienda pública de boletos con portada, datos del negocio, ilustraciones o fotos por tipo de boleto (campo Foto en «Tipos de boleto»). Primeros pasos: tarifas y primer horario con aforo. |
| **NEXORA Palapa** | **Plano gráfico de mesas** (Lista/Plano), menú digital compartible opcional. |
| **NEXORA Restaurante** | Plano gráfico de mesas y menú digital compartible. |
| **NEXORA Comedor** | Plano de mesas (solo si el negocio tiene mesas) y menú digital compartible. |
| **NEXORA Taquería** | Plano de mesas (si tiene mesas), menú digital y primeros pasos con mesas. |
| **NEXORA Mercado** (Frutas y verduras) | Subtítulo «Frutas y verduras»; **lista de precios del día** compartible (sin fotos; precios por kilo). |
| **Super Panel** | Sin cambios funcionales (no estaba en el alcance de las etapas); revalidado con la auditoría de pantallas y rutas. |

## 2. Mejoras visuales
- Menú: lo ocasional (Soporte, Importar, Ajustes, Mi asistencia y, en Acceso, Compras/Clientes/Membresías) queda recogido en **«Otras herramientas»**; se abre solo si estás dentro de ella. Identidad azul única intacta.
- Subtítulos en el encabezado (escritorio) y en «Más» (celular) para Acceso y Mercado.
- **Ilustraciones por giro** (icono sobre degradado azul, sin descargas) para negocios sin foto o cuando la URL no carga.
- Páginas públicas con estructura común (portada, datos, secciones, tarjetas); correcciones de contraste y tamaño de letra (≥18 px en celular) encontradas por las auditorías propias.
- Plano de mesas con forma según lugares, estado en **color y texto**, leyenda y arrastre para acomodar (quien configura).

## 3. Funcionalidades agregadas o corregidas
- **Mi escaparate** (Ajustes, solo dueño): descripción, dirección, horario, Instagram, Facebook, portada (https) y «publicar mi menú/lista/catálogo» (apagado por defecto).
- **Páginas públicas nuevas:** `/carta/<enlace>` (menú digital, lista de precios o catálogo según giro; solo nombre, precio, foto; nunca costos ni existencias; solo con enlace propio, no con el código interno).
- **Plano de mesas:** `GET/PUT /tables/plan` (ver quién puede, §6).
- **Fotos por URL** en productos, servicios y boletos (solo `https`; si falla, ilustración). Se guardan dentro de los atributos que ya existían.
- **Primeros pasos:** nuevos pasos para turismo/baños (tarifas, horario con aforo) y mesas para taquería.
- Corrección durante el desarrollo: etiquetas de mesas <18 px y verde con contraste insuficiente en el plano (hallado por la auditoría y corregido).

## 4. Resultados de las pruebas
| Prueba | Resultado |
|---|---|
| Tipos (`npm run typecheck`, servidor y web) | Sin errores |
| Pruebas automáticas (vitest) | **349 de 349** en 68 archivos (se agregaron 4: escaparate público ×2, plano de mesas, primeros pasos de turismo) |
| Punta a punta (`npm run e2e`) | OK (caja, restaurante, buzón, super panel) |
| Auditoría de TODAS las pantallas de los 13 giros (contraste AA, letra ≥ 18 px en celular, desborde, encimados, errores de JS) | **414 pantallas en modo claro: 0 hallazgos; 414 en oscuro: 0 hallazgos** |
| Páginas públicas (reservas, boletos, menú, lista de precios, catálogo) × claro/oscuro × 3 tamaños | 36 revisiones, 0 hallazgos |
| Super Panel (6 secciones × 2 modos × 3 tamaños) | 36 pantallas, 0 hallazgos |
| Menú simplificado, 13 giros × escritorio/celular | 132 comprobaciones en verde |
| Escaparates, carta, lista de precios y boletos | 145 comprobaciones en verde (datos propios, ilustración si falla la foto, sin datos internos, apagado → 404) |
| Plano de mesas (4 giros × escritorio/celular, claro/oscuro) | En verde: sin encimarse, acomodar y conservar tras recargar, lista disponible, contraste y letra |
| Etapa 5 (encargos, limpieza, notas olfativas) | 19 comprobaciones en verde, con auditoría de contraste |
| Tres puestos × dos sucursales, escritorio y celular | En verde (el empleado recibe 403 donde corresponde) |
| Matriz de rutas por puesto (`permisos-rutas`) | Sin cambios de acceso; `/tables/plan` lectura para quien ya veía mesas |
| Panel de inicio, teclado, interruptor de tema, 14 productos y datos | 84 / 39 / 40 / 27 comprobaciones en verde |
| Agenda → Caja en pantalla | En verde (la primera corrida falló por un error **de la prueba**: usaba el día en UTC y de noche en México ya era otro día; corregida) |
| **Motor real de Cloudflare** (`wrangler dev`: workerd + Durable Object SQLite, local) | Esquema 48; escaparate, carta (404/200/404), plano, rechazo de datos inseguros, 401 sin sesión: **12 de 12** |
| Ensayo de migración sobre copia de producción | 17 verificaciones en verde (ver §5) |

Hallazgos corregidos durante la validación: etiquetas de mesa de 15.6 px y verde con contraste 3.3 en el plano (ahora ≥ 18 px y colores de la vista Lista); 4 px de desborde horizontal por la leyenda del plano en celular; una pantalla de primeros pasos duplicada (retirada); botón «Ocultar» con estilo inexistente.
**No** se ejecutaron en esta evolución: carga (`carga.cjs`), internet lento, impresión térmica ni Safari/Firefox (sin cambios en esas áreas, pero tampoco se repitieron).

## 5. Migraciones ensayadas
- **Esta evolución no agrega migraciones**: `src/db.ts`, `wrangler.toml`, `package.json` y dependencias sin cambios respecto de lo publicado; esquema 48 = esquema de producción. Todo lo nuevo se guarda en tablas/columnas ya existentes (`business_settings`, `attrs` de productos/servicios).
- Ensayo igualmente repetido con el candidato actual sobre la copia aislada de producción (esquema 42, 11 negocios, 1,835 renglones): **17 verificaciones en verde**: nada se pierde ni cambia, 0 referencias rotas, integridad ok, reabrir es idempotente, 11/11 dueños recorren sus pantallas, 11/11 personal sigue sin acceso financiero. Ventas por negocio idénticas antes/después.
- Ida y vuelta de respaldo (exportar→restaurar, 11 negocios): ventas, inventario, fiado y gastos iguales y 0 referencias rotas en los 11; la comparación campo por campo solo difiere en `must_change_password`, que la restauración fuerza a propósito.
- La copia usada es el respaldo del 24-nov (pre-lanzamiento). Producción real ya está en 48; el candidato abre una base 48 sin cambios (probado en «reabrir es idempotente»).

## 6. Seguridad y respaldos
- Rutas nuevas: `/escaparate` solo dueño (401 sin sesión); `PUT /tables/plan` exige el permiso `configure_catalog` ya existente (el cajero lo ve pero recibe 403 al mover); se descartan ids de mesas ajenas; `/public/carta/:enlace` responde 404 si no está publicada, si el negocio está vencido/suspendido o si se usa el código interno.
- Entradas saneadas: solo `https` (sin `javascript:`), largos máximos, React escapa todo el texto; la política de contenido ya permitía imágenes `https`.
- No se tocaron permisos, roles ni acceso financiero; la matriz de rutas por puesto y la prueba de 3 puestos × 2 sucursales siguen en verde.
- Respaldos: automático diario (09:17 UTC) y manual desde el Super Panel siguen sin cambios. **El cifrado con `BACKUP_KEY` NO está activo todavía** (es un secreto de Cloudflare que solo puede instalar el propietario). Los pasos exactos están en el doc 41 (Paso C): `npm run backup:key` en tu computadora → `npx wrangler secret put BACKUP_KEY --env production` → comprobar la huella en Super Panel → Respaldos. Nunca me envíes la llave.

## 7. Estado de los tres negocios reales (barbería, uñas, abarrotes)
**No pude validarlos**: no tengo credenciales de esos negocios ni de soporte, y no registré ninguna operación en ellos. Evidencia indirecta: (a) ensayo con copia de los datos reales de los 11 negocios (§5); (b) demostraciones aisladas de barbería, uñas y abarrotes recorridas por las auditorías; (c) los tres solo reciben cambios de código (sin migración). Para cerrarlo hace falta tu checklist con sesión real (doc 41), sin crear operaciones ficticias.
Efectos visibles para ellos al publicar: menú con «Otras herramientas»; Barber/Nails ganan «Mi escaparate» (su página de reservas se ve igual hasta que llenen sus datos); Tienda ve la lista compartible apagada.

## 8. Costos
**Actuales: $0 adicionales** (sin servicios nuevos, sin almacenamiento, sin proveedores). La evolución usa la misma infraestructura Cloudflare. Impacto estimado en uso: unas pocas lecturas extra por página pública (cacheadas 60 s en la carta); no medido bajo carga real.
**Futuros (no contratados):** almacenamiento de fotos reales y su respaldo, mensajería automática (doc 35), pasarela de pago para boletos o reservas con anticipo, pedido en línea. Se calculan antes de cualquier decisión.

## 9. Limitaciones que no pudieron comprobarse / pendientes
1. `BACKUP_KEY`, respaldo manual y huella: requieren tus credenciales (guía en doc 41).
2. Sesiones reales de los tres negocios y Super Panel con cuenta de soporte reales.
3. Comparación programada de respaldos del 25-nov 09:35 UTC: aún no ocurre al momento de este informe.
4. Dominio de producción no alcanzable desde este entorno: verificación externa tras publicar se hace con la acción de GitHub «Verificar despliegue».
5. Impresión térmica real (58/80 mm) y lectores de QR con hardware: sin hardware aquí.
6. Navegadores: se probó con Chromium; no con Safari/Firefox ni móviles físicos.
7. Del plan 43 **no** se hicieron (no eran imprescindibles o requieren datos/servicios nuevos): cotización compartible (Ferretería), orden de compra, variantes de producto, notas y foto en ficha de cliente, afluencia por hora (Acceso), fotos con carga de archivos, reservas de mesa públicas, pedido/pago en línea, recordatorios automáticos.
8. El plano guarda posiciones en porcentaje: un plano acomodado en computadora puede verse algo distinto en celular (probado: sin desborde, pero dos mesas muy juntas pueden tocarse en pantallas angostas).
9. Fotos por URL dependen de sitios externos y de los derechos de cada negocio.

## 10. Commit propuesto para publicar
**`70c85d7e91e00221c373e8bd96708d7fe85f7450`** en la rama `diseno-v0` (es el último commit de código; después solo se agregan este informe y su documentación, sin cambiar la aplicación). Cambios respecto de lo publicado (`fcb8293`): 26+ archivos de código y pruebas; **sin tocar** `src/db.ts`, `wrangler.toml`, `package.json` ni dependencias.
Qué se incluye: etapas 1 a 5 y la mejora de Turismo (commits `01073a5`, `fd0251f`, `b285a27`, `25e70ec`, `8c84ced`, `70c85d7`).

## 11. Migraciones que se aplicarían
**Ninguna.** Esquema 48 en producción y en el candidato.

## 12. Plan de despliegue (solo con tu autorización)
1. Confirmar el commit de §10 y que `git status` esté limpio y la rama sincronizada.
2. Respaldo fresco previo (manual desde Super Panel o el automático de ≤24 h) y verificar que descarga/abre.
3. `npm run deploy:prod` (build + embebido de pantallas + `wrangler deploy --env production`). No cambia datos ni esquema.
4. Verificación externa con la acción «Verificar despliegue» (salud, esquema 48, páginas públicas, 0 errores).
5. Observar errores en Cloudflare (observabilidad) 30–60 min y revisar el Super Panel → Salud.
6. Tú: checklist con sesión real en uno de los tres negocios (abrir Inicio, Caja, Agenda; ver «Otras herramientas»; abrir «Mi escaparate» sin guardar nada si no deseas publicar).

## 13. Plan de reversión
- **Como no hay migraciones, revertir es solo código:** `npx wrangler rollback <id de versión anterior> --env production` (versión estable actual `34191efa-5149-4d55-ad8f-6a40bd2b8179`) o redeploy del commit `fcb8293`.
- Los datos nuevos (`perfil`, `planoMesas`, `imagenUrl`, `descripcion` en atributos) son claves JSON adicionales que la versión anterior simplemente ignora; no hay que borrarlas.
- Criterios para revertir: errores en observabilidad > 1 %, fallo de inicio de sesión, Caja o Agenda con errores, `schema ≠ 48`.
- Respaldo previo permite restaurar un negocio concreto (doc 41, restauración con simulación) solo si hubiera pérdida de datos, que esta versión no puede causar por diseño.

## 14. Riesgos pendientes
- Bajo: el cambio de menú puede desorientar un día a quienes buscaban Soporte/Importar/Ajustes (siguen un toque más adentro; el buscador global las encuentra).
- Bajo/medio: páginas públicas nuevas = más exposición. Mitigado: opt-in, solo datos de venta públicos, https, 404 si apagado/suspendido.
- Medio: validación con negocios reales aún pendiente (§7).
- Medio: respaldos sin cifrar hasta instalar `BACKUP_KEY` (riesgo ya existente, no nuevo).
- Bajo: imágenes externas rotas o inapropiadas (cada negocio responde por sus URLs; siempre hay ilustración de respaldo).
