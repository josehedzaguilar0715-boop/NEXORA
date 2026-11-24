# 21 · diseno-v0 · Fase 2: navegación con color por módulo y buscador global

Rama `diseno-v0` (no publicada). Solo presentación y navegación: sin cambios en lógica comercial, APIs, permisos ni datos.

## Qué se hizo
* **Buscador global** (`web/src/Buscador.tsx`, lógica pura en `web/src/buscar.ts`): campo «Buscar… (ej. fiado, cita)» en el menú. Ignora acentos y mayúsculas, acepta varias palabras y sinónimos («cita» → Agenda, «deuda» → Clientes y fiado, «proveedor» → Compras), ordena por relevancia (nombre > sinónimo > descripción) y **solo encuentra lo que esa persona puede abrir**: recibe las pantallas ya filtradas por permisos, giro, módulos y producto. Sin escribir muestra «Lo más usado» del producto. Resultado con icono y color de su módulo, nombre y qué hace; «Sin resultados…» con sugerencia.
* **Atajos**: `/` o `Ctrl+K` enfocan el buscador; `↑ ↓ Enter` navegan; `Esc` cierra. En la Caja el campo de producto conserva el foco (`/` se escribe ahí); `Ctrl+K` sí abre el buscador. En celular y tableta, botón de lupa en la barra superior.
* **Color por módulo** (mismos en los 14 productos): el menú, las pestañas de cada sección y el panel de opciones usan el color de su módulo; cada pantalla muestra una etiqueta con icono y módulo.
* **Menú desplegable** (celular y tableta): fondo sólido (antes dejaba transparentar el contenido de atrás).

## Verificación (todas ejecutadas)
| Prueba | Resultado |
|---|---|
| `test/buscador.test.ts` (5): acentos, sinónimos, varias palabras, sin coincidencias, nadie encuentra lo que no se le dio | 5/5 |
| `scripts/verificacion/navegacion.ts` en navegador real: 5 productos × 3 tamaños (1366×900, 768×1024, 390×844): foco por `/` o lupa, «lo más usado», primer resultado correcto, Enter abre la pantalla, color de módulo, sin desborde ni errores, aviso sin coincidencias; empleado: no encuentra Finanzas, Personal ni Reportes y sí Caja; teclado (Ctrl+K, flechas, Enter) | todo en orden |
| Auditoría de contraste y letra mínima (`fundamentos-visuales.ts … inicio`): 14 productos × 2 modos × 3 tamaños = 84, con el nuevo menú | 0 hallazgos |
| `npm run typecheck`, `npm run e2e` (caja) | OK |

## Errores encontrados y corregidos
1. La lista de resultados se cortaba en el borde del menú en computadora → ahora ocupa el ancho del menú y el texto se ajusta.
2. El menú desplegable en celular/tableta era translúcido y mostraba texto de la pantalla detrás → fondo sólido.
3. Con la Caja abierta, `/` no podía abrir el buscador (por diseño, para no quitar el foco al cobrador) → se documentó `Ctrl+K` y la prueba lo usa.

## Estado: FASE 2 TERMINADA Y VERIFICADA
Siguiente: fase 3 (dashboards).
