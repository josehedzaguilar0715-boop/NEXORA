import type { Deps } from './context.js'
import type { Db } from './db.js'
import { audit } from './audit.js'
import { iso } from './util.js'

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
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name)
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

const toBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function runBackup(deps: Deps, store: BackupStore, reason = 'automático') {
  const { db, now } = deps
  const t = now()
  const data = exportAll(db, t)
  const bytes = await gzip(JSON.stringify(data))
  const name = `nexora-${iso(t).slice(0, 16).replace(':', '-')}.json.gz`
  await store.put(name, bytes)
  // Se quitan los de más de 30 días.
  const cutoff = iso(new Date(t.getTime() - KEEP_DAYS * 86_400_000)).slice(0, 10)
  for (const b of await store.list()) if (b.name.slice(7, 17) < cutoff) await store.remove(b.name)
  // Copia fuera del servidor: al correo del super panel (si hay proveedor de correo).
  let emailed = 0
  if (deps.notifier.sendEmail) {
    const admins = db.prepare('SELECT email FROM admins WHERE active = 1 AND email IS NOT NULL').all() as { email: string }[]
    for (const a of admins) {
      const ok = await Promise.resolve(deps.notifier.sendEmail(a.email, `NEXORA · respaldo ${iso(t).slice(0, 10)}`, `Respaldo ${reason} de NEXORA (${(bytes.length / 1024).toFixed(0)} KB, comprimido). Guárdalo; sirve para recuperar la información.`, [{ filename: name, content: toBase64(bytes) }])).catch(() => false)
      if (ok !== false) emailed++
    }
  }
  audit(db, now, { businessId: null, userId: null, action: 'sistema.respaldo', newValue: { name, bytes: bytes.length, emailed, reason } })
  return { name, bytes: bytes.length, emailed }
}
