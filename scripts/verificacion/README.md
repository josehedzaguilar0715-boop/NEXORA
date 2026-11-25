# Scripts de verificación (navegador)

Herramientas que se usaron para verificar NEXORA en navegador real (Playwright, ya instalado en el entorno de la nube).
Necesitan un servidor local con demos: `npm run build`, luego
`NEXORA_DB=/tmp/v.db PORT=3135 npx tsx src/server.ts`, un usuario de soporte (`ADMIN_PASSWORD=superpanel1 npx tsx src/admin-cli.ts soporte Soporte`)
y las demos creadas (`POST /api/admin/demos/{giro}` con el token de soporte, o `demos-walk2.cjs` las crea solo).
**Solo datos de prueba. Nunca apuntarlos a producción.**

| Script | Qué revisa | Uso |
|---|---|---|
| `demos-walk2.cjs` | Crea las 13 demos y abre todas sus pantallas: errores de JS y de API | `B=http://localhost:3135 node scripts/verificacion/demos-walk2.cjs` (también contra `wrangler dev` en el puerto 8799) |
| `giros6.cjs` | Flujos completos de 6 giros (venta, agenda, mesas, carne, merma…) | `SIZE=pc N=11 node scripts/verificacion/giros6.cjs` y `SIZE=cel N=41 …` (N cambia los teléfonos; usar 1–89) |
| `deepwalk.cjs` | Cada pantalla y pestaña, dueño y empleado, celular y computadora: desbordes, botones cortados, errores | `node scripts/verificacion/deepwalk.cjs <carpeta> [giro1,giro2]` (necesita `<carpeta>/demos.txt` con «giro teléfono» por línea) |
| `leaks.py` | Palabras de un giro que aparecen en otro (sobre la salida de un recorrido de texto) | `python3 scripts/verificacion/leaks.py textos.json` |
| `impresion.cjs` | Ticket, corte X y boletos con QR tal como los recibe la impresora (PDF 58 y 80 mm): una hoja, renglones completos, QR | `node scripts/verificacion/impresion.cjs <carpeta>` (necesita poppler: `pdfinfo`, `pdftotext`) |
| `productos14.cjs` | Los 14 productos: identidad al entrar por giro, páginas públicas (reservas, boletos, tarjeta) con la del negocio, y la base en acceso y super panel | `node scripts/verificacion/productos14.cjs <carpeta con demos.txt>` |
| `carga.cjs` | Prueba de carga: varios negocios vendiendo a la vez; peticiones/s, latencias y cuadre de ventas | `B=<url> NEG=5 CONC=20 TOTAL=2000 node scripts/verificacion/carga.cjs` |
| `bench-panel.ts` | Tiempo de las pantallas más consultadas con una base grande (40 negocios, meses de ventas) | `NEG=40 VENTAS=1500 npx tsx scripts/verificacion/bench-panel.ts <archivo.db>` |
| `puestos.ts` | Los tres puestos con dos sucursales, escritorio y celular: alcance, `branchId` e ids manipulados, «Mi día» | `npm run build && npx tsx scripts/verificacion/puestos.ts <carpeta de capturas>` (todo en memoria) |
| `datos.ts` | «Respaldo y exportación de datos» en escritorio y celular: descargar, simular, restaurar, rechazo de archivos ajenos | `npm run build && npx tsx scripts/verificacion/datos.ts <carpeta>` (en memoria) |
| `productos-datos.ts` | Los 13 giros + base: identidad visual y la sección de datos, sin errores ni desbordes | `npm run build && npx tsx scripts/verificacion/productos-datos.ts` (en memoria) |
| `staging-datos.ts` | Prueba funcional contra un servidor real de **staging** (crea 2 negocios de prueba) | `NODE_USE_ENV_PROXY=1 npx tsx scripts/verificacion/staging-datos.ts <url de staging>` |
| `ensayo-respaldo.ts` | Restaura un respaldo real en carpeta aislada, migra en el sitio y compara cada negocio renglón por renglón | `npx tsx scripts/verificacion/ensayo-respaldo.ts <respaldo> <carpeta-nueva>` |
| `comparar-respaldos.ts` | Compara un respaldo anterior y uno posterior: nada perdido ni alterado | `npx tsx scripts/verificacion/comparar-respaldos.ts <antes> <después>` |
| `pixdiff.cjs` | Compara píxel a píxel una pantalla con un CSS anterior | ver comentario del archivo |
| `perf.cjs` | Tiempo de abrir la caja y agregar productos con CPU 4× más lenta, versión anterior contra actual | dos servidores en 3136 (anterior) y 3135 (actual) |
| `menu-simplificado.ts` | Etapa 1: menú diario corto + «Otras herramientas» en los 13 giros (escritorio y celular), subtítulos de Acceso y Mercado | `npm run build && npx tsx scripts/verificacion/menu-simplificado.ts <carpeta>` (en memoria) |
| `escaparates.ts` | Etapas 2 y 4: reservas con portada y servicios con foto, menú digital, lista de precios, catálogo y tienda de boletos; ilustración de respaldo; nada interno | `npm run build && npx tsx scripts/verificacion/escaparates.ts <carpeta>` (en memoria) |
| `plano-mesas.ts` | Etapa 3: plano gráfico de mesas (sin encimarse, acomodar y conservar, lista disponible) | `npm run build && npx tsx scripts/verificacion/plano-mesas.ts <carpeta>` (en memoria) |
| `etapa5.ts` | Etapa 5: tablero de encargos, alerta de limpieza y notas olfativas | `npm run build && npx tsx scripts/verificacion/etapa5.ts <carpeta>` (en memoria) |
| `workerd-evolucion.ts` | Escaparate, carta, plano y primeros pasos en el motor real de Cloudflare (local, no toca producción) | `npx wrangler dev --port 8799 > /tmp/dev.log` y `npx tsx scripts/verificacion/workerd-evolucion.ts http://localhost:8799 /tmp/dev.log` |
| `agenda-calendario.ts` | Agenda con calendario gráfico: capturas (escritorio, tableta, celular, claro/oscuro, día/semana/lista), arrastrar, reprogramar, editar, cancelar, terminar → por cobrar y auditoría | `npm run build && npx tsx scripts/verificacion/agenda-calendario.ts <carpeta>` (en memoria) |
| `workerd-agenda.ts` | Rango de días, foto, editar y reprogramar en el motor real de Cloudflare (local) | `npx wrangler dev --port 8799 > /tmp/dev.log` y `npx tsx scripts/verificacion/workerd-agenda.ts http://localhost:8799 /tmp/dev.log` |
| `copia-real-navegador.ts` | Recorre en navegador todas las pantallas de cada negocio sobre una COPIA de un respaldo real (`SOLO=barberia,unas` filtra por giro) | `npx tsx scripts/verificacion/copia-real-navegador.ts <respaldo-restaurado.db> [claro\|oscuro]` |
| `copia-real-flujos.ts` | Ventas, citas, edición y reprogramación sobre una COPIA de un respaldo real (escribe solo en la copia) | `npx tsx scripts/verificacion/copia-real-flujos.ts <respaldo-restaurado.db>` |
Nota: `giros6.cjs` e `internet-lento.cjs` son anteriores a la Agenda gráfica; sus pasos de Agenda esperan la vista de lista (botón «Lista»).
