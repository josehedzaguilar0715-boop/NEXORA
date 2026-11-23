# NEXORA — Auditoría del proyecto

Fecha: 23 nov 2026 · Rama: `modernizacion` (parte de `claude/new-session-pqpyhl`, versión en producción `2c16921e`).
Método: lectura del código, pruebas automáticas, recorridos en navegador y consultas de solo lectura a Cloudflare. Lo marcado **Verificado** se comprobó ejecutándolo; lo marcado **Revisado** se leyó en el código sin una prueba dedicada.

## 1. Arquitectura actual

```
Navegador / celular (PWA instalable, funciona sin internet)
   │  web/  React 18 + Vite · cola local de ventas (outbox) · service worker (sw.js) · push
   ▼
Cloudflare Worker  (src/worker.ts)  ── sirve las pantallas incluidas en el paquete (assets.gen.ts)
   │  /api/*
   ▼
Durable Object «principal»  (una sola instancia para TODOS los negocios)
   │  Hono (src/app.ts) · 40+ módulos de rutas
   ▼
SQLite del Durable Object (src/db-do.ts)  ·  KV «BACKUPS» (respaldo diario)
```

* **Local / pruebas:** el mismo código corre en Node (`src/server.ts`) con `better-sqlite3` (`src/db-node.ts`). Solo cambia la capa de base.
* **Entornos:** `nexora` (producción) y `nexora-staging`, cada uno con **su propio Durable Object, KV de respaldos y secretos** (`wrangler.toml`, sección `[env.production]`). **Verificado:** los dos namespaces de KV son distintos y tienen respaldos independientes.
* **Tamaño:** ~10,000 líneas de servidor (48 archivos) y ~7,300 de pantallas (43 archivos).

## 2. Tecnologías y servicios

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript (servidor y pantallas) |
| API | Hono 4, validación con Zod 4 |
| Base | SQLite (Durable Object en la nube, better-sqlite3 en local) |
| Pantallas | React 18, Vite 8, lucide-react (íconos), qrcode, @zxing (lector de códigos con cámara, carga diferida), read-excel-file (importar) |
| Letras | Inter y Bricolage Grotesque incluidas en la app (sin Google) |
| Pruebas | Vitest (215 casos en 44 archivos) + Playwright (`test/e2e/caja.e2e.ts`) |
| Nube | Cloudflare Workers + Durable Objects + KV, plan gratuito; cron diario de respaldo (03:17 hora del centro) |
| Externos opcionales | Twilio (SMS), Resend (correo): solo si hay secretos; sin ellos, los códigos se imprimen en consola |
| Push | Web Push con llaves VAPID propias guardadas en la base (sin servicios de pago) |
| CI | GitHub Actions: `ci.yml` (tipos, pruebas, build en cada push) y `deploy-staging.yml` (solo rama `staging` o manual) |

## 3. Frontend y backend

* **Backend (`src/`)**: un archivo de rutas por dominio (`sales.ts`, `cash.ts`, `inventory.ts`, `finance.ts`, `accounting.ts`, `dining.ts`, `agenda.ts`, `tourism.ts`…). Reglas transversales en `context.ts` (sesión, permisos), `audit.ts` (bitácora inmutable), `db.ts` (esquema y migraciones en orden, solo se agregan).
* **Frontend (`web/src/`)**: `App.tsx` decide qué pantallas ve cada usuario (permiso + giro + módulo) y las carga bajo demanda; `giros.ts` guarda el vocabulario de cada giro; una pantalla por archivo en `screens/`. Estilos en un solo `styles.css` con tokens.
* **Hallazgo de organización:** la mayoría de las pantallas son genéricas con condiciones `hasGiro(...)` dentro. Funciona, pero la especialización por producto está repartida en muchos `if`. Ver `03-arquitectura-de-productos.md`.

## 4. Base de datos y separación de negocios

