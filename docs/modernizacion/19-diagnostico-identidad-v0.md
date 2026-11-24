# 19 · Diagnóstico: identidad visual de v0 (`nexora.zip`) contra NEXORA actual

Fecha: 24 nov 2026. Rama de trabajo: `diseno-v0` (sale de `modernizacion`; **no toca producción ni la base de datos**). Este documento es solo diagnóstico y plan: todavía no se cambió ningún código de la aplicación.

## 1. Qué trae el ZIP (2 archivos, 53 KB)

| Archivo | Contenido |
|---|---|
| `nexora-design-system/index.html` | Guía de estilo: 8 principios, colores semánticos (éxito, error, advertencia, información), 8 acentos por módulo, estados con **color + icono + texto**, jerarquía de botones (≥44 px), tipografía (16 px base), hacer/evitar, y una demo con **selector de giro + buscador de módulos + navegación**. |
| `nexora-dashboards/index.html` | Dashboards de ejemplo para 3 giros (Tienda, Restaurante, Farmacia): encabezado fijo, indicadores (KPIs) con tendencia, gráfica con selector de periodo, operaciones recientes, acciones rápidas, «Requiere tu atención», lo más vendido. |

Es **HTML estático con CSS dentro y JavaScript sin framework**, con datos de ejemplo escritos a mano. No tiene componentes reutilizables, ni rutas, ni conexión a datos.

Tokens del ZIP: fondo claro `#f6f7f9`, tarjeta blanca, texto `#1a1f2b`, texto secundario `#5b6474`, información `#1d4ed8`, éxito `#15803d`, advertencia `#b45309`, error `#c62828`; módulos: ventas azul `#1d4ed8`, inventario violeta `#7c3aed`, clientes verde azulado `#0f766e`, caja verde `#15803d`, reportes naranja `#c2410c`, mesas rosa `#be185d`, cocina ámbar `#b45309`, recetas cian `#0e7490`; radio 12–14 px; botones y campos de 44–48 px; letra base 16 px.

## 2. Cómo está NEXORA hoy (comparación)

| Tema | ZIP (v0) | NEXORA actual | Compatibilidad |
|---|---|---|---|
| Tecnología | HTML + JS suelto | React 18 + Vite + TypeScript, 30+ pantallas, ~8 500 líneas de pantallas | Se **adopta el diseño, no el código** |
| Iconos | Lucide por CDN (`unpkg`) | `lucide-react` ya instalado y usado en el menú | ✅ Mismo juego de iconos. No usar el CDN (rompe el modo sin internet y la política de seguridad) |
| Tipografía | Geist (pero **no la carga**: en el ZIP cae a la del sistema) | Inter variable + una letra de títulos por producto, todas locales (`@fontsource`); base de **20 px** | ✅ Ya es más grande que el ZIP. Geist exigiría una dependencia nueva (gratis, local): decisión pendiente |
| Colores | Tema claro único; 8 acentos por módulo | **13 identidades** en `products.css` (9 claras y 4 oscuras: Barber, Ferretería, Perfumería, Taquería; la base NEXORA es oscura) + 6 tonos por grupo del menú (`--tone-*`) | 🟡 Hay que decidir qué manda (ver §5) |
| Navegación | Lista de módulos con icono de color, **nombres completos** y buscador | Menú lateral por «portales» (Vender, Inventario, Clientes, Dinero, Mi negocio) con panel emergente; en celular, menú desplegable | 🟡 Se mantiene la estructura de portales; se agrega color por módulo y buscador |
| **Buscador** | Filtra módulos por nombre y palabras clave, con mensaje «sin resultados» | **No hay buscador global**; solo búsquedas dentro de algunas pantallas (Caja, Productos, Clientes…) | 🔴 Falta: es la mayor brecha funcional |
| Dashboards | KPIs, tendencia, gráfica, alertas, acciones rápidas | `Inicio.tsx` ya tiene KPIs con comparación, meta del día, gráfica, stock bajo y accesos rápidos por producto; «Mi día» para empleados | 🟢 Reorganizar y agrupar mejor; no rehacer |
| Estados | Color + icono + texto | Mayormente color y texto | 🟡 Agregar icono a insignias de estado |
| Giro | Selector demo de 3 giros (Farmacia, que **no es producto oficial**) | El giro sale del negocio; cada producto oculta lo que no usa (`products/index.ts`: `quick`, `hide`) y `giros` por pantalla | ✅ El mecanismo real ya existe. **No se importa** el selector ni Farmacia/Recetas/Caducidades |
| Responsivo | Una columna en celular; lista lateral desde 720 px | Dos modos: >900 px y ≤900 px; verificado en 1366×900 y 390×844 | 🟡 Falta **tableta** (768–1024 px) como caso propio |
| Accesibilidad | `aria-pressed`, `aria-current`, etiquetas, objetivos ≥44 px | Ya usa `aria-*` en varias partes; botones `big` de 80 px | 🟡 Auditar contraste (AA) en los 14 productos |

**Riesgo bajo de regresión funcional**: casi todo el estilo vive en variables CSS (`styles.css`, `products.css`, `premium.css`); hay ~250 estilos en línea y solo 9 colores fijos en las pantallas. El cambio visual no toca la API, la base de datos, los permisos ni los datos.

## 3. Qué se aprovecha del ZIP

