# Arquitectura de NEXORA

Punto de venta y administración **multi-negocio** para 13 giros de negocios pequeños en México: español, pesos, hora del centro de México. Un solo sistema; cada negocio ve solo lo suyo.

## Panorama

```
Navegador / celular (PWA)                       Cloudflare
┌───────────────────────────────┐   HTTPS   ┌────────────────────────────────────────────────────┐
│ React 18 + Vite (web/)        │ ───────▶  │ Worker (src/worker.ts)                             │
│  · 30 pantallas, carga diferida│           │  · sirve las pantallas (incrustadas en el Worker)  │
│  · cola de ventas sin internet │           │  · /api/* → un Durable Object «principal»          │
│  · service worker (sw.js)     │           │  · encabezados de seguridad, IP real → x-nexora-ip │
└───────────────────────────────┘           ├────────────────────────────────────────────────────┤
                                            │ Durable Object (src/db-do.ts + src/app.ts, Hono)   │
                                            │  · SQLite: 102 tablas, todos los negocios          │
                                            │  · ~320 rutas de API en ~45 módulos                │
                                            ├────────────────────────────────────────────────────┤
                                            │ KV «BACKUPS»: respaldo diario 3:17 a. m., 30 días   │
                                            └────────────────────────────────────────────────────┘
Desarrollo local: src/server.ts (Node + better-sqlite3) corre la MISMA app Hono con un archivo SQLite.
```

## 1. Frontend (`web/`)

* **React 18 + Vite + TypeScript.** Una sola app; la pantalla se elige con `#/clave` (ruteo por hash, sin librería).
* `web/src/App.tsx` define:
  * `SCREENS`: clave, permiso, giros, grupo y la pantalla de `web/src/screens/`;
  * `screensFor(me)`: qué ve cada quien según permiso, giro, módulos y producto.
* **Vocabulario por giro** (`web/src/giros.ts`): «clienta», «mesero», «fiado», etc.
* **Productos e identidad visual** (`web/src/products/`): 13 productos (NEXORA Barber, Nails, Tienda, Ferretería…). Se activan con `<html data-product="…">` y variables CSS en `products.css`. El acabado común está en `web/src/premium.css`.
* **Estilos:** `web/src/styles.css`, con variables como `--bg`, `--primary`, `--radius`…
* **Ventanas propias:** `web/src/Dialog.tsx` (`ask`, `askCode`, `confirmAsk`) en lugar de `prompt`/`confirm`.
* **Super panel:** `/admin` → `web/src/screens/SuperPanel.tsx`, con su propio inicio de sesión.
* **Letras:** incluidas en el paquete (`@fontsource`), funcionan sin internet.
* **Lector de códigos y QR:** `@zxing/browser`, se descarga solo al escanear.

## 2. Backend (`src/`)

* **Hono**, con validación **Zod** en cada entrada. `src/app.ts` arma la app:
  * rutas públicas: entrar, registrarse, reservas, boletos;
  * super panel (`src/admin.ts`);
  * rutas con sesión, que pasan por `authenticate` → `businessGate` (prueba o pago vigente) → `idempotency`.
* **Un módulo por tema:**
  * `sales.ts` (ventas), `cash.ts` (caja y cortes), `inventory.ts` (lotes, compras, devolución a proveedor);
  * `finance.ts` (fiado, gastos), `accounting.ts` (estados financieros), `commissions.ts` y `payouts.ts` (comisiones y pagos);
  * `agenda.ts` (citas), `dining.ts` (mesas y cocina), `tourism.ts` (boletos), `baths.ts`, `taqueria.ts`, `perfume.ts`, `hardware.ts`, `services.ts`;
  * `notifications.ts` (avisos y push), `backup.ts`, `ratelimit.ts`, `billing.ts` (planes y vencimientos), `today.ts` (pendientes y primeros pasos)…
* **Errores:** `AppError` (`src/util.ts`) con código y mensaje en español; todo devuelve JSON `{ error: { code, message } }`.
* **Dinero:** siempre **enteros en centavos** (MXN). **Cantidades:** milésimas (`*_milli`) para granel.
* **Bitácora:** `audit()` registra quién, qué, motivo y quién autorizó, en las operaciones sensibles.

## 3. Base de datos

* **SQLite.** En Cloudflare es la SQLite del Durable Object; en local es `better-sqlite3`. El mismo código usa ambas a través de la interfaz `Db` (`src/db.ts`).
* **Migraciones:** el arreglo `MIGRATIONS` de `src/db.ts` (41 hoy) se aplica en orden al arrancar y queda registrado en `_migrations`.
  * **Regla: solo agregar al final**; nunca editar una ya publicada.
  * El esquema resultante está en `docs/entrega-floot/esquema-sqlite.sql`.
