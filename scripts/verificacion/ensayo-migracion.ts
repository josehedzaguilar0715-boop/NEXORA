// Ensayo de migración sobre una COPIA de producción (esquema anterior), en un entorno aislado. No toca ninguna base real y no imprime datos privados (solo cifras).
// 1. Fotografía de cada tabla (filas y huella de contenido) en el esquema anterior.
// 2. Migra con el código candidato (migraciones nuevas) y compara: nada existente cambia (filas ni valores).
// 3. Revisa lo nuevo (plan anterior por negocio, usuarios sin administradores, columnas nuevas vacías), integridad y llaves foráneas.
// 4. Repite la apertura (debe ser idempotente) y recorre la API real por negocio y por puesto con sesiones creadas SOLO en la copia.
// Uso: npx tsx scripts/verificacion/ensayo-migracion.ts <copia-esquema-anterior.db>   (trabaja sobre una copia propia: <db>.migrado)
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { createApp } from '../../src/app.js'
import { SCHEMA_VERSION } from '../../src/db.js'
import { openDb } from '../../src/db-node.js'
import { sha256 } from '../../src/util.js'

const src = process.argv[2]
if (!src) throw new Error('Uso: tsx scripts/verificacion/ensayo-migracion.ts <copia.db>')
const dest = `${src}.migrado`
if (existsSync(dest)) unlinkSync(dest)
copyFileSync(src, dest)
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }

type Snap = Record<string, { cols: string[]; n: number; hash: string; rows: Map<string, string> }>
function snapshot(path: string): Snap {
  const db = new Database(path, { readonly: true })
  const out: Snap = {}
  for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all() as { name: string }[]) {
    const cols = (db.pragma(`table_info("${t.name}")`) as { name: string }[]).map((c) => c.name)
    const rows = db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all() as Record<string, unknown>[]
    out[t.name] = { cols, n: rows.length, hash: '', rows: new Map(rows.map((r, i) => [String(i), JSON.stringify(cols.map((c) => r[c]))])) }
    out[t.name]!.hash = createHash('sha256').update([...out[t.name]!.rows.values()].join('\n')).digest('hex')
  }
  db.close()
  return out
}

