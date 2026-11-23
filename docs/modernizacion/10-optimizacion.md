# Fase 8: optimización y almacenamiento

Fecha: 23 nov 2026. Rama `modernizacion`.

## 1. Lo que descarga la app (medido sobre la compilación)

| Pieza | Tamaño | Comprimido (gzip) | Cuándo se descarga |
|---|---|---|---|
| Código principal | 265 KB | **81 KB** | Al abrir |
| Estilos (con las 13 identidades) | 78 KB | **17 KB** | Al abrir |
| Letras | 22–48 KB cada una | — | Solo la del producto en uso |
| Lector de códigos (cámara) | 435 KB | — | **Solo al escanear** (carga diferida) |
| Cada pantalla | 5–38 KB | — | Al entrar a ella (carga diferida, Fase 1) |

* La primera visita pesa ~100 KB comprimidos más una letra. Después todo queda guardado en el equipo (PWA) y funciona sin internet.
* Las 10 identidades nuevas suman ~9 KB sin comprimir a los estilos, solo variables de color. No agregan imágenes ni letras nuevas.

## 2. Velocidad de la caja

Medido en la Fase 1 con el procesador 4× más lento: abrir la caja 547 ms, agregar un producto 58 ms. Nada de las fases 2 a 7 toca la pantalla de la caja más allá de colores.

## 3. Servidor

* Respuestas de staging: mediana 28 ms, p95 89 ms (Fase 1).
* Las verificaciones nuevas (efectivo disponible, pagos al personal) son consultas por turno o por persona, con índices existentes.
* El límite por IP vive en memoria: no escribe en la base.

## 4. Almacenamiento: qué ocupa la base

Medido con la base de las 13 demos (`dbstat`):

| Tabla | Peso | Comentario |
|---|---|---|
| `audit_log` (+ índices) | el mayor | Altas, accesos y autorizaciones. **No se escribe en cada venta normal**, solo en cancelaciones, descuentos y cambios. |
| `stock_movements` | 2.º | Un renglón por producto vendido o comprado. Es necesario para la existencia. |
| `sale_items`, `sales`, `sale_payments` | 3.º | La venta en sí. |

* Cada venta de 3 renglones ocupa ~2.9 KB. Ver la proyección en `08-seguridad.md` §5.
* **No se recortó nada:** todo lo que pesa es información del negocio o su historial, y la regla es no borrar.

### Opciones para después (requieren autorización)

| Opción | Ahorro | Riesgo |
|---|---|---|
| Archivar en R2 (gratis hasta 10 GB) las ventas de más de 18 meses, como archivo comprimido por negocio y mes; los reportes viejos se leen de ahí | Grande con el tiempo | Bajo si se hace con respaldo y prueba en staging. Requiere desarrollo (3 a 5 días). |
| Purgar sesiones vencidas de más de 90 días | Pequeño | Muy bajo; no son datos del negocio. Aun así, requiere autorización por ser una limpieza en producción. |
| Separar la base por negocio | Quita el tope compartido | Ver `08-seguridad.md` §5 |