* **Multi-negocio lógico:** casi todas las tablas tienen `business_id`, y cada ruta filtra por el negocio de la sesión. Probado en ~90 rutas (`test/aislamiento-negocios.test.ts`).
* **Nada se borra:** ventas, movimientos, bitácora, fiado, gastos y pagos tienen *triggers* que impiden `DELETE`. Las correcciones son movimientos contrarios o anulaciones con motivo.
* **Inventario por lotes (PEPS)** con costo real (incluye fletes) y movimientos inmutables.

## 4. Hosting

* **Cloudflare Workers + Durable Objects + KV**, en plan gratuito.
  * Staging: Worker `nexora-staging`. Producción: Worker `nexora` (`--env production`).
  * Las pantallas se incrustan en el Worker (`scripts/embed-assets.ts` → `src/assets.gen.ts`, generado y no versionado).
* **Un solo Durable Object** para todos los negocios. El tope es de 1 GB en el plan gratis: ver `docs/modernizacion/08-seguridad.md` §5.
* Hay `Dockerfile` para correr la versión Node en un servidor propio (alternativa; no se usa hoy).

## 5. Autenticación

* **Dueño:** teléfono + contraseña. Con SMS configurado, el registro y los equipos nuevos se confirman con un código.
* **Empleado y encargado:** usuario + contraseña. Tres puestos fijos (dueño, encargado, empleado) con alcance forzado en el servidor (`src/scope.ts`); ver `docs/modernizacion/16-permisos-por-sucursal.md`.
* **Contraseñas y códigos:** *scrypt* con sal (`hashSecret`).
* **Sesiones:** token aleatorio. En la base solo se guarda su **sha256** (tabla `sessions`), con vigencia de 30 días, y se puede revocar. El token viaja como `Authorization: Bearer`.
* **Bloqueos:** 5 intentos fallidos bloquean la cuenta 15 minutos. Además hay un **límite por IP** en entrar, códigos, registro y rutas públicas (`src/ratelimit.ts`).
* **Código de autorización del dueño o encargado** (4 a 6 dígitos) para cancelar, descontar, cambiar precios, fiar de más, anular, etc. (`src/authcode.ts`).
* **Super panel:** usuarios propios (`admins`), con segundo paso por SMS o correo si están configurados.

## 6. Almacenamiento

| Qué | Dónde |
|---|---|
| Datos del negocio | SQLite (Durable Object) |
| Respaldos | KV, un archivo por día, 30 días; opcionalmente cifrado con AES-GCM (`BACKUP_KEY`) y copia al correo del super panel. En local: carpeta `data/respaldos`. |
| Logo del negocio | Solo una URL externa (campo `logo_url`); NEXORA no guarda imágenes ni archivos |
| Llaves VAPID del push | Se generan una vez y viven en la base (no en el código) |
| Sesión en el equipo | `localStorage` (token, id de equipo, cola de ventas) |

## 7. Sincronización y funcionamiento sin internet

* **Service worker** (`web/public/sw.js`, caché `nexora-v3`): guarda las pantallas, así que la app abre sin internet. También recibe el push y se vuelve a suscribir solo cuando el navegador renueva la suscripción.
* **Cola de ventas** (`outbox` en `web/src/api.ts`, guardada en `localStorage`):
  * Sin red, la venta se guarda con un **id único** y se envía después (`flush()`).
  * El servidor la reconoce por ese id: reenviar no duplica (`src/sync.ts`, middleware `idempotency`).
* **Protecciones:** no se cuenta inventario ni se cierra la carne mientras haya ventas por enviar (`ensureSynced`). El corte de caja va en la misma cola.
* **Conflictos:** si dos equipos cambian el mismo producto sin conexión, gana el más reciente y queda registrado el conflicto.

## 8. Pruebas

* `test/*.test.ts` (55 archivos, 277 pruebas) con vitest sobre SQLite en memoria. Cubren:
  * un archivo por giro;
  * días completos (`dia-completo.test.ts`);
  * permisos (`permisos-barrido.test.ts`), los tres puestos por sucursal (`puestos-sucursales.test.ts`) y aislamiento;
  * respaldos, límite por IP, pagos al personal, devolución a proveedor y primeros pasos.
* `test/e2e/caja.e2e.ts`: navegador real con Playwright.
* `scripts/verificacion/`: recorridos de todas las pantallas por giro, rol y dispositivo, velocidad e internet lento.