const antes = snapshot(src)
const nAntes = Object.values(antes).reduce((a, t) => a + t.n, 0)
const verAntes = (() => { const d = new Database(src, { readonly: true }); const v = (d.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v; d.close(); return v })()
console.log(`Copia: esquema ${verAntes}, ${Object.keys(antes).length} tablas, ${nAntes} renglones.`)

// ---- migrar con el código candidato
let db = openDb(dest)
const ver = (db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v
ok(ver === SCHEMA_VERSION && ver > verAntes, `migrado de ${verAntes} a ${ver} (código: ${SCHEMA_VERSION})`)
;(db as unknown as { close?: () => void }).close?.()

// ---- nada existente cambió: mismas filas y mismos valores en las columnas que ya existían
const despues = snapshot(dest)
let perdidas = 0, cambiadas = 0
for (const [t, a] of Object.entries(antes)) {
  const d = despues[t]
  if (!d) { perdidas++; console.log(`  tabla perdida: ${t}`); continue }
  // El registro de migraciones SÍ crece (una fila por migración nueva): las anteriores deben seguir idénticas.
  if (t === '_migrations') { const nuevas = d.n - a.n; if (nuevas !== SCHEMA_VERSION - verAntes || [...a.rows].some(([i, r]) => d.rows.get(i) !== r)) { perdidas++; console.log('  _migrations inesperado') } continue }
  if (d.n !== a.n) { perdidas++; console.log(`  ${t}: ${a.n} → ${d.n} renglones`); continue }
  const idx = a.cols.map((c) => d.cols.indexOf(c))
  if (idx.some((i) => i < 0)) { perdidas++; console.log(`  ${t}: columna perdida`); continue }
  for (const [i, r] of a.rows) {
    const nuevo = JSON.parse(d.rows.get(i)!) as unknown[]
    if (JSON.stringify(idx.map((k) => nuevo[k])) !== r) { cambiadas++; console.log(`  ${t}: renglón ${i} cambió`); break }
  }
}
ok(perdidas === 0, `ninguna tabla, columna ni renglón se perdió (${Object.keys(antes).length} tablas, ${nAntes} renglones)`)
ok(cambiadas === 0, 'ningún valor existente cambió (huella de cada renglón, tabla por tabla)')

// ---- lo nuevo
const raw = new Database(dest)
const q = <T,>(sql: string, ...a: unknown[]) => raw.prepare(sql).get(...a) as T
const negocios = q<{ n: number }>('SELECT COUNT(*) n FROM businesses').n
ok(q<{ n: number }>('SELECT COUNT(*) n FROM distribution_plans WHERE legacy = 1 AND active = 0').n === negocios, `«Plan anterior» histórico e inactivo en cada uno de los ${negocios} negocios`)
ok(q<{ n: number }>('SELECT COUNT(*) n FROM distribution_plans').n === negocios, 'ningún otro reparto activo ni impuesto')
ok(q<{ n: number }>('SELECT COUNT(*) n FROM users WHERE admin_authorized <> 0').n === 0, 'ningún usuario pasó a administrador (puestos y permisos intactos)')
ok(['owner_withdrawals', 'balance_entries'].every((t) => q<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`).n === 0), 'retiros y saldos empiezan vacíos (nada inventado)')
ok(q<{ n: number }>('SELECT COUNT(*) n FROM appointments WHERE completed_at IS NOT NULL OR reminded_at IS NOT NULL').n === 0 && q<{ n: number }>('SELECT COUNT(*) n FROM sales WHERE receipt_token IS NOT NULL').n === 0 && q<{ n: number }>('SELECT COUNT(*) n FROM sale_items WHERE staff_id IS NOT NULL').n === 0, 'columnas nuevas de citas, ventas y renglones vacías (histórico intacto)')
ok(q<{ integrity_check: string }>('PRAGMA integrity_check').integrity_check === 'ok', 'integridad de la base: ok')
ok((raw.pragma('foreign_key_check') as unknown[]).length === 0, 'llaves foráneas: 0 referencias rotas')
const plan = raw.prepare("SELECT items FROM distribution_plans LIMIT 1").get() as { items: string }
ok(Array.isArray(JSON.parse(plan.items)) && JSON.parse(plan.items).length === 3, 'el plan anterior conserva sus 3 partidas')
raw.close()

// ---- idempotencia: abrir de nuevo no cambia nada
db = openDb(dest)
;(db as unknown as { close?: () => void }).close?.()
const otra = snapshot(dest)
ok(Object.keys(despues).every((t) => despues[t]!.hash === otra[t]?.hash), 'volver a abrir (volver a migrar) es idempotente: ninguna tabla cambia')

// ---- recorrido de la API real con sesiones creadas SOLO en la copia
db = openDb(dest)
const app = createApp({ db, now: () => new Date(), notifier: { sendCode: () => false, smsEnabled: false } })
const exp = new Date(Date.now() + 3_600_000).toISOString()
const tokenOf = (u: string) => { const t = `ens-${u}`; db.prepare('INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)').run(`ens-${u}`, u, sha256(t), exp, exp, exp); return t }
const get = async (t: string, p: string) => (await app.request(p, { headers: { authorization: `Bearer ${t}` } })).status
const FIN = ['/dashboard/panel', '/reports/summary', '/finanzas/resumen', '/finanzas/planes', '/finanzas/saldos', '/finanzas/retiros', '/accounting/balance', '/expenses']
const OPER = ['/auth/me', '/products', '/sales', '/customers', '/shifts/current', '/dashboard/mine', '/modules']
let negociosOk = 0, usuariosProbados = 0, malos: string[] = []
const owners = db.prepare("SELECT id, business_id FROM users WHERE role = 'owner' AND active = 1").all() as { id: string; business_id: string }[]
for (const o of owners) {
  const t = tokenOf(o.id)
  const e = [...(await Promise.all(FIN.map(async (p) => [p, await get(t, p)] as const))), ...(await Promise.all(OPER.map(async (p) => [p, await get(t, p)] as const)))].filter(([, s]) => s !== 200)
  const giro = (db.prepare('SELECT giro FROM businesses WHERE id = ?').get(o.business_id) as { giro: string }).giro
  const extra = ['barberia', 'unas'].includes(giro) ? ['/auto/servicios', '/auto/clientes', '/agenda/to-charge'] : ['abarrotes', 'ferreteria', 'papeleria', 'perfumeria', 'verduleria'].includes(giro) ? ['/auto/productos', '/inventory/replenishment'] : ['restaurante', 'taqueria', 'comedor', 'palapa'].includes(giro) ? ['/auto/platillos'] : []
  for (const p of extra) { const s = await get(t, p); if (s !== 200) e.push([p, s]) }
  if (!e.length) negociosOk++; else malos.push(`${giro}: ${e.map(([p, s]) => `${p}=${s}`).join(' ')}`)
  usuariosProbados++
}
ok(negociosOk === owners.length, `dueño de cada negocio: ${negociosOk}/${owners.length} recorren Finanzas, panel, ventas, productos, clientes y automatizaciones de su giro sin error${malos.length ? ' → ' + malos.join(' | ') : ''}`)
// Personal: ningún encargado ni empleado entra a finanzas; sí a lo operativo.
const staff = db.prepare("SELECT id, name FROM users WHERE role = 'staff' AND active = 1").all() as { id: string }[]
let finBloqueado = 0, operOk = 0, filtrado = 0
for (const u of staff) {
  const t = tokenOf(u.id)
  const f = await Promise.all(FIN.map((p) => get(t, p)))
  if (f.every((s) => s === 403)) finBloqueado++
  if ((await get(t, '/auth/me')) === 200) operOk++
  const me = await (await app.request('/auth/me', { headers: { authorization: `Bearer ${t}` } })).json() as { access?: Record<string, boolean>; user: { position: string } }
  if (me.access && !me.access.dashboard && !me.access.finance && !me.access.manage) filtrado++
  usuariosProbados++
}
ok(finBloqueado === staff.length, `personal (encargados y empleados): ${finBloqueado}/${staff.length} reciben 403 en panel y finanzas`)
ok(operOk === staff.length && filtrado === staff.length, `personal: ${operOk}/${staff.length} siguen entrando; acceso financiero cerrado en ${filtrado}/${staff.length}`)
// Cifras históricas: ventas por negocio iguales antes y después.
const ventas = (path: string) => { const d = new Database(path, { readonly: true }); const r = d.prepare('SELECT business_id, COUNT(*) n, SUM(total) t FROM sales GROUP BY business_id ORDER BY business_id').all(); d.close(); return JSON.stringify(r) }
ok(ventas(src) === ventas(dest), 'ventas por negocio (cantidad y total) idénticas antes y después')
// Finanzas: el «disponible» coincide con la fórmula anterior (sin saldos registrados).
const { saldos } = await import('../../src/finanzas.js')
const { cashFlow } = await import('../../src/accounting.js')
let dispOk = 0
for (const o of owners) { const hoy = new Date().toISOString().slice(0, 10); const s = saldos(db, o.business_id, hoy); const f = cashFlow(db, o.business_id, '2000-01-01', hoy); if (s.total === f.net) dispOk++ }
ok(dispOk === owners.length, `«dinero disponible» = flujo registrado (fórmula anterior) en ${dispOk}/${owners.length} negocios`)
;(db as unknown as { close?: () => void }).close?.()
console.log(`\nUsuarios probados con sesión de la copia: ${usuariosProbados}.`)
console.log(fails ? `\n${fails} FALLAS` : '\nEnsayo de migración: TODO EN ORDEN')
process.exit(fails ? 1 : 0)
