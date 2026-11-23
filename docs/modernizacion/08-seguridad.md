# Fase 4: seguridad, protección de datos y base compartida

Fecha: 23 nov 2026. Rama `modernizacion`. **Producción no se tocó.**

## 1. Resumen

| Tema | Estado | Qué se hizo | Prueba |
|---|---|---|---|
| Límite de intentos (entrar, códigos, registro/SMS, reservas y boletos públicos) | ✅ nuevo | Límite **por IP**, que se suma al bloqueo por cuenta que ya existía (5 intentos → bloqueo temporal). | `test/limite-ip.test.ts` + motor Cloudflare local (429 después de 30 intentos) |
| Respaldos cifrados | ✅ listo, **falta activarlo** en producción (§3) | AES-256-GCM con la llave `BACKUP_KEY`. Sin la llave el archivo no se puede leer. | `test/respaldos.test.ts` + ciclo completo en motor Cloudflare |
| Protección de secretos | ✅ revisado | Las contraseñas y los códigos se guardan con hash. Los secretos `ADMIN_*` y de SMS viven como secretos de Cloudflare. `.dev.vars` no está versionado. Se buscó en todo el repositorio: no hay llaves ni tokens, ni archivos `.env`, `.db` o `.csv`; los teléfonos son solo los ficticios de las demos. | búsqueda de patrones en el repositorio (23 nov) |
| Aislamiento entre negocios | ✅ | ~90 rutas con `:id` probadas con otro negocio (Fase 1). | `test/aislamiento-negocios.test.ts` |
| Permisos | ✅ nuevo | **Barrido automático:** se leen del código todas las rutas que piden permiso o ser dueño (más de 100) y un empleado sin ese permiso recibe 403 en todas. Si mañana se agrega una ruta, entra sola a la prueba. | `test/permisos-barrido.test.ts` |
| Validación de operaciones de dinero e inventario | ✅ nuevo (Fases 2 y 3) | No sale de la caja más efectivo del que hay. Los gastos y abonos se anulan sin borrar nada. Pagos al personal una sola vez. Devoluciones a proveedor solo de lo que queda. | `dia-completo`, `pago-personal`, `devolucion-proveedor` |
| Duplicados en ventas y sincronización | ✅ ya existía | Identificador único por venta, abono, gasto y pago al personal; reenviar no duplica. | `sync.test.ts`, `palapa`, `pago-personal` |
| Desconexión y recuperación | ✅ (Fase 1) | Cola de ventas sin internet. No se puede contar inventario ni cerrar la carne con ventas por enviar. | `scripts/verificacion/internet-lento.cjs` (8/8) |
| Enlaces públicos | ✅ (Fase 1) | Identificador público separado del código de empleados; personal como «Luis G.»; sin direcciones. | `test/enlaces-publicos.test.ts` |
| Registro de operaciones y errores | ✅ ya existía | Bitácora con quién, qué, motivo y quién autorizó. Se agregaron: anulaciones, pagos al personal, devoluciones a proveedor y respaldo cifrado. Los errores 500 quedan en los registros de Cloudflare. | — |
| Base compartida | ⚠️ **decisión del propietario** | Análisis abajo (§5) y monitor de espacio en el super panel. | `respaldos.test.ts` «espacio» + motor Cloudflare |

## 2. Límite por IP

| Grupo | Rutas | Máximo por IP |
|---|---|---|
| Entrar | login de empleado, de dueño y del super panel | 30 cada 10 min |
| Códigos | verificar código de registro, de entrada y de recuperación | 30 cada 10 min |
| SMS | registro y recuperación (cada uno puede mandar un SMS, que cuesta) | 10 por hora |
| Público | reservar, cancelar reserva, comprar boletos | 60 por hora |

* Los límites son amplios a propósito, porque en México muchos celulares salen a internet con la misma IP (redes de Telcel y AT&T).
* Responde «Demasiados intentos desde esta conexión. Espera N minutos» con código 429 y el encabezado `Retry-After`.
* Funciona en la memoria del objeto de Cloudflare: **$0**, sin tablas. Si el objeto se reinicia, los contadores empiezan de cero; esto es aceptable porque el bloqueo por cuenta sí queda guardado en la base.
* Usa la IP que pone Cloudflare. El Worker de entrada la copia siempre en `x-nexora-ip`, sobrescribiendo lo que mande el cliente, así que el cliente no la puede inventar. En el servidor de desarrollo (Node) no hay límite.
* **Probado en staging (Cloudflare real):** de 480 intentos de entrar, **224 pasaron y 256 fueron frenados (429)**.
  * Este entorno de pruebas sale por ~8 IPs que van rotando, y 224 ≈ 30 por IP: justo el límite.
  * Con 32 intentos no se veía porque se repartían entre las IPs.
* **Opcional, decisión del propietario:** una regla de límite de Cloudflare (WAF) frenaría el abuso antes de llegar al Worker. El plan gratis incluye una regla. Es un cambio de configuración de la cuenta, así que requiere autorización.

## 3. Respaldos cifrados: cómo activarlos (requiere autorización, es configuración de producción)

Hoy los respaldos diarios de producción están **comprimidos pero no cifrados**. Contienen teléfonos, ventas y hashes de contraseñas.