* **Un solo SQLite para todos los negocios**; cada tabla de datos lleva `business_id` y cada consulta lo filtra (multi-inquilino lógico, no físico).
* **Verificado (nuevo, `test/aislamiento-negocios.test.ts`):** se crean dos negocios; con los identificadores del negocio A, el negocio B intenta leer y modificar en **todas las rutas con `:id`** del servidor (se leen del código, ~90). Ninguna responde con éxito. La prueba falla sola si alguien agrega una ruta sin revisar el negocio.
  * Se encontraron y corrigieron 2 detalles: reagendar una cita aceptaba un barbero de otro negocio (sin fuga de datos, pero rompía la integridad) y `/shifts/:id/tickets` respondía vacío en vez de «no encontrado».
* **Migraciones:** 37 en orden, aplicadas una vez, cada una en transacción; las que reconstruyen tablas revisan llaves foráneas. Tablas de ventas y movimientos tienen triggers que impiden borrar (`no_delete`). «Empezar de cero» borra solo datos de prueba de un negocio y está cubierto por pruebas.

## 5. Autenticación y permisos — Revisado y con pruebas

* Contraseñas con **scrypt** y sal; sesiones con token aleatorio guardado **solo como hash** (sha256), 30 días, revocables por dispositivo.
* Dueño: teléfono + contraseña + **código por SMS/correo** en dispositivos nuevos (dispositivo de confianza 30 días). Empleados: usuario + contraseña (código de negocio opcional).
* Bloqueo temporal por intentos fallidos (por cuenta) y por código de verificación.
* Permisos por empleado (lista) + plantillas por puesto (`src/permissions.ts`); acciones delicadas (cancelar, descuentos, precios) piden **código de autorización** del dueño/encargado, quedan en bitácora con quién autorizó.
* `view_reports` se concede a todos por decisión anterior (`ALWAYS_GRANTED` en `context.ts`): un cajero ve los reportes del negocio. **Decisión a revisar** con el dueño.

## 6. Módulos existentes

13 giros con funciones propias (detalle en `README.md` y `NEXORA_SPEC.md`): abarrotes, ferretería, papelería, barbería, uñas, perfumería, baños, turístico, palapa, restaurante, comedor, taquería, verdulería.
Comunes: caja y cortes X/Z, inventario por lotes (PEPS) con granel y paquetes, compras con fletes, clientes y fiado, sellos/membresías/promociones/rifa, agenda con link de reservas, comisiones y propinas, finanzas (estado de resultados, flujo, balance, plan 50/30/20), panel de inicio, avisos push, importar desde Excel, demos, super panel, buzón de soporte.

**Verificado** (pruebas + recorridos): 215 casos automáticos; recorrido en navegador de los 13 giros como dueño y empleado, en celular y computadora (296 pantallas, sin errores de JS, de API ni desbordes); 13 demos en el motor real de Cloudflare (workerd).

**No verificado de punta a punta** (dependen de servicios externos o dispositivos):
* Envío real de SMS/correo (Twilio/Resend): depende de secretos de producción que no se leyeron.
* Notificación push llegando a un teléfono real (se verificó la firma y el envío al servicio de Google con un endpoint de prueba).
* Impresión de tickets en impresora térmica y báscula física.

## 7. Pruebas existentes

| Tipo | Dónde | Resultado al 23 nov |
|---|---|---|
| Unitarias/integración (API completa en memoria) | `test/*.test.ts` (44 archivos) | 212 pasan, 0 fallan |
| Punta a punta en navegador | `test/e2e/caja.e2e.ts` | pasa (`npm run check`) |
| Recorridos visuales | scripts de sesión (no versionados): 6 giros pc/cel, 13 demos | pasan |
| Límites de Cloudflare | `test/limites-cloudflare.test.ts` (máx. 5 términos en SELECT compuesto) | pasa |

Comando único: `npm run check` (tipos + pruebas + build + e2e).

## 8. Respaldos y restauración — Verificado 23 nov

