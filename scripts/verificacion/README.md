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
