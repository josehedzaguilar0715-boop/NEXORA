// Respaldo en caliente de la base (no detiene el servidor): npm run backup -- [carpeta]
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const src = process.env.NEXORA_DB ?? 'data/nexora.db'
const dir = process.argv[2] ?? 'data/respaldos'
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dest = join(dir, `nexora-${stamp}.db`)
const db = new Database(src, { readonly: true })
await db.backup(dest)
db.close()
// Verificación: el respaldo se abre y pasa la revisión de integridad.
const check = new Database(dest, { readonly: true })
const ok = (check.pragma('integrity_check', { simple: true }) as string) === 'ok'
check.close()
if (!ok) {
  console.error(`El respaldo ${dest} no pasó la revisión de integridad.`)
  process.exit(1)
}
console.log(`Respaldo listo: ${dest}`)
