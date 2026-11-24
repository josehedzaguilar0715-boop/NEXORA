import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import type { BackupStore } from './backup.js'
import { type Deps, type Env, body, ownerOnly, parse } from './context.js'
import { SCHEMA_VERSION, type Db } from './db.js'
import { flagOn, recordError } from './monitor.js'
import { businessFilter, GLOBAL_TABLES, unclassified } from './partition.js'
import { AppError, iso, newId } from './util.js'

/**
 * Datos de UN negocio: exportar, respaldar, simular una restauración y restaurar.
 *
 * Reglas (decisión del propietario):
 *  · Solo se incluye lo del negocio; el archivo dice de qué negocio es y la restauración lo exige.
 *  · Nunca contraseñas, códigos de autorización, sesiones, dispositivos, suscripciones push ni enlaces/token públicos.
 *  · Restaurar solo AGREGA lo que falta: no sobrescribe nada que ya exista (lo nuevo se conserva) ni mezcla negocios.
 *  · Antes de modificar hay una simulación (se ejecuta todo y se deshace) y una confirmación explícita.
 */

export const FORMAT = 'nexora-negocio'
export const FORMAT_VERSION = 1

/** Tablas que nunca salen en un archivo del negocio (acceso, dispositivos, bitácoras técnicas y datos de toda la plataforma). */
const EXCLUDED_TABLES = new Set([
  '_migrations', 'sessions', 'trusted_devices', 'verification_codes', 'push_subscriptions', 'idempotency', 'notification_seen',
  'backup_log', 'error_log', 'feature_flags', 'admins', 'admin_sessions', 'admin_challenges', 'app_keys', 'settings',
])
/** Columnas que nunca salen (secretos, tokens y contadores de bloqueo). */
const EXCLUDED_COLS: Record<string, string[]> = {
  users: ['password_hash', 'auth_code_hash', 'auth_failed_attempts', 'auth_locked_until', 'failed_attempts', 'locked_until'],
  appointments: ['public_token'],
  entry_tickets: ['order_token'],
}
/** Al restaurar un usuario que falta: sin contraseña válida; el dueño le asigna una nueva. */
const PLACEHOLDERS: Record<string, Record<string, unknown>> = { users: { password_hash: '!sin-contrasena', must_change_password: 1 } }
interface T { name: string; cols: string[]; pk: string[]; scope: string; params: number; order: number; globalRefs: { from: string; table: string; to: string; required: boolean }[] }
const planCache = new WeakMap<Db, T[]>()
/** Tablas que no son del negocio ni están excluidas a propósito: debe estar vacío (la prueba lo vigila al agregar tablas nuevas). */
export const uncoveredTables = (db: Db) => unclassified(db)

/**
 * Qué tablas y qué renglones son de un negocio: la clasificación de `src/partition.ts` (revisada y vigilada por su prueba).
 * Aquí solo se quitan las que nunca salen (acceso, dispositivos, bitácoras técnicas) y se ordenan para cargarlas.
 */
function plan(db: Db): T[] {
  const hit = planCache.get(db)
  if (hit) return hit
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
    .filter((n) => !EXCLUDED_TABLES.has(n) && !(GLOBAL_TABLES as readonly string[]).includes(n))
  const included = new Set(names)
  const info = new Map(names.map((n) => [n, { cols: db.pragma(`table_info("${n}")`) as { name: string; pk: number; notnull: number }[], fks: db.pragma(`foreign_key_list("${n}")`) as { table: string; from: string; to: string }[] }]))
  // Orden: primero las tablas de las que otras dependen.
  const order: string[] = [], seen = new Set<string>()
  const visit = (n: string) => {
    if (seen.has(n)) return
    seen.add(n)
    for (const f of info.get(n)!.fks) if (f.table !== n && included.has(f.table)) visit(f.table)
    order.push(n)
  }
  names.forEach(visit)
  const out = order.map((n, i): T => {
    const scope = businessFilter(db, n)
    return { name: n, cols: info.get(n)!.cols.map((c) => c.name).filter((c) => !(EXCLUDED_COLS[n] ?? []).includes(c)), pk: info.get(n)!.cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name), scope, params: (scope.match(/\?/g) ?? []).length, order: i,
      // Referencias a tablas de la plataforma (p. ej. quién del super panel registró un cobro): si ese registro no existe en el destino, se deja vacío si la columna lo permite; si es obligatoria, el renglón se omite con aviso.
      globalRefs: info.get(n)!.fks.filter((f) => (GLOBAL_TABLES as readonly string[]).includes(f.table)).map((f) => ({ from: f.from, table: f.table, to: f.to, required: !!info.get(n)!.cols.find((c) => c.name === f.from)!.notnull })) }
  })
  planCache.set(db, out)
  return out
}

