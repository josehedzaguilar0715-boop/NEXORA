# 49 · Lanzamiento de la evolución de NEXORA (candidato `70c85d7`)

Autorización expresa del propietario (25-nov-2026) para publicar **exclusivamente** el commit `70c85d7e91e00221c373e8bd96708d7fe85f7450` en el Worker de producción `nexora`.

## Resultado
| Dato | Valor |
|---|---|
| **Nuevo despliegue (Version ID)** | **`51773d59-c582-40b8-bfbe-a72451fa9de9`** (100 % del tráfico, 25-nov 15:03:32 UTC) |
| Despliegue anterior (reversión inmediata) | `34191efa-5149-4d55-ad8f-6a40bd2b8179` |
| Worker | `nexora` (entorno `production`); **no** se tocó `nexora-staging` |
| Migraciones | **Ninguna** (esquema 48 antes y después; `wrangler.toml`, `package.json`, `src/db.ts` sin cambios) |
| Datos | No se tocaron (despliegue de solo código) |
| Secretos | Sin cambios (solo `ADMIN_*`); `BACKUP_KEY` sigue pendiente |

## Pasos ejecutados
1. **Identidad del commit:** `70c85d7…` existe, está en `origin/diseno-v0`; frente a `HEAD` solo difieren documentos (5) y scripts de verificación (2); `src`, `web`, `test`, `wrangler.toml`, `package.json`, `package-lock.json` y configuraciones **idénticos**. Para no incluir nada más, se construyó y desplegó desde una copia limpia (`git worktree`) fijada en `70c85d7…` (ya eliminada).
2. **Respaldo válido y recuperable antes de publicar:** `nexora-2026-11-25T09-17.json.gz` (automático) y `nexora-2026-11-25T03-56.json.gz` (manual) en el KV de producción; ambos esquema 48, restaurados en bases aisladas (integridad ok, 0 referencias rotas, 11 negocios, 99 ventas), comparados sin pérdidas (doc 47). Respaldos por negocio del 24 y 25-nov también presentes.
3. **Construcción:** `npm run build:worker` sin errores (tipos del Worker y 49 archivos de pantallas).
4. **Ensayo de despliegue** (`wrangler deploy --env production --dry-run`): bindings correctos (Durable Object `NEXORA`; KV `BACKUPS` = `c8d9a9b0…`, el de producción).
5. **Publicación:** `wrangler deploy --env production` → versión `51773d59…`; trigger diario `17 9 * * *` intacto.

## Verificación posterior (15:03–15:05 UTC)
| Comprobación | Resultado |
|---|---|
| Lista de despliegues de producción | Versión nueva al 100 % |
| GitHub «Verificar despliegue» (ejecución 8, producción y staging) | **En verde**: salud, esquema 48, pantalla principal, aplicación en la página, credenciales falsas rechazadas, rutas con datos exigen sesión, ruta interna de respaldos no alcanzable, salud del sistema exige sesión de soporte, encabezados de seguridad |
| Cloudflare (observabilidad) desde el despliegue | 13 eventos, **0 de nivel error** |
| Respaldos y diario | Programación `17 9 * * *` activa; el siguiente respaldo automático es 26-nov 09:17 UTC |

## Reversión (si hiciera falta)
`CLOUDFLARE_API_TOKEN=dummy NODE_USE_ENV_PROXY=1 npx wrangler rollback 34191efa-5149-4d55-ad8f-6a40bd2b8179 --env production --message "reversión"`. Es solo código; los datos nuevos (`perfil`, `planoMesas`, `imagenUrl`, `descripcion`) son claves JSON adicionales que la versión anterior ignora. No se ejecutó (sin incidencias).

## Seguimiento automático (solo lectura)
- Hoy 15:55 UTC: errores de Cloudflare, «Verificar despliegue» y reversión automática si hubiese errores repetidos, fallo de inicio de sesión o esquema distinto de 48.
- 26-nov 09:40 UTC: comparación y restauración aislada del primer respaldo automático posterior; agrega cifras a este documento.

## Limitaciones
- El dominio de producción no es alcanzable desde el entorno de desarrollo: la verificación funcional posterior se apoya en «Verificar despliegue» (GitHub), la observabilidad y el respaldo del día siguiente; no se operaron cuentas reales (no se crean ventas ni citas en los negocios activos).
- Las sesiones con credenciales de FENIX BARBERÍA, Nails y abarrotes las comprobará cada dueño al usar el sistema; en las primeras horas conviene que revisen Inicio, Caja y (barbería/uñas) Agenda.

## Pendiente único de seguridad
`BACKUP_KEY` (doc 48): instalar, comparar huella, generar respaldo `.enc`, descifrado aislado. No bloqueó el lanzamiento.

## Incidencias
Ninguna al momento de este informe.