* **Producción:** respaldo automático diario 03:17 (hora centro) a KV, se guardan 30 días. Lista leída (solo nombres y tamaños, sin abrir datos): 6 respaldos del 18 al 23 nov, el de hoy de 118 KB, tamaño creciente día con día (señal de que incluyen datos nuevos).
* **Restauración:** `scripts/restore.ts <respaldo.json.gz> <nueva.db>` crea una base nueva (nunca sobrescribe) con todas las migraciones y carga las tablas; revisa llaves foráneas.
  * Probado con el respaldo de **staging** de hoy: 100 tablas, 46 filas, sin diferencias.
  * Probado con una base de pruebas con los 13 negocios demo (respaldo hecho con el mismo código que producción): **1,574 filas en 99 tablas, cero diferencias, ventas por negocio idénticas**.
* Por decisión del propietario **no se descargó ni abrió ningún respaldo real**.
* **Pendiente:** no hay procedimiento documentado para cargar una base restaurada de vuelta al Durable Object de producción (hoy el respaldo sirve para auditar o migrar, no para «volver atrás» con un clic). Ver riesgos.

## 9. Riesgos

### Seguridad
| # | Riesgo | Nivel | Estado |
|---|---|---|---|
| S1 | El dominio público muestra el nombre de la cuenta de Cloudflare del propietario (`josehedzaguilar0715.workers.dev`) | Medio (privacidad) | **Propuesta** en `02-enlaces-publicos.md`; requiere decisión del propietario |
| S2 | El link de reservas usaba el **código de negocio**, que también sirve para que entren los empleados | Medio | **Corregido en rama**: identificador público propio; enlaces viejos siguen funcionando |
| S3 | La página pública de reservas mostraba nombres completos del personal e ids internos | Bajo-medio | **Corregido en rama**: «Luis G.», sin ids |
| S4 | Sin encabezados de seguridad (CSP, Referrer-Policy, anti-iframe): el token de la cita podía viajar a otros sitios en el Referer | Medio | **Corregido en rama** (`src/headers.ts`), verificado sin errores en consola |
| S5 | Sin límite de peticiones por IP en login y reservas públicas (solo bloqueo por cuenta y 3 reservas pendientes por teléfono) | Medio | Pendiente: regla de Cloudflare (requiere autorización, configuración de cuenta) |
| S6 | Sesión guardada en `localStorage` (si hubiera un XSS, se podría robar) | Bajo (React escapa todo; ahora con CSP) | Aceptado; revisar si se agrega HTML externo |
| S7 | Los respaldos contienen toda la base (incluida la llave privada VAPID de push); si hay correo configurado se envían por correo | Medio | Pendiente: cifrar respaldos o no enviarlos por correo |
| S8 | `view_reports` para todos los empleados | Bajo (decisión de negocio) | Pendiente decisión |

### Rendimiento y disponibilidad
| # | Riesgo | Nivel | Nota |
|---|---|---|---|
| R1 | **Un solo Durable Object para todos los negocios**: todo se procesa en fila en una instancia; una migración fallida o un error grave afecta a todos | Medio hoy, alto al crecer | Plan: un DO por negocio (o por grupo) cuando haya decenas de negocios; requiere migración de datos con respaldo |
| R2 | Respaldo = JSON de **toda** la base en un solo valor de KV (límite 25 MB) | Bajo hoy (118 KB), alto al crecer | Partir por negocio o pasar a R2 antes de ~10 MB |
| R3 | Plan gratuito: CPU por petición limitado. Medido en producción (24 h): media 3 ms, máx. 307 ms (crear demo, solo soporte) | Bajo | Ya se optimizó la entrega de archivos (antes 46–56 ms por archivo) |
| R4 | Inicio y Reportes calculan series día por día (≈30 consultas por petición, cada 30 s mientras está abierto) | Bajo | Optimizar con consultas agrupadas si crece |
| R5 | No hay «restaurar a producción» probado | Medio | Documentar y ensayar en staging |