const rowsOf = (db: Db, t: T, businessId: string) => db.prepare(`SELECT ${t.cols.map((c) => `"${c}"`).join(',')} FROM "${t.name}" WHERE ${t.scope} ORDER BY rowid`).all(...Array(t.params).fill(businessId)) as Record<string, unknown>[]

export const sha256Hex = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')

export interface BusinessFile {
  format: string; formatVersion: number
  manifest: { businessId: string; businessName: string; exportedAt: string; schemaVersion: number; counts: Record<string, number>; excluded: { tables: string[]; columns: Record<string, string[]> }; note: string }
  tables: Record<string, Record<string, unknown>[]>
  sha256: string
}

const bodyHash = (f: Pick<BusinessFile, 'manifest' | 'tables'>) => sha256Hex(JSON.stringify({ manifest: f.manifest, tables: f.tables }))

/** Arma el archivo completo de un negocio (sin secretos). */
export function buildExport(db: Db, businessId: string, now: Date): BusinessFile {
  const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(businessId) as { name: string } | undefined
  if (!biz) throw new AppError(404, 'no_encontrado', 'No se encontró el negocio.')
  const tables: BusinessFile['tables'] = {}
  const counts: Record<string, number> = {}
  for (const t of plan(db)) { const r = rowsOf(db, t, businessId); if (r.length) { tables[t.name] = r; counts[t.name] = r.length } }
  const manifest = {
    businessId, businessName: biz.name, exportedAt: iso(now), schemaVersion: SCHEMA_VERSION, counts,
    excluded: { tables: [...EXCLUDED_TABLES].filter((n) => !['_migrations'].includes(n)).sort(), columns: EXCLUDED_COLS },
    note: 'Archivo de datos de un negocio de NEXORA. No contiene contraseñas, códigos de autorización ni sesiones: al restaurar, a los usuarios que falten se les asigna una contraseña nueva.',
  }
  return { format: FORMAT, formatVersion: FORMAT_VERSION, manifest, tables, sha256: bodyHash({ manifest, tables }) }
}

/** Cuántos renglones tiene hoy el negocio por tabla (para «qué información contiene»). */
export function currentCounts(db: Db, businessId: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of plan(db)) {
    const n = (db.prepare(`SELECT COUNT(*) n FROM "${t.name}" WHERE ${t.scope}`).get(...Array(t.params).fill(businessId)) as { n: number }).n
    if (n) out[t.name] = n
  }
  return out
}

export interface ImportReport {
  ok: boolean; errors: string[]; warnings: string[]; sha256: string | null
  tables: Record<string, { insert: number; same: number; differs: number; skipped: number }>
  totals: { insert: number; same: number; differs: number; skipped: number }
  manifest: BusinessFile['manifest'] | null
}

class Rollback extends Error {}

/** Revisa un archivo SIN tocar nada (formato, negocio, integridad, versión y relaciones). */
function validate(db: Db, f: unknown, businessId: string): { file: BusinessFile | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = []
  const x = f as BusinessFile
  if (!x || typeof x !== 'object' || x.format !== FORMAT || !x.manifest || !x.tables || typeof x.tables !== 'object') return { file: null, errors: ['El archivo no es una exportación de negocio de NEXORA.'], warnings }
  if (x.formatVersion !== FORMAT_VERSION) errors.push(`Versión de formato ${x.formatVersion} no compatible (se espera ${FORMAT_VERSION}).`)
  if (x.manifest.businessId !== businessId) errors.push('Este archivo es de OTRO negocio: no se puede restaurar aquí.')
  if (bodyHash(x) !== x.sha256) errors.push('El archivo está dañado o fue modificado: la huella de integridad no coincide.')
  if (typeof x.manifest.schemaVersion !== 'number' || x.manifest.schemaVersion > SCHEMA_VERSION) errors.push(`El archivo es de una versión más nueva (${x.manifest.schemaVersion}) que este sistema (${SCHEMA_VERSION}).`)
  const known = new Map(plan(db).map((t) => [t.name, t]))
  for (const [name, rows] of Object.entries(x.tables)) {
    if (EXCLUDED_TABLES.has(name)) { errors.push(`El archivo trae la tabla «${name}», que nunca se restaura.`); continue }
    const t = known.get(name)
    if (!t) { warnings.push(`La tabla «${name}» ya no existe en esta versión y se omite.`); continue }
    if (!Array.isArray(rows)) { errors.push(`La tabla «${name}» no es una lista.`); continue }
    if (x.manifest.counts?.[name] !== rows.length) errors.push(`La tabla «${name}» trae ${rows.length} renglones y el resumen dice ${x.manifest.counts?.[name] ?? 0}.`)
    if (t.cols.includes('business_id') && rows.some((r) => r.business_id !== businessId)) errors.push(`La tabla «${name}» trae renglones de otro negocio.`)
  }
  return { file: errors.length ? null : x, errors, warnings }
}

