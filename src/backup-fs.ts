import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupStore } from './backup.js'

/** Respaldos en una carpeta local (servidor Node). */
export function fsBackupStore(dir: string): BackupStore {
  mkdirSync(dir, { recursive: true })
  const safe = (n: string) => join(dir, n.replace(/[^\w.-]/g, ''))
  return {
    async put(name, bytes) { writeFileSync(safe(name), bytes) },
    async list() { return readdirSync(dir).filter((n) => n.endsWith('.json.gz')).map((name) => ({ name, size: statSync(join(dir, name)).size })) },
    async get(name) { try { return new Uint8Array(readFileSync(safe(name))) } catch { return null } },
    async remove(name) { rmSync(safe(name), { force: true }) },
  }
}

/** Milisegundos hasta la próxima hora indicada (hora del centro de México, UTC−6). */
export function msUntilLocal(hour: number, minute: number, now = new Date()): number {
  const next = new Date(now)
  next.setUTCHours(hour + 6, minute, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}
