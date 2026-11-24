# 17 · Actualizaciones, monitoreo y reversión

Fecha: 24 nov 2026. Todo lo descrito usa la infraestructura actual (Cloudflare gratis): **costo adicional $0**.

## 1. Cómo se actualiza hoy (y qué se puede prometer)

| Pieza | Realidad |
|---|---|
| Código | Un Worker que sirve pantallas y API; la base es **un solo Durable Object** con SQLite. |
| Al publicar | Cloudflare cambia el Worker y reinicia el objeto: **hay un corte de uno o pocos segundos** en el que una petición puede fallar. No es «cero interrupciones» y no se promete. |
| Por qué no hay despliegue gradual real | Hay un solo objeto de datos; dos versiones no pueden usar la misma base a la vez de forma segura. Un porcentaje de tráfico en cada versión (despliegues graduales de Cloudflare) no ofrece garantías con una base única y migraciones. |
| Ventana recomendada | Madrugada (después del respaldo de las 3:17 a. m. hora de México) o cuando no haya cajas abiertas. |
| Alternativa más económica | La actual: ventana de baja actividad + respaldo reciente + verificación automática + reversión de un comando. Pasar a «sin corte» exigiría separar la base por negocio (`14-estrategia-de-crecimiento.md`), que es un proyecto aparte y de pago. |
| La app sigue operando durante el corte | Las ventas se guardan en la cola del dispositivo (`outbox`) y se envían al volver la conexión, con identificador único: reenviar no duplica. |

## 2. Procedimiento de publicación (en orden)

1. **Respaldo reciente**: el diario de las 3:17 a. m. (o `Super panel → Ajustes → Respaldos → Crear`). Nunca publicar sin uno de menos de 24 h.
2. **Verificaciones automáticas antes de publicar**: `npm run check` (tipos, todas las pruebas, compilación y navegador). Si algo falla, no se publica.
3. **Staging**: `npm run deploy` (Worker `nexora-staging`) y `bash scripts/verificar-despliegue.sh https://nexora-staging.…workers.dev` (solo lectura: salud con versión de esquema, pantalla, rechazo de credenciales falsas, rutas protegidas, ruta interna cerrada, encabezados). Más las pruebas funcionales del cambio en staging.
4. **Producción**: `npm run deploy:prod` y, de inmediato, `scripts/verificar-despliegue.sh` contra producción. Desde el entorno de desarrollo el dominio de producción no es alcanzable: se ejecuta desde GitHub (**Actions → Verificar despliegue**, que también corre sola cada día a las 15:00 UTC desde la rama principal).
5. **Después**: revisar *Super panel → Ajustes → Salud del sistema* (debe decir «Todo en orden») y que la versión de esquema coincida.

## 3. Migraciones compatibles entre versiones

* Solo **se agregan** (tablas o columnas nuevas, nunca renombrar ni borrar) al final de `MIGRATIONS` en `src/db.ts`. Cada una corre en su transacción al arrancar.
* Por eso **la versión anterior del código sigue funcionando sobre la base nueva** (ignora lo que no conoce): la reversión de código no exige deshacer la base.
* Ensayos hechos: `test/migracion-41.test.ts` (base en versión 40 con datos → 41 y 42) y `scripts/verificacion/ensayo-respaldo.ts` sobre una **copia de los datos reales de producción** (ver `12-respaldos-y-recuperacion.md` §6).
* Un fallo de migración deja la petición en error 500, **queda anotado** en el registro de errores si la base responde, y la verificación de esquema (`/api/health` → `schema`) lo delata: el esquema de la base debe ser igual al del código.

## 4. Interruptores de funciones (feature flags)

* Tabla `feature_flags` (migración 42), administrada en el super panel (`GET/PUT /admin/flags/:key`). Sin registro, la función está encendida.
* Interruptor actual: **`importar_respaldo`** (restaurar desde archivo o respaldo). Apagarlo no exige publicar de nuevo y **nunca apaga la exportación** (el dueño siempre puede llevarse sus datos).
* Regla para funciones nuevas: nacen detrás de un interruptor, se prueban en staging, se encienden para un negocio (`businessIds`) y luego para todos.

## 5. Reversión

| Situación | Qué hacer |
|---|---|
| El código nuevo falla, la base está bien | `git checkout <commit estable> && npm run deploy:prod` (o *Rollback* en el panel de Cloudflare: Workers → nexora → Deployments). Versión estable previa: **`c67e5fc0`** (commit `10198c5`); antes, `2c16921e` (`efb75ff`). Las columnas/tablas nuevas quedan sin uso y no estorban. |
| Una función concreta falla | Apagar su interruptor (§4). Sin publicar. |
| Datos dañados o borrados de un negocio | Restaurar **solo ese negocio** desde su respaldo o archivo: simulación → confirmación (`18-exportacion-y-restauracion.md`). No toca a otros negocios ni sobrescribe lo nuevo. |
| Datos dañados de toda la base | Restaurar el respaldo completo en un objeto nuevo (`DB_OBJECT`, `12-respaldos-y-recuperacion.md` §4) y cambiar el objeto activo; nunca sobre el principal. |
| Una restauración falló | No deja nada a medias: es todo o nada (una transacción). Si algo se rechaza, no se modificó ningún dato. |

## 6. Monitoreo (qué se detecta solo)

`Super panel → Ajustes → Salud del sistema` (`GET /admin/salud`) resume, con semáforo:

* **Migraciones**: versión de la base contra la del código.
* **Respaldos**: último completo (fecha, resultado, cifrado), respaldos por negocio fallidos y negocios sin respaldo en 36 h.
* **Errores**: errores internos (500) y de respaldos de las últimas 24 h, agrupados, con número de repeticiones.
* **Ventas y movimientos**: ventas cuyo total no coincide con sus pagos, cajas abiertas más de 36 h.
* **Sincronización**: conflictos de los últimos 7 días.
* **Espacio**: tamaño de la base contra el tope gratis.

**Alertas**: un error crítico nuevo (o que se repite pasada una hora) manda un correo a los administradores del super panel si hay proveedor de correo (`RESEND_API_KEY`); sin proveedor, queda visible en el panel y en los registros de Cloudflare (`observability` activada). **Privacidad**: solo se guarda ruta normalizada, tipo, mensaje corto sin correos ni números largos y conteo; nunca cuerpos de peticiones, contraseñas, tokens ni nombres (probado).

**Verificación externa**: la acción *Verificar despliegue* de GitHub revisa staging y producción cada día desde internet; si falla, GitHub avisa por correo al dueño del repositorio.

## 7. Límites conocidos

* Corte de segundos al publicar (§1).
* Un solo objeto de datos: tope de 1 GB en el plan gratis (`08-seguridad.md` §5) y el respaldo diario de todos los negocios corre en una sola petición. Medido: ~12 ms por negocio de demostración (43 KB); a cientos de negocios sigue holgado, a miles habrá que repartir el trabajo.
* Las alertas por correo requieren configurar un proveedor de correo (el plan gratis de Resend alcanza).
* Los respaldos de producción **no están cifrados** hasta que el propietario instale `BACKUP_KEY` (`12-respaldos-y-recuperacion.md` §2). Esa llave no la genera ni la ve nadie más.
* El panel de salud no ve fallos que ocurren antes de llegar al servidor (red, DNS): para eso está la verificación externa de GitHub.