/**
 * Aplica (o simula) la restauración. Solo AGREGA lo que falta. Lo que ya existe no se toca:
 * si es igual cuenta como «ya está»; si cambió después del respaldo cuenta como «distinto» y se conserva lo actual.
 * Todo o nada: una sola transacción; si algo falla, no se carga nada. La simulación ejecuta lo mismo y lo deshace.
 */
export function restoreBusiness(db: Db, input: unknown, businessId: string, opts: { dryRun: boolean }): ImportReport {
  const v = validate(db, input, businessId)
  const report: ImportReport = { ok: false, errors: v.errors, warnings: v.warnings, sha256: (input as BusinessFile | undefined)?.sha256 ?? null, tables: {}, totals: { insert: 0, same: 0, differs: 0, skipped: 0 }, manifest: (input as BusinessFile | undefined)?.manifest ?? null }
  if (!v.file) return report
  const file = v.file
  try {
    db.transaction(() => {
      db.pragma('defer_foreign_keys = ON')
      for (const t of plan(db)) {
        const rows = file.tables[t.name]
        if (!rows?.length) continue
        const r = (report.tables[t.name] = { insert: 0, same: 0, differs: 0, skipped: 0 })
        const have = t.cols.filter((c) => c in rows[0]!)
        const hasBiz = t.cols.includes('business_id')
        for (const row of rows) {
          const cols = have.filter((c) => c in row)
          const where = (t.pk.length && t.pk.every((c) => c in row) ? t.pk : cols).map((c) => `"${c}" IS ?`).join(' AND ')
          const found = db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(',')}${hasBiz ? ', "business_id" AS __b' : ''} FROM "${t.name}" WHERE ${where}`).get(...(t.pk.length && t.pk.every((c) => c in row) ? t.pk : cols).map((c) => row[c] ?? null)) as Record<string, unknown> | undefined
          if (found) {
            if (hasBiz && found.__b !== businessId) { report.errors.push(`«${t.name}»: un identificador del archivo ya pertenece a otro negocio.`); continue }
            cols.every((c) => JSON.stringify(found[c] ?? null) === JSON.stringify(row[c] ?? null)) ? r.same++ : r.differs++
            continue
          }
          let omit = false
          for (const g of t.globalRefs) if (row[g.from] != null && !db.prepare(`SELECT 1 FROM "${g.table}" WHERE "${g.to}" = ?`).get(row[g.from])) { if (g.required) omit = true; else row[g.from] = null }
          if (omit) { r.skipped++; if (r.skipped <= 3) report.warnings.push(`«${t.name}»: un renglón se omitió porque el usuario de soporte que lo registró no existe en este servidor.`); continue }
          const ph = PLACEHOLDERS[t.name] ?? {}
          const names = [...new Set([...cols, ...Object.keys(ph)])]
          try {
            db.prepare(`INSERT INTO "${t.name}" (${names.map((c) => `"${c}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((c) => (c in ph ? ph[c] : row[c] ?? null)))
            r.insert++
          } catch (e) {
            r.skipped++
            if (r.skipped <= 3) report.warnings.push(`«${t.name}»: un renglón no se pudo agregar (${(e as Error).message.slice(0, 120)}).`)
          }
        }
      }
      const broken = db.pragma('foreign_key_check') as { table: string; parent: string }[]
      if (broken.length) report.errors.push(`Quedarían ${broken.length} referencias rotas (${[...new Set(broken.map((b) => `${b.table}→${b.parent}`))].slice(0, 5).join(', ')}): no se carga nada.`)
      for (const t of Object.values(report.tables)) for (const k of ['insert', 'same', 'differs', 'skipped'] as const) report.totals[k] += t[k]
      if (report.errors.length || opts.dryRun) throw new Rollback()
    })()
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  report.ok = report.errors.length === 0
  return report
}

// ---------------------------------------------------------------------------------------------------------------
// Respaldos automáticos por negocio
// ---------------------------------------------------------------------------------------------------------------

async function gzipText(text: string): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}

const businessBackupName = (businessId: string, t: Date, encrypted: boolean) => `negocio-${businessId}-${iso(t).slice(0, 16).replace(':', '-')}.json.gz${encrypted ? '.enc' : ''}`

/** Respalda UN negocio (archivo propio, comprimido y cifrado si hay llave) y deja constancia en la bitácora de respaldos. */
export async function backupBusiness(deps: Deps, businessId: string, kind: 'automatico' | 'manual', store?: BackupStore): Promise<{ id: string; name: string; bytes: number; sha256: string }> {
  const { db, now, backupKey } = deps
  const backups = store ?? deps.backups
  if (!backups) throw new AppError(409, 'sin_respaldos', 'Los respaldos no están configurados en este servidor.')
  const { encryptBackup } = await import('./backup.js')
  const id = newId(), t = now()
  try {
    const file = buildExport(db, businessId, t)
    const packed = await gzipText(JSON.stringify(file))
    const bytes = backupKey ? await encryptBackup(packed, backupKey) : packed
    const name = businessBackupName(businessId, t, !!backupKey)
    await backups.put(name, bytes)
    const sha = sha256Hex(bytes)
    db.prepare("INSERT INTO backup_log (id, business_id, kind, name, bytes, sha256, status, encrypted, created_at) VALUES (?,?,?,?,?,?,'ok',?,?)").run(id, businessId, kind, name, bytes.length, sha, backupKey ? 1 : 0, iso(t))
    return { id, name, bytes: bytes.length, sha256: sha }
  } catch (e) {
    db.prepare("INSERT INTO backup_log (id, business_id, kind, status, error, created_at) VALUES (?,?,?,'error',?,?)").run(id, businessId, kind, (e as Error).message.slice(0, 200), iso(t))
    recordError(deps, { source: 'respaldo', message: `Respaldo del negocio falló: ${(e as Error).message}`, businessId })
    throw e
  }
}

/** Respaldo automático de todos los negocios; uno que falle no detiene a los demás. Quita los de más de 30 días. */
export async function backupAllBusinesses(deps: Deps, store: BackupStore | undefined = deps.backups): Promise<{ ok: number; failed: number }> {
  const ids = (deps.db.prepare('SELECT id FROM businesses ORDER BY created_at').all() as { id: string }[]).map((b) => b.id)
  let ok = 0, failed = 0
  for (const id of ids) { try { await backupBusiness(deps, id, 'automatico', store); ok++ } catch { failed++ } }
  const cutoff = iso(new Date(deps.now().getTime() - 30 * 86_400_000)).slice(0, 10)
  for (const b of await store!.list()) { const d = b.name.match(/^negocio-.*-(\d{4}-\d{2}-\d{2})T/)?.[1]; if (d && d < cutoff) await store!.remove(b.name) }
  return { ok, failed }
}

async function openBackupFile(deps: Deps, logRow: { name: string; sha256: string; encrypted: number }): Promise<BusinessFile> {
  const bytes = await deps.backups?.get(logRow.name)
  if (!bytes) throw new AppError(404, 'no_encontrado', 'Ese respaldo ya no existe (se conservan 30 días).')
  if (sha256Hex(bytes) !== logRow.sha256) throw new AppError(409, 'respaldo_danado', 'El respaldo guardado no coincide con su huella: está dañado.')
  const { unpackBytes } = await import('./backup.js')
  return JSON.parse(new TextDecoder().decode(await unpackBytes(bytes, deps.backupKey))) as BusinessFile
}

// ---------------------------------------------------------------------------------------------------------------
// Rutas del dueño (solo de SU negocio: el identificador sale de la sesión, nunca de la petición)
// ---------------------------------------------------------------------------------------------------------------

export const datos = new Hono<Env>()
datos.use('/data/*', ownerOnly)

const MAX_FILE = 40 * 1024 * 1024

datos.get('/data/info', (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const last = db.prepare("SELECT created_at AS at, kind, sha256 FROM backup_log WHERE business_id = ? AND kind = 'exportacion' AND status = 'ok' ORDER BY created_at DESC LIMIT 1").get(u.business_id)
  const backups = db.prepare("SELECT id, kind, name, bytes, sha256, status, error, encrypted, created_at AS createdAt FROM backup_log WHERE business_id = ? AND kind IN ('automatico','manual') ORDER BY created_at DESC LIMIT 15").all(u.business_id)
  return c.json({
    formatVersion: FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, lastExport: last ?? null, backups,
    backupsEnabled: !!c.get('deps').backups, encrypted: !!c.get('deps').backupKey,
    importEnabled: flagOn(db, 'importar_respaldo', u.business_id),
    contains: currentCounts(db, u.business_id),
  })
})

datos.get('/data/export', async (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  const file = buildExport(deps.db, u.business_id, deps.now())
  const text = JSON.stringify(file)
  deps.db.prepare("INSERT INTO backup_log (id, business_id, kind, name, bytes, sha256, status, encrypted, created_at) VALUES (?,?,?,?,?,?,'ok',0,?)").run(newId(), u.business_id, 'exportacion', null, text.length, file.sha256, iso(deps.now()))
  audit(deps.db, deps.now, { businessId: u.business_id, userId: u.id, action: 'datos.exportar', newValue: { sha256: file.sha256, tables: Object.keys(file.tables).length, rows: Object.values(file.manifest.counts).reduce((a, b) => a + b, 0) } })
  const name = `nexora-${(file.manifest.businessName || 'negocio').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}-${file.manifest.exportedAt.slice(0, 10)}.json`
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } })
})

/** De dónde sale lo que se restaura: un archivo que sube el dueño o uno de los respaldos guardados de SU negocio. */
const source = z.object({ file: z.unknown().optional(), backupId: z.string().optional() })
async function sourceOf(c: Context<Env>, d: z.infer<typeof source>) {
  const deps = c.get('deps')
  const u = c.get('session').user
  if (!flagOn(deps.db, 'importar_respaldo', u.business_id)) throw new AppError(403, 'funcion_desactivada', 'La restauración está desactivada temporalmente. Escríbenos al buzón de soporte.')
  if (d.backupId) {
    const row = deps.db.prepare("SELECT name, sha256, encrypted FROM backup_log WHERE id = ? AND business_id = ? AND status = 'ok' AND name IS NOT NULL").get(d.backupId, u.business_id) as { name: string; sha256: string; encrypted: number } | undefined
    if (!row) throw new AppError(404, 'no_encontrado', 'No se encontró ese respaldo.')
    return openBackupFile(deps, row)
  }
  if (!d.file) throw new AppError(400, 'dato_no_valido', 'Elige un archivo de respaldo.')
  return d.file
}

datos.post('/data/import/preview', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(source, await body(c))
  const report = restoreBusiness(db, await sourceOf(c, d), u.business_id, { dryRun: true })
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'datos.simular_restauracion', newValue: { ok: report.ok, ...report.totals, errors: report.errors.length } })
  return c.json({ report })
})

datos.post('/data/import/confirm', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(source.extend({ confirm: z.literal('RESTAURAR'), sha256: z.string() }), await body(c))
  const input = await sourceOf(c, d)
  if ((input as BusinessFile).sha256 !== d.sha256) throw new AppError(409, 'cambio_el_archivo', 'El archivo no es el mismo que se simuló. Simula de nuevo antes de restaurar.')
  const sim = restoreBusiness(db, input, u.business_id, { dryRun: true })
  if (!sim.ok) return c.json({ report: sim }, 422)
  const report = restoreBusiness(db, input, u.business_id, { dryRun: false })
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'datos.restaurar', newValue: { sha256: d.sha256, ...report.totals, from: d.backupId ? 'respaldo' : 'archivo' } })
  return c.json({ report })
})

datos.post('/data/backups', async (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  const recent = deps.db.prepare("SELECT 1 FROM backup_log WHERE business_id = ? AND kind = 'manual' AND created_at > ?").get(u.business_id, iso(new Date(deps.now().getTime() - 5 * 60_000)))
  if (recent) throw new AppError(429, 'muy_seguido', 'Ya hiciste un respaldo hace menos de 5 minutos.')
  const r = await backupBusiness(deps, u.business_id, 'manual')
  audit(deps.db, deps.now, { businessId: u.business_id, userId: u.id, action: 'datos.respaldo_manual', newValue: { sha256: r.sha256, bytes: r.bytes } })
  return c.json({ backup: r }, 201)
})

datos.post('/data/backups/:id/verify', async (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  const row = deps.db.prepare("SELECT name, sha256, encrypted FROM backup_log WHERE id = ? AND business_id = ? AND status = 'ok' AND name IS NOT NULL").get(c.req.param('id'), u.business_id) as { name: string; sha256: string; encrypted: number } | undefined
  if (!row) throw new AppError(404, 'no_encontrado', 'No se encontró ese respaldo.')
  const file = await openBackupFile(deps, row)
  const valid = bodyHash(file) === file.sha256 && file.manifest.businessId === u.business_id
  return c.json({ valid, exportedAt: file.manifest.exportedAt, schemaVersion: file.manifest.schemaVersion, contains: file.manifest.counts })
})
