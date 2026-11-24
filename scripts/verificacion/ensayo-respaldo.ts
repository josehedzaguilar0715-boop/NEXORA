// Ensayo de recuperación en un entorno aislado a partir de un respaldo (.json.gz, o .enc con NEXORA_BACKUP_KEY).
// NO toca ninguna base real: todo ocurre en una carpeta nueva. No imprime datos de clientes, solo cifras.
//  1. Restaura el respaldo completo en una base nueva y revisa integridad y referencias.
//  2. Lleva esa copia a la «versión anterior» y la deja migrar en el sitio con el código actual: ningún dato cambia.
//  3. Exporta cada negocio y lo restaura en una base vacía: debe quedar idéntico (renglón por renglón, sin secretos).
// Uso: npx tsx scripts/verificacion/ensayo-respaldo.ts <respaldo.json.gz> <carpeta-nueva>
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { buildExport, restoreBusiness } from '../../src/datos.js'
import { openDb } from '../../src/db-node.js'
import { healthReport } from '../../src/monitor.js'

const [src, dir] = process.argv.slice(2)
if (!src || !dir) throw new Error('Uso: tsx scripts/verificacion/ensayo-respaldo.ts <respaldo> <carpeta-nueva>')
mkdirSync(dir, { recursive: true })
execFileSync('npx', ['tsx', 'scripts/restore.ts', src, `${dir}/copia.db`], { stdio: 'inherit' })

copyFileSync(`${dir}/copia.db`, `${dir}/anterior.db`)
{
  const raw = new Database(`${dir}/anterior.db`)
  raw.pragma('journal_mode = DELETE')
  raw.exec('DELETE FROM _migrations WHERE version IN (41,42); ALTER TABLE users DROP COLUMN position; DROP TABLE backup_log; DROP TABLE error_log; DROP TABLE feature_flags;')
  raw.close()
}
const before = new Database(`${dir}/anterior.db`, { readonly: true })
const tables = (before.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name)
const cnt = (d: { prepare(s: string): { get(): unknown } }) => Object.fromEntries(tables.map((t) => [t, (d.prepare(`SELECT COUNT(*) n FROM "${t}"`).get() as { n: number }).n]))
const c0 = cnt(before)
before.close()
const db = openDb(`${dir}/anterior.db`)
const c1 = cnt(db)
const changed = tables.filter((t) => t !== '_migrations' && c0[t] !== c1[t])
console.log(`Migración en el sitio → versión ${(db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v} · integridad: ${db.pragma('integrity_check', { simple: true })} · referencias rotas: ${(db.pragma('foreign_key_check') as unknown[]).length} · tablas con distinto número de filas: ${changed.length ? changed.join(',') : 'ninguna'}`)
console.log(`Contenido: ${c1.businesses} negocios, ${c1.users} usuarios, ${c1.sales} ventas, ${c1.shifts} turnos, ${c1.products} productos`)

const sorted = (t: Record<string, Record<string, unknown>[]>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map((r) => JSON.stringify(k === 'users' ? { ...r, must_change_password: 0 } : r)).sort()]))
let all = true, n = 0
for (const { id } of db.prepare('SELECT id FROM businesses ORDER BY created_at').all() as { id: string }[]) {
  n++
  const a = buildExport(db, id, new Date())
  const B = openDb(':memory:')
  // Misma plataforma: el super panel (usuarios de soporte) existe en el destino, como en la vida real.
  for (const r of db.prepare('SELECT * FROM admins').all() as Record<string, unknown>[]) { const c = Object.keys(r); B.prepare(`INSERT OR IGNORE INTO admins (${c.join(',')}) VALUES (${c.map(() => '?').join(',')})`).run(...c.map((k) => r[k])) }
  const rep = restoreBusiness(B, a, id, { dryRun: false })
  if (!rep.ok) { all = false; console.log(`negocio #${n}: NO se pudo restaurar: ${rep.errors.join(' | ').slice(0, 300)}`); continue }
  const b = buildExport(B, id, new Date())
  const same = JSON.stringify(sorted(a.tables)) === JSON.stringify(sorted(b.tables))
  const sum = (d: typeof db, where: string, ...p: unknown[]) => JSON.stringify(['sales', 'stock_movements', 'credit_ledger', 'expenses'].map((t) => (d.prepare(`SELECT COALESCE(SUM(${t === 'sales' ? 'total' : t === 'stock_movements' ? 'qty_milli' : t === 'credit_ledger' ? 'delta' : 'amount'}),0) v FROM ${t} ${where}`).get(...p) as { v: number }).v))
  const money = sum(db, 'WHERE business_id = ?', id) === sum(B, '')
  const fk = (B.pragma('foreign_key_check') as unknown[]).length
  const clean = !JSON.stringify(a).match(/s1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/)
  if (!(same && money && fk === 0 && clean)) all = false
  console.log(`negocio #${n}: ${Object.values(a.manifest.counts).reduce((x, y) => x + y, 0)} filas en ${Object.keys(a.tables).length} tablas · idéntico=${same} · ventas/inventario/fiado/gastos iguales=${money} · referencias rotas=${fk} · sin secretos=${clean}`)
}
const h = healthReport({ db, now: () => new Date(), notifier: { sendCode() {} } } as never)
console.log(`Salud sobre la copia: ${h.status} · ventas con total≠pagos (7 días): ${h.sales.paymentMismatch7d}`)
console.log(all && changed.length === 0 ? 'RESULTADO: TODO CORRECTO' : 'RESULTADO: HAY DIFERENCIAS')
process.exit(all && changed.length === 0 ? 0 : 1)
