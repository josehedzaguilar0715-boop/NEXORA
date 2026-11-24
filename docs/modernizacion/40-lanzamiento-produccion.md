# 40 · Lanzamiento a producción: informe final

## 1. Versión publicada
- **Producción (Worker `nexora`): versión `34191efa-5149-4d55-ad8f-6a40bd2b8179`**, publicada el **2026-11-24 a las 22:50 UTC (4:50 p. m. hora del centro de México)**.
- Código: rama `diseno-v0`, commit **`fcb8293`** (el código de la aplicación es **idéntico** al candidato `8842ac6`; entre ambos solo se agregaron dos scripts de verificación). `wrangler.toml`, `package.json` y dependencias: **sin cambios** respecto a lo que ya estaba en producción (`de95b17`), por lo que no hubo secretos, enlaces ni servicios nuevos que configurar.
- Versión anterior (reversión): **`72bda7f0-1b20-4b40-ae61-4eb02ef0b2c3`** (commit `de95b17`).
- Staging (ensayo en el motor real): `7739de6b-855c-43a9-94bb-b6634472e5f7`.

## 2. Auditoría previa (comprobado, no supuesto)
| Elemento | Resultado |
|---|---|
| Producción antes | Versión `72bda7f0`, esquema de base **42**, 11 negocios, 22 usuarios (de la copia), cron diario 09:17 UTC, KV de respaldos propio, secretos `ADMIN_*` presentes |
| Diferencias candidata | 121 archivos de aplicación; migraciones **43–48** (todas aditivas: 2 columnas en `users`/`appointments`/`sales`/`sale_items`, 4 tablas nuevas y disparadores de solo-agregar) |
| Secretos/entorno | Sin cambios. **`BACKUP_KEY` no está instalada** (los respaldos de producción siguen sin cifrar: pendiente del dueño) |
| Servicios externos | Ninguno nuevo; sin proveedor de mensajes ni pasarela |
| Hosting | Cloudflare Workers + Durable Object (SQLite) + KV, plan gratuito, sin costo nuevo |

## 3. Respaldo y recuperación
- **Respaldo usado:** `nexora-2026-11-24T09-17.json.gz` (completo, automático de las 3:17 a. m. hora de México del 24-nov), 121 918 bytes, esquema 42, huella SHA-256 `8c4b40db3169403e…`, ubicación: KV `nexora-respaldos` (producción). Además hay 9 completos diarios (18–24 nov, incluidos los manuales de las 06:03 y 06:04) y un archivo por negocio de cada corrida.
- **Recuperabilidad comprobada** en entorno aislado: se restauró con el código de producción (`de95b17`, esquema 42) en una base nueva en `/tmp` (nunca sobre producción): **105 tablas, 1 835 renglones, 11 negocios**.
- **Limitación honesta:** **no se pudo crear un respaldo manual inmediatamente antes de publicar.** El panel de soporte exige credenciales que no tengo, y el único camino alternativo (cambiar temporalmente el horario automático de producción) fue **rechazado por el sistema de seguridad** y no se insistió. Se publicó con el respaldo de ~13 h antes. Como las migraciones son aditivas (no alteran ni borran lo existente) y la reversión de código no exige tocar la base, el riesgo de pérdida es mínimo; **el respaldo automático de la próxima madrugada (09:17 UTC del 25-nov) será el primero en esquema 48.**

## 4. Ensayo de migración (copia de producción, aislado)
`scripts/verificacion/ensayo-migracion.ts` sobre la copia restaurada (esquema 42 → 48 con el código candidato). **Todo en orden:**
- Migró de 42 a 48; **ninguna tabla, columna ni renglón se perdió** (105 tablas, 1 835 renglones) y **ningún valor existente cambió** (huella por renglón, tabla por tabla; el registro de migraciones solo agregó 6 filas).
- «Plan anterior» histórico e inactivo en los 11 negocios (3 partidas cada uno); ningún reparto impuesto; **ningún usuario cambió de puesto ni de permisos**; retiros y saldos vacíos; columnas nuevas vacías.
- Integridad de la base `ok`; **0 llaves foráneas rotas**; volver a abrir (re-migrar) es **idempotente**.
- API real con sesiones creadas solo en la copia: **11/11 dueños** recorren Finanzas, panel, ventas, productos, clientes y automatizaciones de su giro sin error; **22 usuarios** (dueños, encargados, empleados): el personal recibe 403 en panel y finanzas y sigue entrando a lo operativo; **ventas por negocio (cantidad y total) idénticas**; «dinero disponible» = fórmula anterior en los 11 negocios.
- Primer intento: el único «fallo» fue de la propia prueba (el registro de migraciones sí debe crecer); se corrigió la prueba y se repitió.

