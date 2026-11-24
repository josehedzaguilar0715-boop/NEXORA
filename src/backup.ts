import type { Deps } from './context.js'
import type { Db } from './db.js'
import { audit } from './audit.js'
import { iso, newId } from './util.js'
import { backupAllBusinesses } from './datos.js'
import { recordError } from './monitor.js'

/**
 * Respaldos automáticos: toda la base, comprimida, una vez al día. Se guardan 30 días
 * (Cloudflare KV en la nube, carpeta data/respaldos en local) y, si hay correo configurado,
 * se envían al correo del super panel, fuera del servidor.
 */
export interface BackupStore {
  put(name: string, bytes: Uint8Array): Promise<void>
  list(): Promise<{ name: string; size: number }[]>
  get(name: string): Promise<Uint8Array | null>
  remove(name: string): Promise<void>
}

export const KEEP_DAYS = 30

/** Todas las tablas de la base (respaldo completo). */
export function exportAll(db: Db, now: Date) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '!_!_%' ESCAPE '!' ORDER BY name").all() as { name: string }[]).map((t) => t.name)
  return {
    exportedAt: iso(now),
    version: (db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v,
    tables: Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all()])),
  }
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Cifrado de respaldos (AES-256-GCM). Formato: «NXE1» + 12 bytes de IV + datos cifrados.
 * El respaldo tiene contraseñas (con hash), teléfonos y ventas: si alguien obtiene el archivo sin la llave, no le sirve.
 */
const MAGIC = new TextEncoder().encode('NXE1')
async function keyFrom(b64: string) {
  const raw = Uint8Array.from(atob(b64.trim()), (ch) => ch.charCodeAt(0))
  if (raw.length !== 32) throw new Error('BACKUP_KEY debe ser de 32 bytes en base64 (openssl rand -base64 32).')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function encryptBackup(bytes: Uint8Array, keyB64: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(keyB64), new Uint8Array(bytes)))
  const out = new Uint8Array(4 + 12 + ct.length)
  out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16)
  return out
}
export const isEncrypted = (bytes: Uint8Array) => bytes.length > 16 && MAGIC.every((b, i) => bytes[i] === b)
export async function decryptBackup(bytes: Uint8Array, keyB64: string): Promise<Uint8Array> {
  if (!isEncrypted(bytes)) return bytes
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(bytes.subarray(4, 16)) }, await keyFrom(keyB64), new Uint8Array(bytes.subarray(16))))
}

/** Huella de la llave (12 caracteres): permite confirmar QUÉ llave está activa sin mostrarla. */
export async function keyFingerprint(keyB64: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyB64.trim()), (ch) => ch.charCodeAt(0))
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
  return [...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
}

type BackupData = { version: number; tables: Record<string, Record<string, unknown>[]> }

