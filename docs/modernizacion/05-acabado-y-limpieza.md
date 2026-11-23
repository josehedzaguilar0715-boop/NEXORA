# NEXORA — Acabado visual premium, notificaciones y limpieza de almacenamiento

Fecha: 23 nov 2026 · Rama `modernizacion` · Nada publicado en producción.

## 1. Notificaciones que no hay que reactivar

**Causa encontrada (en el código):** al **cerrar sesión**, la app borraba la suscripción del celular; al volver a entrar pedía «Activar» otra vez. Además, cuando el navegador renueva la suscripción por su cuenta (pasa periódicamente) el servidor la daba de baja y nadie la volvía a registrar.

**Arreglo:**
* Si el celular ya dio permiso alguna vez, NEXORA **se vuelve a suscribir sola** al entrar y cada vez que se abre (sin preguntar nada). `web/src/Avisos.tsx` → `syncPush()`.
* Al cerrar sesión solo se desliga **esa cuenta** del celular (privacidad en celulares compartidos); el permiso se conserva.
* El service worker vuelve a registrar la suscripción cuando el navegador la renueva (`pushsubscriptionchange` en `web/public/sw.js`).

**Pruebas:** `test/avisos.test.ts` (salir/entrar, repetir sin duplicar, celular compartido). En navegador, simulando solo el servicio de push de Google (este entorno no puede conectarse a él): con permiso dado, al entrar se suscribe sola, el panel ya no pide «Activar» y tras salir y volver a entrar se reactiva sin tocar nada.
**No verificado:** un aviso llegando a un teléfono real (requiere el servicio de Google desde un celular).

## 2. Acabado visual premium

Archivo nuevo `web/src/premium.css` (capa sobre `styles.css`, fácil de revisar o quitar) + acabados por producto en `web/src/products/products.css`.

| Área | Qué cambió |
|---|---|
| Profundidad | Sombras en capas (`--elev-1/2/3`), superficies con luz arriba, borde de luz interior |
| Indicadores | Línea de color del producto arriba de cada tarjeta; números con más presencia |
| Botones | Principal con brillo y resplandor del color del producto; se hunde al presionar; se eleva al pasar el mouse |
| Formularios | Campos con fondo hundido, borde al pasar el mouse, resplandor al enfocar |
| Menú | Vidrio con degradado, marcador luminoso animado en la sección activa |
| Accesos rápidos | Inclinación 3D al pasar el mouse (solo en computadora) |
| Paneles y ventanas | Entrada con resorte, fondo con desenfoque |
| Pestañas | Subrayado que aparece deslizándose |
| Gráficas | Barras que crecen, líneas que se dibujan con área degradada debajo, anillo de meta animado |
| Fondo | Aurora estática del color del producto (no se anima) |
| Caja | Solo una confirmación de 160 ms al agregar; nada retrasa un toque |

**Por producto:** Barber latón pulido (botón metálico, cuero con luz cálida); Nails porcelana nacarada (sombras rosadas suaves, línea iridiscente); Tienda nítida (menos vidrio, sombras cortas, etiqueta amarilla).

**Rendimiento (medido, CPU 4× más lenta, mediana de 6 corridas, versión anterior vs. actual):**

| | Antes | Ahora |
|---|---|---|
| Abrir la caja | 539 ms | 547 ms (+1.5 %, dentro de la variación) |
| Agregar un producto con lector | 67 ms | 58 ms |

Reglas: solo se anima transformación y opacidad; efectos de mouse solo en equipos con mouse; vidrio solo en menú, barra y fondos de ventana; todo se apaga con «reducir movimiento».

## 3. Auditoría de almacenamiento y limpieza

### Antes y después (entorno de desarrollo)

| Medida | Antes | Después | Liberado |
|---|---|---|---|
| **Disco usado en el entorno** | 10,784,596 KB | 9,682,468 KB | **1,102,128 KB (≈ 1.05 GB)** |
| Proyecto (con dependencias) | 536.7 MB | 500.2 MB | 36.5 MB |
| `node_modules` | 496.5 MB | 486.7 MB | 9.8 MB |
| Carpeta de trabajo temporal | 557.1 MB | 7.6 MB | 549.5 MB |
| Caché de npm | 536.8 MB | 19.4 MB | 517.4 MB |
| Archivos públicos de la app (`web/public`) | 246.7 KB | 214.7 KB | 32.0 KB |
| Código versionado | 2,058,597 B | 2,068,974 B | +10 KB (se agregaron los scripts de verificación, ver abajo) |

### Qué se eliminó y por qué era seguro

| Elemento | Tamaño | Comprobación |
|---|---|---|
| Componente `LogoHorizontal` y sus estilos; reglas `.nav-title` y `.date-pick` | ~2 KB | Ningún archivo los usa (búsqueda en todo el código) |
| `web/public/nexora-logo-horizontal.svg` | 1.2 KB | No lo referencia el HTML, el manifiesto ni el código |
| Paquetes sobrantes `@img/sharp-wasm32`, `tslib` (y `@emnapi/runtime` dentro) | 9.5 MB | `npm ls` los marca «extraneous» (nadie los requiere); build y pruebas pasan sin ellos |
| `.wrangler/` (simulación local de Cloudflare) | 24 MB | Datos de prueba; se regenera solo |
| `test/e2e/shots/` | 2.4 MB | Capturas que la prueba vuelve a generar |
| Carpeta de trabajo de sesiones anteriores (spikes, capturas, videos de cámara de prueba, 14 bases de prueba) | ~550 MB | Se revisaron las 14 bases: **ninguna con datos reales** |
| Caché de npm | ~517 MB | Se vuelve a descargar sola si hace falta |

### Optimizado (sin eliminar)
* 5 íconos PNG recomprimidos **sin pérdida** (comparación píxel a píxel idéntica): 240.7 KB → 209.9 KB. Se descargan al instalar la app y van dentro del Worker.

### Conservado a propósito
* **Producción (Cloudflare): nada eliminado.** Los respaldos de más de 30 días ya se borran solos (código revisado, `src/backup.ts`).
* Archivos CSV de Barbería Fénix en la carpeta de trabajo (**datos reales de clientes**): no se tocaron. Recomendación: el propietario decide si se borran.
* El zip del código que se entregó al propietario.
* Dependencias en uso (todas las de `package.json` tienen uso o son tipos/requisitos indirectos), el navegador de pruebas, `.git`, la compilación actual.

### Agregado
* `scripts/verificacion/`: los recorridos en navegador que se usaron para verificar (con su README), para que quien siga no tenga que rehacerlos.

### Recomendado para después (requiere autorización, es producción)
* Las 13 demos creadas en producción ocupan espacio en la base real (datos ficticios). Se pueden quitar con el super panel, con respaldo previo.

## 4. Pruebas finales

Ver resultados en `04-continuidad.md` §4 (actualizado al cierre).
