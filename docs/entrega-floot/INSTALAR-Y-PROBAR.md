# Instalar, ejecutar y probar NEXORA

Este proyecto corre en dos lugares con el **mismo código**:

* **Local (Node + SQLite en archivo)**, para desarrollar y probar.
* **Cloudflare (Worker + Durable Object con SQLite)**, que es donde viven staging y producción.

## 1. Requisitos

* Node.js **22** (probado con 22.23).
* npm 10 o más.
* Para las pruebas en navegador: **Playwright no viene en `package.json`** (en el entorno donde se desarrolló estaba preinstalado). En otro equipo: `npm i --no-save playwright && npx playwright install chromium`.
* Opcional, solo para desplegar en Cloudflare: una cuenta de Cloudflare y `wrangler` (ya viene en las dependencias).

## 2. Instalar

```bash
npm ci                 # instala exactamente las versiones de package-lock.json
```

`better-sqlite3` compila un módulo nativo. Si falla, instala las herramientas de compilación del sistema (Linux: `build-essential` y `python3`).

## 3. Ejecutar en local

```bash
npm run build                                   # compila las pantallas (web/dist)
NEXORA_DB=data/nexora.db PORT=3000 npm start    # API + pantallas en http://localhost:3000
```

* La base se crea sola con todas las migraciones al primer arranque.
* Para desarrollo con recarga automática: `npm run dev` (API) y `npm run web:dev` (pantallas con Vite).

### Crear el usuario del super panel y datos de prueba

```bash
ADMIN_PASSWORD=una-contraseña-larga NEXORA_DB=data/nexora.db npm run admin:create -- soporte "Soporte"
```

1. Entra a `http://localhost:3000/admin` con `soporte` y esa contraseña.
2. En la pestaña **Demos** crea negocios ficticios de cualquiera de los 13 giros.

Las demos también se crean con `POST /api/admin/demos/{giro}` y el token del super panel. Son **datos ficticios**:

* dueños `5500000001` a `5500000013`, contraseña `demo1234`;
* empleados `demo.{giro}`.

Giros: `abarrotes, ferreteria, papeleria, barberia, unas, perfumeria, banos, turistico, palapa, restaurante, comedor, taqueria, verduleria`.

## 4. Probar

| Comando | Qué hace | Tiempo aprox. |
|---|---|---|
| `npm run typecheck` | Revisa tipos del servidor y de las pantallas | 20 s |
| `npm test` | **241 pruebas** de servidor (vitest) sobre bases en memoria | 40 s |
| `npm run build` | Compila las pantallas | 10 s |
| `npm run e2e` | Prueba de punta a punta en navegador real (31 pasos) | 2 min |
| `npm run check` | Todo lo anterior, en orden. **Debe terminar sin errores antes de publicar.** | 3 min |

Recorridos extra en navegador (necesitan el servidor local con demos): ver `scripts/verificacion/README.md`.

## 5. Cloudflare (solo si se sigue usando)

```bash
npm run build:worker                              # pantallas incrustadas en el Worker
npx wrangler dev --port 8799                      # motor de Cloudflare en local (usa .dev.vars)
npm run deploy                                    # STAGING
npm run deploy:prod                               # PRODUCCIÓN, solo con autorización del propietario
```

* `wrangler.toml` contiene los nombres de los Workers y los **identificadores** de los espacios de respaldo (KV). No son secretos: sin una credencial de la cuenta no dan acceso a nada.
* Los secretos van con `npx wrangler secret put NOMBRE [--env production]`. Los nombres están en `.dev.vars.example`.

## 6. Respaldos

* `npm run backup`: respaldo de la base local.
* `npm run restore -- respaldo.json.gz nueva.db`: reconstruye una base **nueva**; nunca sobrescribe.
* Respaldo cifrado: `NEXORA_BACKUP_KEY=<llave> npm run restore -- respaldo.json.gz.enc nueva.db`.
