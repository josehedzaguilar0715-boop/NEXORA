# 20 · diseno-v0 · Fase 1: fundamentos visuales

Rama `diseno-v0` (no publicada). Decisiones del propietario (24 nov 2026): tema claro por defecto y oscuro opcional; mantener Inter; texto mínimo de 18 px en celular; un color, un icono y un nombre por módulo; los 14 productos conservan su identidad; navegación organizada con buscador global (fase 2); prioridad a computadora, tableta y celular; sin cambios en lógica, APIs, permisos ni datos.

## Qué se hizo
| Pieza | Dónde |
|---|---|
| **Tema claro/oscuro.** Claro por defecto; botón «Modo oscuro/claro» en el menú; se recuerda por equipo (`localStorage nx_modo`), sin tocar el servidor. | `web/src/tema.ts`, `App.tsx` (`ModoBoton`), `products/index.ts` |
| **Modo contrario de cada producto**, generado desde su propia paleta (marca, letra de títulos y formas no cambian; superficies, textos y apoyo sí) con contraste AA garantizado. Los 9 productos claros se ven **igual que antes** en modo claro; los 5 oscuros (Barber, Ferretería, Perfumería, Taquería y la base) conservan su aspecto en modo oscuro. | `web/scripts/generar-modos.mjs` → `products/modos.generated.css/.ts` (no editar a mano; se regenera con `node web/scripts/generar-modos.mjs`) |
| **Colores de módulo** (iguales en los 14 productos): ventas azul, inventario violeta, clientes verde azulado, dinero verde, reportes naranja, mesas rosa, cocina ámbar, agenda índigo, administración pizarra; con icono y nombre. Mapa pantalla → módulo listo para el menú, encabezados y buscador. | `web/src/tokens.css` (`--m-*`), `web/src/modulos.ts` |
| **Estados** con color + icono + texto. | `web/src/Estado.tsx`, `tokens.css` (`.estado`, `--st-*`) |
| **Letra**: escala (`--fs-*`) y piso de **18 px en celular** aplicado a 51 tamaños que estaban por debajo y al `<small>` del navegador. Inter se mantiene. | `tokens.css`, `styles.css`, `premium.css`, `products.css` (`max(var(--fs-min), …)`) |
| **Guía visual** (`#/guia-visual`, fuera del menú): módulos, estados, letra, botones, iconos y cambio de modo. | `web/src/screens/GuiaVisual.tsx` |
| **Contraste de texto**: colores de enlace, aviso, éxito y error corregidos donde no llegaban a AA; texto de botones sobre su degradado completo. | `generar-modos.mjs` (bloque de ajustes por producto) |

## Verificación (navegador real, `scripts/verificacion/fundamentos-visuales.ts`)
Mide el texto realmente dibujado: contraste (4.5:1; 3:1 en texto grande), letra mínima de 18 px en celular, desborde horizontal, errores de JavaScript, identidad del producto y modo aplicado.

| Pantalla | Combinaciones | Resultado |
|---|---|---|
| Guía visual | 14 productos × 2 modos × 3 tamaños (1366×900, 768×1024, 390×844) = 84 | **0 hallazgos** (tras corregir contraste en modo claro de Barber/Taquería y modo oscuro de Uñas, y el botón principal de Uñas) |
| Inicio | 84 | 26 hallazgos, todos de un solo tipo (`<small>` de 16.7 px en celular) → corregido; repetición en celular (14 × 2): **0 hallazgos** |

Otras comprobaciones: `npm run typecheck` (servidor y web), prueba de navegador de la caja (`npm run e2e`: OK). Las 293 pruebas del servidor no se repitieron (no se tocó servidor). Capturas: `scripts/verificacion/fundamentos-visuales.ts <carpeta>`.

## Qué cambia para los negocios actuales (cuando se publique)
* Quien abre NEXORA ve **modo claro** por defecto. Para Barber (barbería Fénix) y los otros 4 productos oscuros eso es un cambio visible; un toque en «Modo oscuro» devuelve el aspecto de siempre y se recuerda en ese equipo.
* Abarrotes y estudio de uñas (productos claros) se ven como hoy; solo se oscurecen colores de texto que no cumplían contraste y se suben los textos pequeños en celular.

## Pendiente (siguientes fases)
Fase 2 menú con color por módulo y **buscador global**; 3 dashboards; 4 caja; 5 inventario; 6 clientes; 7 pantallas por giro; 8 administración; 9 cierre con revisión de los 14 productos en las pantallas reales.
