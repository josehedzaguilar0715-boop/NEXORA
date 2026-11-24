# NEXORA — Documento de continuidad (para la siguiente persona o IA)

Última actualización: 23 nov 2026. Léelo completo antes de cambiar algo. No borres documentación anterior (`README.md`, `NEXORA_SPEC.md`, `docs/`).

## 0. Reglas que no se negocian

* **Producción tiene 3 negocios reales** (barbería Fénix, un estudio de uñas, unos abarrotes). Nunca: borrar o reiniciar la base, migraciones destructivas, usar datos reales para pruebas, cambiar credenciales, dominios o configuración de producción.
* **Publicar en producción requiere autorización explícita del propietario en ese momento.** Staging y pruebas no.
* Migraciones: **solo agregar** (columnas, tablas, índices) al final de `MIGRATIONS` en `src/db.ts`. Nunca editar una migración ya publicada.
* Antes de publicar: `npm run check` + recorrido en motor Cloudflare + verificar respaldo del día (ver §6).

## 1. Estado de las ramas y versiones

| Qué | Dónde |
|---|---|
| Rama de trabajo de esta etapa | **`modernizacion`** (sale de `claude/new-session-pqpyhl` en `efb75ff`) |
| Código en producción | commit `efb75ff` (Cloudflare versión `2c16921e`, Worker `nexora`) |
| Staging | rama `modernizacion` en `53a192a`, Worker `nexora-staging`, versión `20695830` (23 nov, etapa 2) |
| Producción con lo de esta etapa | **NO publicado**. Pendiente de autorización |

## 2. Arquitectura encontrada (resumen; detalle en `01-auditoria.md`)

Cloudflare Worker (pantallas + entrada) → un Durable Object con SQLite para todos los negocios (Hono, ~40 módulos de rutas) → KV para respaldos diarios. React 18 + Vite en `web/`, PWA con funcionamiento sin internet. Mismo código corre en Node para desarrollo (`npm run dev`). Multi-negocio lógico: cada tabla con `business_id`.

## 3. Lo que se hizo en esta etapa (rama `modernizacion`)

| # | Cambio | Archivos | Prueba |
|---|---|---|---|
| 1 | Respaldos verificados: lista de producción (solo metadatos) y restauración completa probada con staging y con 13 negocios de prueba (0 diferencias) | — (procedimiento en `01-auditoria.md` §8) | manual, documentada |
| 2 | **Aislamiento entre negocios** probado en todas las rutas con `:id` (~90) | `test/aislamiento-negocios.test.ts` | automática |
| 3 | Reagendar cita solo con personal del mismo negocio; boletos por turno 404 si es de otro negocio | `src/agenda.ts`, `src/tourism.ts` | automática |
| 4 | **Enlaces públicos** con identificador propio (`public_slug`), separado del código de acceso de empleados; enlaces viejos siguen funcionando; personal como «Luis G.» | `src/publiclinks.ts` (nuevo), `src/agenda.ts`, `src/tourism.ts`, `src/app.ts`, `src/db.ts` (migración 35, solo agrega), `web/src/api.ts`, `web/src/screens/Agenda.tsx`, `web/src/screens/Ajustes.tsx` | `test/enlaces-publicos.test.ts` |
| 5 | **Encabezados de seguridad** (CSP, Referrer-Policy, anti-iframe, nosniff, Permissions-Policy) | `src/headers.ts` (nuevo), `src/worker.ts`, `src/server.ts` | verificado en navegador (0 errores de consola) y en workerd |
| 6 | Colores fijos → **tokens** (base para productos) | `web/src/styles.css`, `web/src/screens/Inicio.tsx`, `web/src/Brand.tsx` | comparación píxel a píxel: 0 diferencias |
| 7 | **Productos con identidad propia**: NEXORA Barber, Nails y Tienda (registro, identidades, accesos, herramientas ocultas, Inicio con Agenda de hoy) | `web/src/products/index.ts`, `web/src/products/products.css` (nuevos), `web/src/App.tsx`, `web/src/main.tsx`, `web/src/screens/Inicio.tsx`, `package.json` (letras Fraunces e Instrument Serif) | `test/productos.test.ts` + capturas |
| 8 | Documentación | `docs/modernizacion/01..04` | — |

## 4. Pruebas ejecutadas y resultados (23 nov)