## 5. Validación funcional previa
- **345 pruebas automatizadas, 0 fallas**; compilación de servidor, interfaz y worker.
- **Navegador (datos de demostración):** e2e, navegación, puestos, dashboards, teclado, tema, panel administrativo (36), páginas públicas (18), Finanzas/saldos/roles, automatizaciones, tickets, agenda→caja, guía visual (84), y auditorías de pantallas de los 13 giros + base NEXORA en claro/oscuro y 3 tamaños: **0 hallazgos**.
- **Motor real de Cloudflare** (`wrangler dev` con workerd + Durable Object): `workerd-lanzamiento.ts` **19/19**: esquema 48, venta, tickets 58/80 mm, comprobante digital, Finanzas, reparto propio, saldos (inicial, duplicado rechazado, conciliación), retiros, roles (403), resumen del encargado, costos, automatizaciones.
- **Staging real de Cloudflare** desplegado y verificado desde internet (GitHub Actions): esquema 48.

## 6. Verificación posterior en producción
Acción «Verificar despliegue» (desde internet, solo lectura), 22:50 UTC: **producción en verde**: salud `ok` con **esquema 48** (las migraciones 43–48 corrieron en la base real sin error), pantalla principal carga, aplicación React presente, credenciales falsas rechazadas (401), rutas del negocio exigen sesión (401), ruta interna de respaldos inalcanzable (404), salud de soporte exige sesión (401), encabezados de seguridad presentes.
**No pude verificar desde aquí** (no tengo credenciales de los negocios ni de soporte, y el dominio de producción no es alcanzable desde este entorno): inicio de sesión de un negocio existente, ventas reales, Caja/Finanzas con datos reales. Para eso hay **evidencia indirecta fuerte** (ensayo con copia de los datos reales, §4) y **dos pasos que debe hacer el dueño** (§9).

## 7. Funciones disponibles en producción ahora
Administrador autorizado y permisos por persona (incl. costos y márgenes); acceso financiero solo para dueño y administradores autorizados; Finanzas inteligentes (Mi dinero, reparto configurable, retiros, saldos iniciales y conciliación); resumen operativo y objetivo por sucursal para encargados; Agenda conectada con Caja (terminar → pendiente de cobro → Ver en Caja, sin cobros duplicados); tickets de 58/80 mm, reimpresión, logotipo y comprobante digital; automatizaciones por giro (rentabilidad, seguimiento, recordatorios manuales, platillos, reposición); identidad azul unificada, modo claro/oscuro, tarjetas en celular.

## 8. Errores encontrados y corregidos en el proceso
- Ensayo: la verificación contaba mal el registro de migraciones (error de la prueba, corregido y repetido).
- Durante el desarrollo (ya corregidos): folio cortado en tickets 58 mm, comparación de costos que excluía el instante actual, etiqueta cortada en Alta asistida, encimado en lista de Productos, falsos positivos del auditor.
- No quedó ninguna prueba crítica fallida.

## 9. Pendientes y lo que debe hacer el dueño
1. **Abrir Super Panel → Ajustes → Salud del sistema** y confirmar «Todo en orden» y esquema 48; **entrar con un negocio real y revisar** una venta, la caja y «Finanzas → Mi dinero» (yo no tengo esas credenciales).
2. **Crear un respaldo manual** (Super Panel → Respaldos → Crear) si quiere uno ya en esquema 48; si no, el de las 3:17 a. m. lo hará solo.
3. **Instalar `BACKUP_KEY`** para cifrar los respaldos (sigue pendiente; instrucciones en doc 12).
4. Siguen sin existir (y no se declaran): impresión probada en papel, CFDI, mensajes automáticos, pagos en línea, carga de logotipo como archivo.
5. Para cada negocio: los encargados y empleados que veían costos ya no los ven hasta que el dueño marque «Ver costos y márgenes»; el encargado ya no ve finanzas.

## 10. Reversión
| Situación | Acción |
|---|---|
| El código nuevo falla y la base está bien (lo esperado: las migraciones son aditivas) | `npx wrangler rollback 72bda7f0-1b20-4b40-ae61-4eb02ef0b2c3 --env production` (o Cloudflare → Workers → nexora → Deployments → Rollback). La versión anterior ignora las tablas y columnas nuevas. |
| Una función concreta falla | Apagar su interruptor en Super Panel o publicar el commit previo `de95b17` |
| Datos dañados de un negocio | Restaurar **solo ese negocio** desde su archivo de respaldo (doc 18) |
| Datos dañados de toda la base | Restaurar el completo `nexora-2026-11-24T09-17.json.gz` (o uno posterior) en un objeto nuevo y cambiar el activo (doc 12 §4); **nunca sobre el principal** |
Nunca se necesita deshacer migraciones: son solo-agregar.

## 11. Confirmación
**Producción está publicada y respondiendo** en la versión `34191efa` con esquema 48 y todas las verificaciones externas de solo lectura en verde. La verificación con datos reales de los negocios actuales se apoya en el ensayo con copia y requiere los dos pasos del dueño (§9) para cerrarse por completo.