1. **Reglas**: nombres completos en el menú, iconos con texto, un solo botón principal por pantalla, objetivos ≥44 px, estados con color+icono+texto, confirmar lo destructivo, buscador siempre visible.
2. **Acento por módulo** (ventas azul, inventario violeta, clientes verde azulado, caja verde, reportes naranja, mesas rosa, cocina ámbar), aplicado a icono y encabezado de cada pantalla.
3. **Estructura de dashboard**: «Requiere tu atención», acciones rápidas, KPIs de 2×2 en celular y 4 en computadora, selector de periodo.
4. **Buscador de funciones** con palabras clave (sinónimos: «fiado» → Clientes, «corte» → Caja).

## 4. Qué NO se hace

* No se reemplaza la app por las maquetas, ni se importa su JavaScript ni el CDN.
* No se eliminan pantallas, permisos, rutas, datos ni migraciones. Es un cambio solo de presentación y navegación.
* No se agregan módulos que no son de NEXORA (Farmacia, Recetas médicas, Caducidades).
* Ningún cambio en producción hasta autorización.

## 5. Decisiones que necesito del propietario

1. **¿Un tema claro único o respetar el oscuro de 5 productos?** El ZIP pide fondos claros y sin «lujo» innecesario. Hoy Barber, Ferretería, Perfumería, Taquería y la base NEXORA son oscuros. Opciones: (a) todo claro con el acento de cada producto; (b) claro por defecto y **modo oscuro opcional** por usuario (recomendado: se conserva la identidad de cada producto y la facilidad de lectura).
2. **Tipografía**: mantener Inter (ya local) o sumar Geist (dependencia local gratuita). Recomendado: mantener Inter para el cuerpo y sumar un tamaño base mínimo de 18 px en celular.
3. **Color por módulo**: usar los 8 acentos del ZIP **para todos los productos** (mismo color = misma función en cualquier negocio) y dejar el color de marca del producto solo en logo y botón principal. Recomendado.
4. **Nombres de productos**: siguen provisionales (`products/index.ts`); la identidad visual se aplica sin cambiarlos.

## 6. Plan de integración por módulos (rama `diseno-v0`)

| Fase | Alcance | Archivos a adaptar | Verificación |
|---|---|---|---|
| 0. Fundamentos | Tokens de color por módulo (`--m-*`), semánticos, escala tipográfica (base ≥18 px, títulos 28–34), radios, estados con icono, componente de insignia | `web/src/styles.css`, `web/src/premium.css`, `web/src/products/products.css` (13 bloques), `web/src/App.tsx` (`TONE`) | Contraste AA automático por producto; capturas de los 14 |
| 1. Cascarón y navegación | Menú con color por módulo, nombres completos, **buscador global** (nombre + palabras clave, respeta permisos, giro y producto), atajo `/`, barra inferior en celular, vista de tableta | `web/src/App.tsx`, nuevo `web/src/Buscador.tsx`, `web/src/products/index.ts` (palabras clave), `styles.css` | Prueba del buscador (por giro y puesto: nadie encuentra lo que no puede abrir) |
| 2. Dashboards | «Requiere tu atención», acciones rápidas, KPIs 2×2/4, selector de periodo | `screens/Inicio.tsx`, `Finanzas.tsx`, `Reportes.tsx`, `Brand.tsx` | Capturas 3 tamaños; sin cambios en cifras |
| 3. Caja | Encabezado con color, botón principal único, estados con icono | `screens/Caja.tsx` (875 líneas), `Apartados`, `Devoluciones` | Flujo e2e de caja (`test/e2e`) |
| 4. Inventario | Tablas legibles, insignias de stock, acciones | `Productos.tsx`, `Compras`, `CierreDia`, `PrecioDia` | Recorrido `deepwalk` |
| 5. Clientes y lealtad | Fiado con estados visibles | `Clientes.tsx`, `Lealtad.tsx`, `Escanear.tsx` | Recorrido |
| 6. Giros | Agenda, Mesas/Cocina/Pedidos, Taquilla/Acceso, Entradas, Carne, Cotizaciones, Encargos | `Agenda.tsx`, `Mesas.tsx`, `Cocina`, etc. | `giros6.cjs`, `productos14.cjs` |
| 7. Administración | Configurar, Personal, Ajustes, Datos, Importar | `Configurar.tsx`, `Usuarios.tsx`, `DatosNegocio.tsx`, `Ajustes`, `Importar.tsx` | Recorrido y permisos |
| 8. Cierre | Los 14 productos × 3 tamaños (computadora 1366×900, tableta 768×1024, celular 390×844), contraste, informe | scripts de `scripts/verificacion/` (+ tableta) | Informe con capturas; las 293 pruebas siguen pasando |

Cada fase es un commit independiente en `diseno-v0`, con pruebas y capturas; se puede detener o revertir cualquier fase sin afectar las demás.

## 7. Riesgos

* **Identidad por producto**: unificar acentos por módulo cambia el aspecto de cada producto; por eso la decisión §5.1 y §5.3.
* **Contraste** en los 4 productos oscuros y en acentos como el ámbar sobre blanco (el ZIP usa `#b45309` para texto: cumple AA).
* **Tamaño de letra**: subirlo en celular puede desbordar tablas anchas (Caja, Productos, Reportes): se verifica pantalla por pantalla.
* **Rendimiento**: el buscador es local (sin red); no añade dependencias.
* **Costo adicional**: $0 (si se elige Geist, es un paquete gratuito servido desde el mismo Worker).
