# 36 · Protocolo de prueba de impresión térmica (tickets 58 mm y 80 mm)

**Estado:** no hay impresora térmica disponible en este entorno (ni equipo conectado). **No se verificó nada en papel.** Lo que sí está probado: el contenido que se manda a imprimir y los anchos de columna (32 y 48), con impresión interceptada (`scripts/verificacion/ticket.ts`, `test/ticket-formatos.test.ts`). Este protocolo es para que lo ejecute quien tenga el equipo.

## Equipo a probar (mínimo)
1 impresora de 58 mm y 1 de 80 mm (USB o Bluetooth), con la computadora/teléfono real del negocio y el navegador que usará (Chrome recomendado). Anota marca, modelo, controlador y sistema.

## Preparación (una vez por equipo)
1. Instalar la impresora como impresora del sistema; imprimir la página de prueba del fabricante.
2. En el diálogo de impresión del navegador: papel = el del rollo (58 o 80 mm) o «Continuo», **márgenes: ninguno**, **escala 100 %**, **sin encabezados ni pies de página**.
3. En NEXORA: Caja → ticket → «Papel: 58 mm» u «80 mm» según el rollo.

## Casos (marca ✔/✘ y adjunta foto del ticket)
| # | Caso | Cómo | Debe verse |
|---|---|---|---|
| 1 | Venta simple | 2 productos, efectivo con cambio | Nombre, folio de 6 dígitos, fecha y hora, renglones, TOTAL, pago, recibido, cambio, atendió, «No es una factura (CFDI)» |
| 2 | Acentos y eñes | Producto «Piña colada ñoño áéíóú» | Sin caracteres raros ni cuadros |
| 3 | Nombre largo | Producto de 60 caracteres | Pasa a 2 líneas, el importe sigue alineado a la derecha, nada recortado |
| 4 | Ancho completo | 80 mm: líneas hasta 48 columnas; 58 mm: hasta 32 | Sin cortes de línea inesperados |
| 5 | Descuento y pago mixto | Descuento + efectivo y tarjeta | Subtotal, descuento y cada forma de pago |
| 6 | Logotipo | Configurar un logo en Ajustes | Aparece arriba, nítido y centrado; no deforma el ticket |
| 7 | Reimpresión | «Ventas del turno» → Reimprimir | Marca «REIMPRESIÓN» |
| 8 | Venta cancelada | Cancelar y reimprimir | Marca «CANCELADO» |
| 9 | Varias sucursales | Negocio con 2 sucursales | Línea «Sucursal …» |
| 10 | Corte de caja | Imprimir corte X y Z | Legible, sin cortar columnas |
| 11 | Boletos con QR (turístico/baños) | Imprimir boletos | QR escaneable con el celular |
| 12 | Corte de papel | Ticket largo (20 renglones) | La impresora corta al final; no queda un ticket enorme en blanco |

## Criterio de aprobación
Todos los casos ✔ en al menos un modelo de 58 mm y uno de 80 mm. Cualquier ✘ se registra como defecto con foto, modelo y pasos.

## Limitaciones conocidas (antes de probar)
- Se imprime con el diálogo del navegador (texto monoespaciado), **no** con comandos ESC/POS: no hay corte automático garantizado, ni apertura de cajón, ni control fino del tamaño de letra. Si el negocio los necesita, es una mejora aparte (impresión directa por Bluetooth/USB con un puente local o una app).
- El logotipo se imprime tal cual lo entrega la imagen (en escala de grises); logos muy claros o muy detallados se ven mal en térmica.
- Los acentos dependen de la codificación del navegador, no de la impresora (porque se imprime como página, normalmente sin problema).

## Hoja de resultados (copiar)
Fecha · Persona · Equipo (marca/modelo/OS/navegador) · Papel · Casos ✔/✘ · Fotos · Defectos · Decisión (aprobado / requiere ajuste).