1. Generar una llave: `openssl rand -base64 32`.
2. **Guardarla fuera del servidor** (gestor de contraseñas). Sin ella, los respaldos cifrados **no se pueden recuperar**.
3. Guardarla como secreto: `npx wrangler secret put BACKUP_KEY --env production`.
4. Al día siguiente, el respaldo se llamará `nexora-AAAA-MM-DD…json.gz.enc`.
5. Para restaurar: `NEXORA_BACKUP_KEY=<llave> npx tsx scripts/restore.ts <archivo>.enc nueva.db`.

Notas:

* Los respaldos anteriores (sin cifrar) siguen restaurándose igual.
* Probado en el motor de Cloudflare: respaldo → descarga → restauración con la llave (33 ventas y 3 negocios idénticos). Con otra llave se rechaza.
* Corrección hecha de paso: el respaldo ya no incluye tablas internas del motor, y la restauración decide si descomprimir por el contenido y no por el nombre del archivo.

## 4. Lo que queda pendiente de seguridad

| Pendiente | Prioridad | Por qué no se hizo |
|---|---|---|
| Activar `BACKUP_KEY` en producción | Alta | Es configuración de producción: requiere autorización y que el propietario guarde la llave. |
| Regla WAF de Cloudflare | Media | Configuración de la cuenta. |
| Ensayo de «restaurar a producción» | Media | Hoy se restaura a una base nueva (probado). Falta un procedimiento para cargarla en un Durable Object; se ensayaría primero en staging. |
| Super panel con usuario y contraseña sin segundo factor | Media | Agregar código por SMS al entrar; costo por SMS. |
| El aviso de privacidad (`docs/aviso-de-privacidad.md`) tiene el **correo personal** del propietario y el repositorio es público | Baja | Es correcto que tenga un contacto; el propietario decide si usa un correo del negocio. |

## 5. Base compartida: análisis, opciones y costos

**Situación.** Los 3 negocios reales (y los de prueba) viven en **un solo** Durable Object con SQLite.

**Medido en pruebas:** cada venta de 3 renglones ocupa **~2.9 KB**, sumando venta, renglones, pago, movimientos de inventario y bitácora.

| Supuesto | Crecimiento |
|---|---|
| 1 negocio con 150 ventas/día | ~0.45 MB/día ≈ **160 MB al año** |
| 3 negocios así | ~0.5 GB al año |
| 100 negocios | ~16 GB al año |
| 500 negocios | ~80 GB al año |

**Topes de Cloudflare** (página oficial de precios y límites, revisada el 23 nov 2026):

| | Plan gratis | Plan de pago ($5 USD/mes) |
|---|---|---|
| Tamaño máximo de **un** objeto SQLite | **1 GB** | 10 GB |
| Almacenamiento total de la cuenta | 5 GB | 5 GB incluidos, luego $0.20 USD por GB al mes |
| Renglones escritos | 100,000 por día | 50 millones al mes incluidos, luego $1 USD por millón |
| Renglones leídos | millones por día (la documentación da dos cifras distintas) | 25 mil millones al mes incluidos |

**Conclusión:** con la base compartida, el tope de 1 GB llega en **~2 años con 3 negocios**, o en **meses con 10 o más**. Al llegar, **no se pueden guardar ventas** (las lecturas siguen funcionando). Además, el respaldo de un solo archivo en KV tiene un tope de 25 MB comprimido.

**Implementado ya ($0):** monitor en el super panel, en *Espacio de la base*.

* Muestra el tamaño contra el tope y los meses que faltan al ritmo de los últimos 30 días.
* Avisa al 70 % y al 85 %.
* Probado en el motor de Cloudflare.

**Opciones:**

| Opción | Qué es | Costo | Esfuerzo | Cuándo |
|---|---|---|---|---|
| A. Seguir igual con el monitor | Nada más | $0 | — | Sirve para los 3 negocios actuales, unos meses. |
| B. **Un objeto por negocio** + un objeto «directorio» (cuentas, sesiones, super panel) | Cada negocio en su propia base de hasta 1 GB (gratis) o 10 GB (de pago); un problema en un negocio no afecta a otros; respaldo por negocio | Gratis hasta 5 GB de toda la cuenta; después $5 USD/mes + $0.20 por GB | 1 a 2 semanas, con migración probada en staging | **Recomendado antes de pasar de ~10 negocios.** |
| C. Archivar ventas viejas (más de 18 meses) en R2 | Baja el tamaño; los reportes viejos se leen del archivo | R2 da 10 GB gratis | 3 a 5 días | Complemento de B. |
| D. Pasar al plan de pago sin separar | Sube el tope a 10 GB | $5 USD/mes | Ninguno | Solo compra tiempo (~60 negocios-año). |

**Recomendación:** B antes de vender a más de ~10 negocios. Para 100 a 500 negocios hace falta el plan de pago de todos modos: con 500 negocios se escriben ~750,000 renglones al día, más que los 100,000 diarios del plan gratis. **Costo estimado con 500 negocios: ~$5 a $20 USD al mes** en total. Cualquier cambio de plan o gasto requiere tu autorización.

Fuentes: [precios de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing), [límites de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits), [planes de Cloudflare](https://www.cloudflare.com/plans.md).
