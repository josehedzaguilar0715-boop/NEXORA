# 45 · Cierre de pendientes de producción antes de la autorización final

Candidato **congelado**: `70c85d7e91e00221c373e8bd96708d7fe85f7450` (no se modifica; solo se agregan documentos). Sin migraciones, sin funciones nuevas, sin tocar datos reales. Guía detallada de cada paso: doc 41.

| # | Pendiente | Quién | Estado |
|---|---|---|---|
| 1 | `BACKUP_KEY` instalada y cifrado comprobado | Tú instalas; yo verifico el archivo | **Espera tu acción** |
| 2 | Respaldo manual posterior al lanzamiento verificado | Tú lo creas; yo lo verifico | **Espera tu acción** |
| 3 | Comparación del respaldo automático | Yo (hoy 09:35 UTC, tarea programada) | Programada, aún no corre |
| 4 | Checklist de sesiones reales (barbería, Nails, abarrotes) | Cada dueño autorizado | **Espera tu acción** |
| 5 | Producción sin errores | Yo (solo lectura) | Verificación externa lanzada; resultado en el informe final |

## Tus pasos, en orden
**A. Respaldo manual (≈2 min).** Super Panel → Ajustes → Respaldos → «Crear respaldo ahora». Avísame «listo». No lo borres.
**B. BACKUP_KEY (≈10 min, en tu computadora).**
1. `npm run backup:key` → muestra una llave nueva y su huella. Guárdala en dos lugares (gestor de contraseñas + papel). **Nunca me la envíes ni la pegues en un chat.**
2. `npx wrangler secret put BACKUP_KEY --env production` y pega la llave.
3. Super Panel → Ajustes → Respaldos debe decir «🔒 Cifrados. Huella: …» y coincidir con la del paso 1.
4. «Crear respaldo ahora» otra vez: el archivo debe terminar en `.json.gz.enc`. Avísame «listo»: yo verifico en solo lectura que está cifrado (firma `NXE1`, ilegible sin llave).
5. Tú compruebas que se restaura: `NEXORA_BACKUP_KEY=<tu llave> npx tsx scripts/restore.ts respaldo.json.gz.enc nueva.db` en carpeta nueva (debe funcionar; con otra llave o sin ella debe fallar).
**C. Checklist de sesiones reales** (doc 41, Paso D): con cada dueño presente, solo lectura, **sin crear ventas**. Por negocio: iniciar sesión, Inicio, ventas anteriores y totales, Finanzas → Mi dinero (solo «Plan anterior», histórico), productos/existencias, clientes y saldos, permisos del empleado, celular. Si algo falla: no corrijas ni restaures; mándame pantalla y mensaje sin datos privados.

## Lo que haré yo cuando avises
- Descargar los respaldos nuevos (solo lectura), comprobar esquema 48, restauración en base aislada y comparación con el de antes del lanzamiento (`comparar-respaldos.ts`).
- Revisar el resultado de la comparación automática de las 09:35 UTC y agregarlo al doc 40.
- Confirmar con la acción «Verificar despliegue» y la observabilidad de Cloudflare que producción sigue sin errores.
- Entregar el informe final actualizado y pedir **solo** la autorización para publicar `70c85d7`.