| Prueba | Resultado |
|---|---|
| `npm run check` (tipos, 215 pruebas, build, e2e en navegador) | **Pasa** (215/215, e2e OK) |
| Recorrido profundo: 13 giros × dueño y empleado × celular y computadora (296 pantallas): errores JS, API, desbordes | **Sin hallazgos** |
| 13 demos en motor Cloudflare local (workerd) | **Todo OK** |
| **Actualización de una base con datos** (versión de producción → versión nueva) en workerd | Ventas, tickets, productos y clientes de 3 negocios **idénticos**; enlaces nuevos funcionan |
| Encabezados de seguridad en workerd | Presentes en pantallas y API |
| Staging desplegado | Subió sin errores (`9ef95ad2`). **No se pudo abrir desde este entorno** (la red no permite `workers.dev`); el propietario puede revisarlo en `https://nexora-staging.josehedzaguilar0715.workers.dev` |
| Envío real de SMS/correo, push en teléfono real, impresora y báscula | **No verificado** (requiere dispositivos o secretos de producción) |

## 5. Problemas encontrados y su estado

Ver tabla de riesgos en `01-auditoria.md` §9. Abiertos más importantes:
1. Dominio con el nombre de la cuenta personal (decisión del propietario, `02-enlaces-publicos.md` §3).
2. Sin límite de peticiones por IP (regla de Cloudflare; requiere autorización de configuración de cuenta).
3. Un solo Durable Object para todos los negocios (planear partición antes de crecer).
4. Respaldo en un solo valor de KV (límite 25 MB; hoy 118 KB) y contiene llaves y datos completos (cifrar).
5. No hay procedimiento probado de «restaurar a producción».

## 6. Cómo continuar sin repetir trabajo

```
git fetch origin modernizacion && git checkout modernizacion
npm install
npm run check                      # debe dar 215+ pruebas OK y e2e OK
```
* Recorrido rápido local: `npm run build && NEXORA_DB=/tmp/x.db PORT=3135 npx tsx src/server.ts`, crear usuario de soporte con `ADMIN_PASSWORD=... npx tsx src/admin-cli.ts soporte Soporte` y demos con `POST /api/admin/demos/{giro}` (13 giros; dueños `5500000001…13`, contraseña `demo1234`, empleados `demo.{giro}`).
* Motor Cloudflare local: `npm run build:worker && npx wrangler dev --port 8799` (usa `.dev.vars`, no versionado).
* Publicar staging: `npm run deploy` (requiere credencial de Cloudflare del entorno). **Producción**: `npm run deploy:prod` **solo con autorización**.
* Verificar respaldo del día en producción (solo metadatos): API de Cloudflare `GET /accounts/{id}/storage/kv/namespaces/c8d9a9b081124f6b92a2b88e3eeeb899/keys`.
* Registros de producción: API de observabilidad (`/workers/observability/telemetry/query`, servicio `nexora`).

## 7. Tareas pendientes (en orden sugerido)

1. **Autorización para publicar** esta etapa (resumen de impacto en el mensaje de cierre).
2. Decisiones del propietario: nombres comerciales, dominio, modo claro para uñas, `view_reports` para todos.
3. Barber: vista de sillas en vivo. Nails: secado como bloque visual. Tienda: caja modo mostrador (ver `03-arquitectura-de-productos.md` §6).
4. Seguridad: regla de límite por IP, cifrar respaldos, ensayo de «restaurar a producción» en staging.
5. Escalabilidad: partir el Durable Object por negocio (con respaldo y plan de migración).
6. Investigación de mercado para dar producto propio a los otros 10 giros.

## 8. Riesgos conocidos de publicar esta etapa

* **Cambio visual grande** para la barbería (oscuro latón), uñas (claro rosa) y abarrotes (claro verde). Funciona igual, pero se ve distinto: conviene avisar a los 3 negocios antes.
* Los enlaces de reservas mostrados en la app cambian al identificador nuevo; **los viejos siguen funcionando** (no hay que reenviar nada).
* Migración 35 (número en `_migrations`): agrega columna `public_slug` e índice único parcial. Probada sobre base con datos en workerd.
* Reversión: volver a publicar `efb75ff` (`git checkout efb75ff && npm run deploy:prod`). La columna nueva queda sin uso y no estorba a la versión anterior.

## 9. Etapa 2 (23 nov): acabado premium, notificaciones y limpieza

Detalle completo en `05-acabado-y-limpieza.md`.

