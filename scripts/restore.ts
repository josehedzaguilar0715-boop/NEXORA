// Reconstruye una base SQLite completa a partir de un respaldo (.json.gz o .json).
// Uso: tsx scripts/restore.ts respaldo.json.gz nueva.db
import Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { openDb } from '../src/db-node.js'

const [src, dest] = process.argv.slice(2)
if (!src || !dest) throw new Error('Uso: tsx scripts/restore.ts <respaldo.json.gz> <nueva.db>')
if (existsSync(dest)) throw new Error(`${dest} ya existe; elige otro nombre (nunca se sobrescribe una base).`)
const raw = readFileSync(src)
const data = JSON.parse((src.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as { version: number; tables: Record<string, Record<string, unknown>[]> }
restore(data, dest)
console.log(`Base restaurada en ${dest} (respaldo versión ${data.version}).`)

export function restore(data: { version: number; tables: Record<string, Record<string, unknown>[]> }, path: string) {
  openDb(path) // crea el esquema completo con todas las migraciones
  const db = new Database(path)
  const current = (db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v
  if (data.version > current) throw new Error(`El respaldo es de una versión más nueva (${data.version}) que este código (${current}).`)
  db.pragma('foreign_keys = OFF')
  db.transaction(() => {
    for (const [table, rows] of Object.entries(data.tables)) {
      if (table === '_migrations' || !rows.length) continue
      const cols = Object.keys(rows[0]!)
      const stmt = db.prepare(`INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      for (const r of rows) stmt.run(...cols.map((c) => r[c] ?? null))
    }
  })()
  const broken = db.pragma('foreign_key_check') as unknown[]
  db.pragma('foreign_keys = ON')
  db.close()
  if (broken.length) throw new Error(`El respaldo tiene ${broken.length} referencias rotas.`)
}
