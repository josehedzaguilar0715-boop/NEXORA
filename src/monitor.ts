import { createHash } from 'node:crypto'
import type { Deps } from './context.js'
import type { Db } from './db.js'
import { SCHEMA_VERSION } from './db.js'
import { iso, newId } from './util.js'

/**
 * Monitoreo sin datos privados: se guarda de qué fallo se trata (ruta normalizada, tipo y un mensaje corto sin
 * correos ni números largos), cuántas veces y cuándo. Nunca cuerpos de peticiones, contraseñas, tokens ni nombres.
 */

const clean = (s: string) => s.split('\n')[0]!.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '«correo»').replace(/\d{6,}/g, '«n»').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '«id»').slice(0, 200)
const normRoute = (r: string) => r.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\/\d+/g, '/:n').slice(0, 120)

export interface ErrorInfo { source: 'api' | 'respaldo' | 'sync' | 'sistema'; route?: string; status?: number; message: string; businessId?: string | null }

/** Anota un error (agrupado por huella). Si es nuevo o hace más de una hora que no se avisa, manda alerta a los administradores. Nunca lanza. */
export function recordError(deps: Deps, e: ErrorInfo): void {
  try {
    const { db, now } = deps
    const at = iso(now())
    const route = e.route ? normRoute(e.route) : null
    const message = clean(e.message)
    const fingerprint = createHash('sha256').update(`${e.source}|${route}|${e.status ?? ''}|${message}`).digest('hex').slice(0, 20)
    db.prepare(
      `INSERT INTO error_log (id, fingerprint, source, route, status, message, business_id, first_at, last_at) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
    ).run(newId(), fingerprint, e.source, route, e.status ?? null, message, e.businessId ?? null, at, at)
    const row = db.prepare('SELECT alerted_at, count FROM error_log WHERE fingerprint = ?').get(fingerprint) as { alerted_at: string | null; count: number }
    const critical = e.source !== 'api' || (e.status ?? 500) >= 500
    if (critical && (!row.alerted_at || Date.parse(row.alerted_at) < now().getTime() - 3_600_000) && deps.notifier.sendEmail) {
      db.prepare('UPDATE error_log SET alerted_at = ? WHERE fingerprint = ?').run(at, fingerprint)
      const admins = db.prepare('SELECT email FROM admins WHERE active = 1 AND email IS NOT NULL').all() as { email: string }[]
      const send = Promise.all(admins.map((a) => Promise.resolve(deps.notifier.sendEmail!(a.email, `NEXORA · alerta: ${e.source}`, `Error ${e.source}${route ? ` en ${route}` : ''}: ${message}\nRepeticiones: ${row.count}. Revisa el super panel → Salud del sistema.`)).catch(() => false)))
      deps.defer ? deps.defer(send) : void send
    }
  } catch { /* el monitoreo nunca debe romper la operación */ }
}

/** Funciones que se pueden apagar sin publicar de nuevo. */
export const KNOWN_FLAGS = [{ key: 'importar_respaldo', label: 'Restaurar datos desde un archivo o respaldo (dueño)' }]

/** Interruptor de una función: sin registro, está encendida. Se puede apagar para todos o limitar a ciertos negocios. */
export function flagOn(db: Db, key: string, businessId?: string, dflt = true): boolean {
  const f = db.prepare('SELECT enabled, business_ids FROM feature_flags WHERE key = ?').get(key) as { enabled: number; business_ids: string | null } | undefined
  if (!f) return dflt
  if (!f.enabled) return false
  if (f.business_ids && businessId) return (JSON.parse(f.business_ids) as string[]).includes(businessId)
  return true
}

/** Estado del sistema para el super panel: detecta problemas antes de que los clientes los reporten. */
export function healthReport(deps: Deps) {
  const { db, now } = deps
  const t = now().getTime()
  const ago = (h: number) => iso(new Date(t - h * 3_600_000))
  const one = <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).get(...p) as T
  const migrations = one<{ v: number }>('SELECT MAX(version) v FROM _migrations').v
  const lastFull = one<{ created_at: string; status: string; error: string | null; encrypted: number } | undefined>("SELECT created_at, status, error, encrypted FROM backup_log WHERE kind = 'completo' ORDER BY created_at DESC LIMIT 1")
  const perBiz = one<{ ok: number; bad: number }>("SELECT COALESCE(SUM(status='ok'),0) ok, COALESCE(SUM(status='error'),0) bad FROM backup_log WHERE kind = 'automatico' AND created_at > ?", ago(30))
  const noBackup = one<{ n: number }>("SELECT COUNT(*) n FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM backup_log l WHERE l.business_id = b.id AND l.status = 'ok' AND l.kind IN ('automatico','manual') AND l.created_at > ?)", ago(36)).n
  const errors = db.prepare('SELECT source, route, status, message, count, last_at AS lastAt FROM error_log WHERE last_at > ? ORDER BY last_at DESC LIMIT 15').all(ago(24)) as { source: string; status: number | null; count: number }[]
  const critical = errors.filter((e) => e.source !== 'api' || (e.status ?? 500) >= 500).length
  const conflicts = one<{ n: number }>("SELECT COUNT(*) n FROM sync_conflicts WHERE created_at > ?", ago(24 * 7)).n
  const sales24 = one<{ n: number }>('SELECT COUNT(*) n FROM sales WHERE created_at > ?', ago(24)).n
  const mismatch = one<{ n: number }>("SELECT COUNT(*) n FROM sales s WHERE s.status != 'cancelada' AND s.created_at > ? AND EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id = s.id) AND s.total != (SELECT SUM(amount) FROM sale_payments p WHERE p.sale_id = s.id)", ago(24 * 7)).n
  const stale = one<{ n: number }>("SELECT COUNT(*) n FROM shifts WHERE status = 'abierto' AND opened_at < ?", ago(36)).n
  const size = deps.dbSize?.() ?? null
  const issues: string[] = []
  if (migrations !== SCHEMA_VERSION) issues.push(`Migraciones: la base está en ${migrations} y el código espera ${SCHEMA_VERSION}.`)
  if (deps.backups && (!lastFull || lastFull.status !== 'ok' || Date.parse(lastFull.created_at) < t - 36 * 3_600_000)) issues.push('El respaldo completo diario no se hizo en las últimas 36 horas o falló.')
  if (deps.backups && noBackup > 0) issues.push(`${noBackup} negocio(s) sin respaldo propio en 36 horas.`)
  if (perBiz.bad > 0) issues.push(`${perBiz.bad} respaldo(s) de negocio fallaron en las últimas 30 horas.`)
  if (critical > 0) issues.push(`${critical} tipo(s) de error crítico en las últimas 24 horas.`)
  if (mismatch > 0) issues.push(`${mismatch} venta(s) cuyo total no coincide con sus pagos.`)
  if (size !== null && size > 800 * 1024 * 1024) issues.push('La base pasa de 800 MB (el tope del plan gratis es 1 GB).')
  const warnings: string[] = []
  if (stale > 0) warnings.push(`${stale} caja(s) abierta(s) hace más de 36 horas.`)
  if (conflicts > 0) warnings.push(`${conflicts} conflicto(s) de sincronización en 7 días.`)
  if (deps.backups && !deps.backupKey) warnings.push('Los respaldos no están cifrados (falta BACKUP_KEY).')
  return {
    status: issues.length ? 'critico' : warnings.length || errors.length ? 'atencion' : 'ok', issues, warnings, checkedAt: iso(now()),
    schema: { database: migrations, code: SCHEMA_VERSION },
    database: { sizeBytes: size, percentOfFreeLimit: size === null ? null : Math.round((size / (1024 ** 3)) * 1000) / 10 },
    backups: { enabled: !!deps.backups, encrypted: !!deps.backupKey, lastFull: lastFull ?? null, businessesOk: perBiz.ok, businessesFailed: perBiz.bad, businessesWithoutRecentBackup: noBackup },
    errors24h: errors, sync: { conflicts7d: conflicts }, sales: { last24h: sales24, paymentMismatch7d: mismatch, staleOpenShifts: stale },
    flags: db.prepare('SELECT key, enabled, business_ids AS businessIds, note, updated_at AS updatedAt FROM feature_flags ORDER BY key').all(),
  }
}