/** Quita el cifrado y la compresión de un respaldo y devuelve sus bytes. */
export async function unpackBytes(bytes: Uint8Array, keyB64?: string): Promise<Uint8Array> {
  let b = bytes
  if (isEncrypted(b)) {
    if (!keyB64) throw new Error('Este respaldo está cifrado y no hay llave (BACKUP_KEY).')
    b = await decryptBackup(b, keyB64)
  }
  if (b[0] === 0x1f && b[1] === 0x8b) b = new Uint8Array(await new Response(new Blob([new Uint8Array(b)]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  return b
}

/** Abre un respaldo (cifrado o no, comprimido o no) y devuelve su contenido. */
export async function readBackup(bytes: Uint8Array, keyB64?: string): Promise<BackupData> {
  const b = await unpackBytes(bytes, keyB64)
  const data = JSON.parse(new TextDecoder().decode(b)) as BackupData
  if (typeof data.version !== 'number' || !data.tables || typeof data.tables !== 'object') throw new Error('El archivo no es un respaldo de NEXORA.')
  return data
}

/**
 * Carga un respaldo completo en una base **vacía** (sin negocios). Nunca mezcla ni sobrescribe datos existentes:
 * es para recuperar en un objeto nuevo o ensayar la recuperación. Todo o nada (una transacción).
 */
export function importAll(db: Db, data: BackupData): { tables: number; rows: number } {
  const current = (db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v
  if (data.version > current) throw new Error(`El respaldo es de una versión más nueva (${data.version}) que este código (${current}).`)
  const n = (db.prepare('SELECT COUNT(*) n FROM businesses').get() as { n: number }).n
  if (n > 0) throw new Error(`Esta base ya tiene ${n} negocios: solo se restaura en una base vacía, para no mezclar ni sobrescribir datos.`)
  const known = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
  let tables = 0, rows = 0
  db.transaction(() => {
    // Las referencias entre tablas se revisan al final (el respaldo viene en orden alfabético).
    db.pragma('defer_foreign_keys = ON')
    for (const [table, list] of Object.entries(data.tables)) {
      if (table === '_migrations' || !list.length || !known.has(table)) continue
      const cols = Object.keys(list[0]!)
      const stmt = db.prepare(`INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      for (const r of list) stmt.run(...cols.map((c) => r[c] ?? null))
      tables++; rows += list.length
    }
    // Si el objeto nuevo creó su usuario de soporte al arrancar y el respaldo trae uno con el mismo nombre,
    // el del respaldo lo reemplaza: las sesiones y códigos de acceso de ese usuario reemplazado (del objeto
    // vacío, no de ningún negocio) quedan sin dueño y se quitan. Hay que volver a entrar al super panel.
    db.prepare('DELETE FROM admin_sessions WHERE admin_id NOT IN (SELECT id FROM admins)').run()
    db.prepare('DELETE FROM admin_challenges WHERE admin_id NOT IN (SELECT id FROM admins)').run()
    const broken = db.pragma('foreign_key_check') as { table: string; parent: string }[]
    if (broken.length) throw new Error(`El respaldo tiene ${broken.length} referencias rotas (${[...new Set(broken.map((b) => `${b.table}→${b.parent}`))].join(', ')}); no se cargó nada.`)
  })()
  return { tables, rows }
}

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function runBackup(deps: Deps, store: BackupStore, reason = 'automático') {
  const { db, now } = deps
  const t = now()
  try {
    const r = await runWholeBackup(deps, store, reason, t)
    db.prepare("INSERT INTO backup_log (id, business_id, kind, name, bytes, status, encrypted, created_at) VALUES (?,?,?,?,?,'ok',?,?)").run(newId(), null, 'completo', r.name, r.bytes, deps.backupKey ? 1 : 0, iso(t))
    // Además, un archivo propio por negocio (sirve para exportar y restaurar a UN negocio sin tocar a los demás).
    const perBusiness = await backupAllBusinesses(deps, store)
    return { ...r, perBusiness }
  } catch (e) {
    db.prepare("INSERT INTO backup_log (id, business_id, kind, status, error, created_at) VALUES (?,?,?,'error',?,?)").run(newId(), null, 'completo', (e as Error).message.slice(0, 200), iso(t))
    recordError(deps, { source: 'respaldo', message: `Respaldo completo falló: ${(e as Error).message}` })
    throw e
  }
}

async function runWholeBackup(deps: Deps, store: BackupStore, reason: string, t: Date) {
  const { db, now } = deps
  const data = exportAll(db, t)
  const packed = await gzip(JSON.stringify(data))
  const bytes = deps.backupKey ? await encryptBackup(packed, deps.backupKey) : packed
  const name = `nexora-${iso(t).slice(0, 16).replace(':', '-')}.json.gz${deps.backupKey ? '.enc' : ''}`
  await store.put(name, bytes)
  // Se quitan los de más de 30 días.
  const cutoff = iso(new Date(t.getTime() - KEEP_DAYS * 86_400_000)).slice(0, 10)
  for (const b of await store.list()) if (b.name.startsWith('nexora-') && b.name.slice(7, 17) < cutoff) await store.remove(b.name)
  // Copia fuera del servidor: al correo del super panel (si hay proveedor de correo).
  let emailed = 0
  if (deps.notifier.sendEmail) {
    const admins = db.prepare('SELECT email FROM admins WHERE active = 1 AND email IS NOT NULL').all() as { email: string }[]
    for (const a of admins) {
      const ok = await Promise.resolve(deps.notifier.sendEmail(a.email, `NEXORA · respaldo ${iso(t).slice(0, 10)}`, `Respaldo ${reason} de NEXORA (${(bytes.length / 1024).toFixed(0)} KB, comprimido${deps.backupKey ? ' y cifrado: solo se abre con la llave BACKUP_KEY' : ''}). Guárdalo; sirve para recuperar la información.`, [{ filename: name, content: toBase64(bytes) }])).catch(() => false)
      if (ok !== false) emailed++
    }
  }
  audit(db, now, { businessId: null, userId: null, action: 'sistema.respaldo', newValue: { name, bytes: bytes.length, emailed, reason, encrypted: !!deps.backupKey, ...(deps.backupKey ? { keyFingerprint: await keyFingerprint(deps.backupKey) } : {}) } })
  return { name, bytes: bytes.length, emailed }
}
