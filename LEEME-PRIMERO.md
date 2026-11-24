# NEXORA: paquete completo para continuar el desarrollo

Punto de venta y administración para 13 giros de negocios pequeños en México (abarrotes, ferretería, papelería, barbería, uñas, perfumería, baños públicos, lugar turístico, palapa, restaurante, comedor, taquería y verdulería).

**La versión exacta incluida (fecha, rama y commit) está en `VERSION.txt`**, en la raíz del ZIP.

## Empieza aquí

| Documento | Para qué |
|---|---|
| `docs/entrega-floot/INSTALAR-Y-PROBAR.md` | Instalar, ejecutar en local, crear datos de prueba y correr las pruebas |
| `docs/entrega-floot/ARQUITECTURA.md` | Frontend, backend, base de datos, hosting, autenticación, almacenamiento, sincronización y modo sin internet |
| `docs/entrega-floot/ESTADO.md` | Qué está terminado, qué está pendiente y qué no se ha probado en real |
| `docs/entrega-floot/MIGRAR-A-FLOOT.md` | Qué cambia al pasar a Floot y en qué orden hacerlo sin riesgo |
| `docs/entrega-floot/esquema-sqlite.sql` | Esquema completo de la base: 102 tablas, sin datos |
| `docs/modernizacion/` | Bitácora de la modernización por fases, auditoría de los 13 giros, seguridad, costos e informe final (`11-informe-final.md`) |
| `NEXORA_SPEC.md` | Especificación funcional original |
| `README.md` | Descripción general original del proyecto |
| `.dev.vars.example` | Nombres de las variables y secretos (sin valores) |

## En 3 comandos

```bash
npm ci
npm run build
NEXORA_DB=data/nexora.db PORT=3000 npm start     # http://localhost:3000
```

Pruebas: `npm test` (254 pruebas) o `npm run check` (todo, incluida la prueba en navegador).

## Reglas que este proyecto ha seguido (y conviene mantener)

* **Producción tiene 3 negocios reales.** No se publica sin autorización del propietario. No se borran datos ni respaldos.
* Las migraciones **solo agregan** (al final de `MIGRATIONS` en `src/db.ts`).
* Ventas, movimientos, bitácora, fiado y gastos **no se borran**: se corrigen con movimientos contrarios o anulaciones con motivo.
* Ningún secreto en el código ni en el repositorio.

## Contenido del ZIP

* **Código fuente:**
  * `src/`: servidor (API, base de datos y migraciones);
  * `web/`: pantallas;
  * `scripts/`: respaldo, restauración, incrustado de pantallas y recorridos de verificación;
  * `test/`: pruebas.
* **Configuración:** `package.json`, `package-lock.json`, los `tsconfig*.json`, `web/vite.config.ts`, `wrangler.toml` (Cloudflare), `Dockerfile` y `.github/` (integración continua).
* **Documentación:** `docs/`, `LEEME-PRIMERO.md`, `README.md` y `NEXORA_SPEC.md`.
* `VERSION.txt` (versión incluida) y `MANIFIESTO-SHA256.txt` (huella de cada archivo, para comprobar que nada se dañó).
