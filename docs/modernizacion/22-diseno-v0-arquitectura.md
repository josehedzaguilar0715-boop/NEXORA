# 22 · diseno-v0 · Arquitectura visual de v0 en la interfaz real de NEXORA

Rama `diseno-v0` (no publicada ni fusionada). Prioridad definida por el propietario (24 nov 2026): **la arquitectura y el diseño del ZIP de v0 son la base visual y estructural**; después se perfecciona. Solo cambia la presentación y la navegación: no se tocaron lógica comercial, APIs, permisos, datos ni integraciones.

## Qué de v0 se llevó a NEXORA
| Elemento de v0 | En NEXORA |
|---|---|
| Barra superior fija (marca + buscador + avisos) | `Topbar` en `App.tsx`: logotipo y nombre del producto/negocio, **buscador global** al centro, estado de envíos, campana de avisos y menú de la persona (modo claro/oscuro, salir). |
| Menú de módulos con iconos de color y nombres completos | Menú lateral (computadora) **agrupado y siempre visible**: Inicio, Vender, Inventario, Clientes, Dinero, Mi negocio; cada opción con icono en cuadro del color de su módulo. Reemplaza los menús emergentes escondidos. |
| Barra inferior de 5 botones (celular y tableta) | `BarraInferior`: Inicio · Vender · Stock · Clientes · **Más** (hoja con todos los módulos, modo claro/oscuro y salir). Tamaño de letra ≥ 18 px. |
| Tarjetas planas con borde fino, botones y campos de 44–48 px, un solo botón principal | `web/src/v0.css`: capa que se aplica a **todas** las pantallas (tarjetas, botones, campos, tablas, encabezados, pestañas) sin tocar su lógica. |
| Dashboard: encabezado, indicadores con icono y tendencia, dos columnas (principal + lateral) | `Inicio`: indicadores con icono de módulo y tendencia en insignia; columna principal (agenda, gráfica 7/30 días, ganancia real, movimientos) y lateral (acciones rápidas con una principal, «Requiere tu atención», lo más rentable, stock bajo). Una columna en celular. |
| Estados con color + icono + texto; colores por módulo | `Estado.tsx`, `tokens.css` (ya de la fase 1). |
| Buscador de módulos con palabras clave | `Buscador.tsx` / `buscar.ts` (fase 2), ahora en la barra superior. |

Cada uno de los 14 productos **conserva su identidad**: color de marca, letra de títulos y logotipo (`products.css` / `modos.generated.css`). Comparten estructura, jerarquía y componentes.

## Verificación (todo ejecutado sobre el código final)
| Prueba | Resultado |
|---|---|
| Auditoría de **Inicio**: 14 productos × claro/oscuro × computadora/tableta/celular = 84 (contraste AA, letra ≥ 18 px en celular, desborde, **textos encimados**, errores de JS) | **0 hallazgos** |
| Auditoría de **Caja**: las mismas 84 combinaciones | **0 hallazgos** |
| Auditoría de **Productos** en celular: 14 × 2 | **0 hallazgos** |
| Navegación y buscador (`navegacion.ts`): 5 productos × 3 tamaños, empleado sin acceso a Finanzas/Personal, teclado | 139 comprobaciones, 0 fallos |
| Dashboards (`dashboards.ts`): iconos, dos columnas/una columna, «Requiere tu atención», acciones rápidas, selector 7/30 días, sin desborde | 84 comprobaciones, 0 fallos |
| Interruptor de tema (`tema-interruptor.ts`): claro por defecto, cambio con un toque desde el menú de la persona (computadora) o «Más» (celular), se recuerda al recargar y en el acceso | 40 comprobaciones, 0 fallos |
| **298 pruebas** del servidor y del buscador (`vitest`) | 298/298 |
| Prueba de navegador de la caja (`npm run e2e`) | OK (se adaptó a los nuevos enlaces del menú) |

## Errores encontrados y corregidos en este paso
1. La barra superior se salía de la pantalla en celular con nombres largos (Restaurante) → la marca se recorta con puntos suspensivos y las acciones no se encogen.
2. Insignia de pendientes de la barra inferior con letra de 14 px → 18 px.
3. Botón de lupa visible también en computadora → solo en celular y tableta.
4. Las pruebas de navegador chocaban con nombres repetidos (enlace «Caja» en menú y acciones, grupo «Clientes») → pruebas precisas y sin etiqueta repetida.
5. Etiquetas de acciones rápidas partidas a media palabra → una columna cuando no caben dos.
6. «Sin datos para comparar» dibujado como insignia gigante → texto simple.

## Alcance real y lo que sigue
* **Hecho**: cascarón (barra superior, menú, barra inferior, hoja «Más»), estilo general para todas las pantallas, Inicio rediseñado, buscador y tema. Las pantallas que no se rediseñaron una por una (Caja, Productos, Clientes, Finanzas, Ventas y retiro, Configurar, Personal, Ajustes…) heredan tarjetas, botones, campos, tablas y encabezados de v0 y se revisaron en captura (abarrotes, computadora y celular); Inicio y Caja están auditadas en los 14 productos.
* **Pendiente (siguientes pasos de perfeccionamiento)**: auditar con el mismo rigor el resto de pantallas en los 14 productos; rediseño interno de pantallas densas (Caja con cuadrícula de productos y cobro como v0, tablas de Productos y Clientes en celular como tarjetas, formularios en secciones); revisar las pantallas propias de cada giro (Agenda, Mesas, Cocina, Taquilla, Carne…); retirar el CSS del menú anterior que ya no se usa; modo oscuro con captura de cada pantalla.
* Los negocios actuales verían este diseño al publicarse (cuando el propietario lo autorice): modo claro por defecto, menú lateral agrupado en computadora y barra inferior en celular.
