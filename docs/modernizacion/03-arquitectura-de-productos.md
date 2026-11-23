# NEXORA — Arquitectura de productos

Fecha: 23 nov 2026 · Rama `modernizacion`.
Decisión aprobada: **misma estructura profesional, identidad visual completamente diferente por producto.**

## 1. Modelo

```
NEXORA (empresa matriz)
├── Núcleo común (no cambia por producto)
│   servidor y base · acceso y permisos · caja y cortes · inventario · clientes · finanzas · avisos · respaldos
├── Componentes reutilizables (misma forma, toman la identidad del producto por tokens)
│   tarjetas de indicadores · tablas · paneles laterales · ventanas (Dialog) · gráficas · menú por portales · avisos
└── Productos (capa delgada, uno por giro)
    ├── NEXORA Barber   (barbería)        identidad «Navaja y latón»
    ├── NEXORA Nails    (estudio de uñas) identidad «Porcelana»
    ├── NEXORA Tienda   (abarrotes)       identidad «Mostrador»
    └── NEXORA base     (los otros 10 giros, identidad de siempre, hasta que se investigue cada mercado)
```

**Los nombres comerciales son provisionales** (`web/src/products/index.ts`, campo `name`). Decisión pendiente del propietario.

## 2. Qué define un producto (`web/src/products/index.ts`)

| Campo | Para qué | Barber | Nails | Tienda |
|---|---|---|---|---|
| `name`, `short`, `tagline` | Marca que ve el negocio | NEXORA **Barber** | NEXORA *Nails* | NEXORA **Tienda** |
| `giros` | Qué negocios lo usan | barbería | uñas | abarrotes |
| `quick` | Herramientas que van primero en Inicio | Agenda, Caja, Clientes, Comisiones, Ventas | Agenda, Caja, Clientas, Comisiones, Productos | Caja, Productos, Compras, Clientes y fiado, Apartados |
| `hide` | Herramientas que ese negocio no usa (aunque el permiso exista) | Cierre del día, Apartados | Cierre del día, Apartados | — |
| `home` | Bloque principal del Inicio | Agenda de hoy | Agenda de hoy | Caja y surtido (panel actual) |
| `themeColor` | Barra del navegador en celular | carbón | porcelana | papel |

La visibilidad final de cada pantalla = **permiso** (quién) ∩ **giro** (qué negocio) ∩ **módulo** (qué contrató) ∩ **producto** (qué le sirve). Las cuatro capas ya existían salvo la última, que se agregó sin tocar las otras.

## 3. Identidades (`web/src/products/products.css`)

Cada identidad redefine **todos** los tokens (no solo colores): fondo, superficies, tinta, acento, estados, líneas, letra de títulos, radios, sombras, vidrio, gráficas, íconos por sección y logo.

| | Barber · «Navaja y latón» | Nails · «Porcelana» | Tienda · «Mostrador» |
|---|---|---|---|
| Modo | Oscuro cálido | Claro | Claro |
| Concepto | Herramienta de precisión: cuero, madera y latón | Salón de revista: luz, porcelana, rosa empolvado | Mostrador de barrio: verde de tienda y amarillo de etiqueta de precio |
| Títulos | Fraunces (serif editorial con peso) | Instrument Serif (serif fino, cursiva en la marca) | Bricolage Grotesque gruesa |
| Texto | Inter | Inter | Inter |
| Forma | Esquinas casi rectas (12 px), líneas finas | Muy redondeado (24 px), sombras suaves rosadas | Firme (14 px), alto contraste, botones gruesos |
| Acento único | Latón `#d1a954` | Rosa `#b0436e` | Verde `#12743f` (+ amarillo solo en gráficas y alertas) |
| Vidrio | Menú y barra oscura translúcida | Menú y barra blanca translúcida | Menú y barra blanca, menos desenfoque |

**Reglas que garantizan que la apariencia no frene la caja:**
* Sin imágenes en el diseño; letras incluidas en la app (≈20 KB por letra, solo se descarga la que usa el producto).
* El vidrio (`backdrop-filter`) solo en menú y barras fijas, nunca en la caja ni en listas largas; se apaga con `prefers-reduced-transparency`.
* Animaciones cortas (≤ 0.3 s) y se apagan con `prefers-reduced-motion`.
* Medido: el cambio de identidad es solo CSS (variables); la primera carga sigue en ~79 KB comprimidos de código.

## 4. Base técnica que lo hizo posible (sin cambiar el aspecto actual)

1. **Tokens en vez de colores fijos:** ~80 colores escritos a mano en `styles.css` pasaron a variables (`--hi`, `--on-primary`, `--line-strong`, `--glass`, `--chart-*`, `--tone-*`, `--logo-*`…). **Verificado:** comparación píxel a píxel de Inicio, Caja, Productos y Reportes antes/después con la identidad base: **0 píxeles distintos**.
2. **Gráficas, íconos y logo** leen tokens, así cambian con el producto.
3. **Vocabulario por giro** (`web/src/giros.ts`, sesión anterior) y **productos** (`web/src/products/`) separados: el primero decide *cómo se llaman las cosas*, el segundo *cómo se ve y qué va primero*.

## 5. Qué reutilizar y qué especializar

| Componente | Decisión | Por qué |
|---|---|---|
| Caja (cobro, carrito, cambio, cortes) | **Reutilizar** tal cual | Es lo más probado (e2e) y lo más sensible a la velocidad |
| Tarjetas de indicadores, tablas, paneles, ventanas, avisos | **Reutilizar**, toman la identidad por tokens | Misma estructura profesional |
| Inicio | **Especializar por producto** (`home`) | Barbería y uñas viven de la agenda; tienda de la caja y el surtido |
| Agenda | Reutilizar entre Barber y Nails; especializar textos (barbero/técnica, secado en uñas) | Ya distingue tiempos de secado y técnicas |
| Inventario | Reutilizar; especializar vistas (Tienda: granel, paquetes, caducidad; Barber/Nails: producto de reventa y de uso) | |
| Menú lateral | Reutilizar; orden y herramientas por producto | |

## 6. Siguientes pasos sugeridos (no hechos)

**Barber**
* Vista de **sillas/barberos en vivo** (quién atiende, quién está libre, siguiente cita) para pantalla en mostrador.
* Ficha del cliente con su corte habitual y foto opcional (requiere almacenamiento de imágenes: decidir costo).

**Nails**
* Agenda que muestre el **tiempo de secado** como bloque visual distinto.
* Catálogo de diseños con precio por técnica.

**Tienda**
* Caja **modo mostrador**: botones grandes de lo más vendido, teclado numérico y lector en primer plano; probarlo con la dueña antes de cambiar nada.
* Pedido sugerido por proveedor directo por WhatsApp (ya existe el texto; falta el flujo en un toque).

**Los otros 10 giros**: investigación de mercado antes de darles producto propio (orden sugerido por tamaño de mercado en México: taquerías/comedores, ferreterías, papelerías, verdulerías).

## 7. Decisiones pendientes del propietario

1. Nombres comerciales definitivos (hoy: NEXORA Barber, Nails, Tienda).
2. ¿El estudio de uñas quiere modo claro? (es la identidad más distinta; si prefieren oscuro, se ajusta en un bloque de CSS).
3. Dominio(s): uno para todo NEXORA o uno por producto (ver `02-enlaces-publicos.md`).