| # | Cambio | Archivos | Prueba |
|---|---|---|---|
| 9 | Avisos al celular que **no hay que reactivar** (re-suscripción automática con permiso ya dado; al salir solo se desliga la cuenta; `pushsubscriptionchange`) | `web/src/Avisos.tsx`, `web/public/sw.js` | `test/avisos.test.ts` + navegador con push simulado |
| 10 | **Acabado premium** (profundidad, vidrio, degradados, microinteracciones, gráficas animadas) para todos, con variante por producto | `web/src/premium.css` (nuevo), `web/src/products/products.css`, `web/src/screens/Inicio.tsx`, `web/src/main.tsx`, `web/src/products/index.ts` | capturas + medición de velocidad de la caja |
| 11 | **Limpieza**: componente, estilos y SVG sin uso; íconos sin pérdida; paquetes sobrantes; temporales del entorno (≈ 1.05 GB liberados en desarrollo; producción intacta) | `web/src/Brand.tsx`, `web/src/styles.css`, `web/public/*` | build + pruebas después de limpiar |
| 12 | Scripts de verificación en el repositorio | `scripts/verificacion/` | se usaron para la verificación final |
| 13 | Respondedor automático de ventanas en pruebas sin ciclos encimados (causaba una falla intermitente **de la prueba**, no de la app) | `test/e2e/caja.e2e.ts`, `scripts/verificacion/giros6.cjs` | palapa 6/6 |

### Pruebas finales (etapa 2, 23 nov)

| Prueba | Resultado |
|---|---|
| `npm run check` (tipos, 216 pruebas, build, e2e) | **Pasa** |
| Recorrido profundo 13 giros × dueño/empleado × celular/computadora (296 pantallas) | **Sin hallazgos** |
| Flujos de 6 giros (`giros6.cjs`) computadora y celular | **43/43 y 43/43** |
| 13 demos en workerd con la compilación final | **Todo OK** |
| Velocidad de caja con CPU 4× lenta (antes/ahora) | abrir 539→547 ms, agregar 67→58 ms |
| Staging | desplegado `20695830`; no se puede abrir desde este entorno |
| Push en teléfono real | **no verificado** (requiere celular y el servicio de Google) |

### Reversión de esta etapa
Publicar el commit anterior que se quiera conservar (`git checkout <commit> && npm run deploy:prod`, con autorización). Ningún cambio de esta etapa toca la base de datos.

## 10. Plan maestro: Fase 1 y Fase 2 (23 nov)

* Fase 1 (cierre): `06-fase1-cierre.md`.
* Fase 2 (auditoría de los 13 giros, matriz y correcciones): `07-auditoria-giros.md`.
  * Ya no sale de la caja más efectivo del que hay (compras, gastos, devoluciones, cancelaciones). Código `efectivo_insuficiente`.
  * Se puede anular un gasto capturado por error. Migración **36**, que solo agrega columnas.
  * Pruebas de día completo: `test/dia-completo.test.ts`.
* Siguiente: Fase 3, empezando por el **pago de comisiones y propinas** (ver matriz §5).

## 11. Fase 3, primer bloque (23 nov)

* **Pago de comisiones y propinas al personal**: detalle en `07-auditoria-giros.md` §6. Migración 37.
* Staging: versión `be939fe0`, con todo lo de las fases 2 y 3. Se probó contra staging (7/7):
  * rechazo por efectivo insuficiente;
  * pago por transferencia;
  * no se paga dos veces;
  * anular un gasto devuelve la caja.
* Producción: **sin cambios** (`2c16921e`). Publicar requiere la autorización del propietario.
* Pendiente de la matriz:
  * devolución a proveedor / anulación de compra;
  * anulación de abono de fiado;
  * después, Fase 4 (seguridad).

## 12. Fase 3 (cierre) y Fase 4 (23 nov)

* Fase 3, huecos comunes:
  * devolución a proveedor (migración 39);
  * anular abono de fiado (migración 38);
  * el saldo a favor ya no cuenta como cobro.

  Ver `07-auditoria-giros.md` §7.
* Fase 4, seguridad: `08-seguridad.md`.
  * Límite por IP.
  * Respaldos cifrados: **falta activar `BACKUP_KEY` en producción, con autorización**.
  * Barrido de permisos.
  * Monitor de espacio.
  * Análisis de la base compartida: **decisión pendiente**; se recomienda un objeto por negocio antes de ~10 negocios.
* Migraciones al día: **39** en esa fecha (número real en `_migrations`; desde el 24 nov son **40**, ver §14).

## 13. Cierre del plan maestro (23 nov)

* **Informe final: `11-informe-final.md`**. Fases: `06` a `11`.
* Rama `modernizacion`, staging `a04435ff`. Producción **sin cambios** (`2c16921e`): **falta la autorización del propietario**.
* Migraciones hasta la **39**.
* Siguiente trabajo sugerido, en orden:
  1. publicar con autorización;
  2. activar `BACKUP_KEY`;
  3. separar la base por negocio;
  4. cobro automático y facturación;
  5. dominio y nombres definitivos.

## 14. Cierre definitivo (24 nov)

