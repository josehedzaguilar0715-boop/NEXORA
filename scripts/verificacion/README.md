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
| `pixdiff.cjs` | Compara píxel a píxel una pantalla con un CSS anterior | ver comentario del archivo |
| `perf.cjs` | Tiempo de abrir la caja y agregar productos con CPU 4× más lenta, versión anterior contra actual | dos servidores en 3136 (anterior) y 3135 (actual) |
