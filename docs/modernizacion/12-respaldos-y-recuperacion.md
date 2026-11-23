# Respaldos cifrados y recuperación

Fecha: 23 nov 2026. Rama `modernizacion`. **Nada de esto se ha activado en producción.**

## 1. Cómo funcionan hoy los respaldos

* Cada noche a las 3:17 a. m. (hora de México), el cron del Worker respalda **toda la base**: todas las tablas, comprimidas.
* Se guardan 30 días en Cloudflare KV. Si hay correo configurado, también se envían al correo del super panel.
* **Producción hoy:** los respaldos están **comprimidos pero no cifrados** (`nexora-AAAA-MM-DD….json.gz`).
* **Con `BACKUP_KEY`:** se cifran con AES-256-GCM (`….json.gz.enc`). Sin la llave, el archivo no se puede leer.

## 2. Activar el cifrado (lo hace el propietario, con su autorización)

**La llave nunca debe pasar por un chat, un correo, el repositorio ni un documento compartido.**

1. **Generar la llave en tu computadora**, con el proyecto instalado:

   ```bash
   npm run backup:key
   ```

   Muestra una llave nueva y su **huella**, por ejemplo `3E9B-CA92-6515`. El script no la guarda en ningún lado.

   Alternativa sin el proyecto: `openssl rand -base64 32`.

2. **Guardarla en dos lugares distintos**: tu gestor de contraseñas y una copia en papel en un lugar seguro. **Si se pierde, los respaldos cifrados no se pueden recuperar.**

3. **Instalarla como secreto** (desde tu computadora, con acceso a la cuenta de Cloudflare):

   ```bash
   npx wrangler secret put BACKUP_KEY --env production
   ```

   Pega la llave cuando la pida. Esto **no cambia el código ni los datos**. Desde el siguiente respaldo, los archivos salen cifrados.

4. **Comprobar:**
   * *Super panel → Ajustes → Respaldos* muestra «🔒 Cifrados. Huella de la llave activa: XXXX-XXXX-XXXX».
   * En tu computadora, `npm run backup:key -- --huella` te pide la llave guardada (oculta) y muestra su huella. **Las dos huellas deben coincidir.** La huella no es secreta: identifica la llave sin revelarla.

5. **Ensayo de recuperación**, a la semana: descargar un respaldo cifrado y restaurarlo en local (§4.A) con la llave guardada.

**Requisito:** la versión de la rama `modernizacion` debe estar publicada. La versión actual de producción no tiene cifrado.

### Cambiar la llave

* Generar una llave nueva y ponerla con `wrangler secret put`. Los respaldos nuevos usan la nueva.
* **Conservar la llave anterior al menos 30 días**: los respaldos viejos siguen cifrados con ella.

## 3. Qué se probó (23 nov 2026)

| Prueba | Dónde | Resultado |
|---|---|---|
| Respaldo cifrado → no se lee sin la llave ni con otra llave → se lee con la llave correcta | Automática (`test/respaldos.test.ts`) | ✅ |
| Restaurar en una base nueva: mismas filas en negocios, usuarios, productos, lotes, ventas, pagos, inventario, turnos y bitácora, y la **misma existencia** | Automática | ✅ |
| **Restaurar sobre una base con negocios: se rechaza y no se toca nada** | Automática y motor de Cloudflare | ✅ |
| **Ensayo completo en el motor de Cloudflare (workerd):** objeto A con 5 negocios de prueba → respaldo cifrado → descarga → objeto B vacío → restaurar | workerd local | ✅ **98 tablas, 503 renglones, 0 diferencias**. El dueño entra a B con su contraseña de siempre y ve las mismas ventas. |
| Restaurar con el script local (`npm run restore`), cifrado y sin cifrar | Automática y workerd | ✅ |
| Respaldo y restauración de los **datos reales** de producción | — | **No ejecutado**: no se abren datos reales sin autorización. Se recomienda como ensayo con el propietario (§4.A). |

**Error encontrado y corregido en el ensayo.** El objeto nuevo crea su usuario de soporte al arrancar. El respaldo traía uno con el mismo nombre y lo reemplazaba, y la sesión abierta en el objeto nuevo quedaba sin dueño. Por eso la restauración se rechazaba completa: «referencias rotas», sin cargar nada.

Ahora esas sesiones huérfanas del objeto vacío se quitan y la carga termina bien. Hay que volver a entrar al super panel después de restaurar. Hay una prueba que falla sin la corrección.

## 4. Procedimientos de recuperación

### A. Revisar o recuperar información en una computadora (sin tocar el servidor)

1. Super panel → Respaldos → **Descargar** el del día que necesites.
2. En la computadora, con el proyecto instalado:

   ```bash
   npm run restore -- nexora-2026-11-23T09-17.json.gz nueva.db
   # cifrado:
   NEXORA_BACKUP_KEY=<llave> npm run restore -- nexora-2026-11-23T09-17.json.gz.enc nueva.db
   ```

   Siempre crea una base **nueva**: nunca sobrescribe.
3. Abrir con `NEXORA_DB=nueva.db npm start` y revisar en `http://localhost:3000`.

### B. Pérdida total de la base en Cloudflare (desastre)

Para cuando la base del Worker se dañó o se perdió. **Requiere autorización del propietario.**

1. Descargar el último respaldo bueno (super panel o correo). Si el super panel no abre: Cloudflare → KV → espacio `BACKUPS` del Worker → descargar el archivo.
2. Apuntar el Worker a un objeto **nuevo y vacío**, sin borrar el viejo:

   ```toml
   # wrangler.toml, sección [env.production]
   [env.production.vars]
   DB_OBJECT = "recuperacion-2026-11-23"
   ```

   Publicar con `npm run deploy:prod`. El objeto viejo **no se borra**; queda intacto por si se necesita.
3. Entrar al super panel (el usuario de soporte se crea solo con los secretos `ADMIN_*`) y restaurar:

   ```bash
   curl -X POST https://<dominio>/api/admin/restore \
     -H "authorization: Bearer <token del super panel>" \
     -H "content-type: application/octet-stream" \
     --data-binary @nexora-….json.gz.enc
   ```

   Si el objeto no está vacío, se rechaza. Si el respaldo está cifrado, el Worker usa su `BACKUP_KEY`.
4. Volver a entrar al super panel; revisar negocios, ventas del día y existencias de los 3 negocios.
5. **Se pierde lo vendido después del último respaldo** (hasta un día). Las ventas que estaban en la cola de algún equipo sin internet se envían solas al reconectar, porque llevan id único.

### C. Volver a una versión anterior del código (sin tocar datos)

Ver la sección de reversión del informe final. Publicar el commit anterior **no borra datos**: las tablas y columnas nuevas quedan sin uso.

## 5. Límites conocidos

* Un respaldo es **un solo archivo** en KV (tope de 25 MB por valor). Hoy pesa ~120 KB. El monitor de espacio y la separación por negocio (`13-estrategia-de-crecimiento.md`) lo resuelven antes de llegar al tope.
* La restauración por el super panel acepta archivos de hasta 50 MB. Uno mayor se restaura con el script local.