* **Informe único: `15-informe-cierre-definitivo.md`.** Detalle en:
  * `12-respaldos-y-recuperacion.md`;
  * `13-dispositivos-y-proveedores.md`;
  * `14-estrategia-de-crecimiento.md`.
  * `16-permisos-por-sucursal.md` (recomendación de permisos por rol; pendiente de tu decisión).
* Producción confirmada = commit `efb75ff` exacto (versión `2c16921e-6ccb-41c8-8399-1069ca9a8ca3`).
* Migraciones hasta la **40**: la 40 solo agrega índices.
* Scripts de verificación nuevos en `scripts/verificacion/`: `impresion.cjs`, `productos14.cjs`, `carga.cjs` y `bench-panel.ts`.
* **Antes de cualquier prueba de carga contra staging**: staging y producción comparten la cuota diaria del plan gratis.

## Puestos y sucursales: cierre (24 nov 2026)

* Código: `737af1a` (puestos Dueño/Encargado/Empleado en el servidor) + commit de cierre de decisiones (ver `git log`). Migración 41 aditiva (`users.position`).
* Verificado: tipos, 277 pruebas (55 archivos), compilación y navegador escritorio 1366×900 y celular 390×844 (`scripts/verificacion/puestos.ts`, 32 comprobaciones). Compatibilidad de la migración 41 sobre una base v40 con datos: `test/migracion-41.test.ts`.
* Staging: **no desplegado** desde esta sesión (sin credencial de Cloudflare en el entorno; `npm run deploy` pide `CLOUDFLARE_API_TOKEN`). Última versión en staging: `f9c3271f` (anterior a los puestos). Producción: `2c16921e`, sin cambios y sin autorización de publicar.
* Detalle completo del modelo: `16-permisos-por-sucursal.md`.

### Publicación (24 nov 2026, autorizada por el propietario)
* Commit publicado: `5128fe5`. Staging: `91669ab7`. **Producción: `c67e5fc0`** (anterior: `2c16921e`, para revertir: `git checkout efb75ff && npm run deploy:prod`).
* La migración 41 solo agrega `users.position`; no cambia datos de los negocios. Comprobación de salud de ambos Workers: 200.

## Cierre final: respaldos, datos por negocio y publicación (24 nov 2026)

* **Qué se agregó** (migración 42, solo tablas nuevas): exportación e importación por negocio con simulación y confirmación (`18-…`), respaldo automático por negocio con bitácora, registro de errores sin datos privados con alerta por correo, estado de salud en el super panel, interruptor `importar_respaldo`, verificación de despliegue (`scripts/verificar-despliegue.sh` + acción de GitHub). Procedimiento de actualización y reversión: `17-actualizaciones-y-reversion.md`.
* **Versiones:** commit publicado `de95b17` (después solo documentación, scripts y flujo de verificación). Staging **`434ba220`**. Producción **`72bda7f0`** (anterior estable: `c67e5fc0`; antes `2c16921e`). Esquema de producción: 42.
* **Antes de publicar:** respaldo manual de producción 24 nov 06:03 UTC (121 751 bytes, esquema 41) restaurado en entorno aislado: **11 de 11 negocios idénticos** (22 usuarios, 95 ventas, 18 turnos, 172 productos), integridad `ok`, 0 referencias rotas, migración en el sitio sin cambiar filas.
* **Después de publicar:** el respaldo automático del 24 nov 09:17 UTC, hecho ya por el código nuevo (esquema 42), se comparó con el anterior: **nada perdido ni alterado** (11 negocios, 22 usuarios, 95 ventas, 172 productos; solo cambian tablas vivas por el uso), se restaura completo y trae **11 archivos por negocio** (el revisado trae huella interna válida). Verificación desde GitHub Actions (internet): salud con esquema 42 y 9 comprobaciones de seguridad correctas en producción y staging.
* **Pruebas:** 293 automáticas + prueba de navegador del flujo de caja; 18 verificaciones funcionales contra staging real; 26 recorridos de los 13 giros (escritorio y celular) más el acceso base; ensayo con el motor de Cloudflare local (cron de respaldos, salud, interruptores). **No se verificó:** la pantalla de salud ni los interruptores en el super panel de staging/producción (requieren iniciar sesión como soporte).
* **Cifrado de respaldos: pendiente.** `BACKUP_KEY` no está instalada; los respaldos de producción siguen sin cifrar. Procedimiento y comprobación: `12-respaldos-y-recuperacion.md` §2 y §6.
* **Recuperación:** negocio individual → `18-…` §3 (simulación + «RESTAURAR»); base completa en objeto nuevo → `12-…` §4; ensayo y comparación → `scripts/verificacion/ensayo-respaldo.ts` y `comparar-respaldos.ts`. Reversión de código: `17-…` §5.
