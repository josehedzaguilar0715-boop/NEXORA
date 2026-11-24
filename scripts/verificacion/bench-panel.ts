// Mide el costo de las pantallas más consultadas con una base grande (muchos negocios, meses de ventas).
// Uso: NEG=40 VENTAS=1500 npx tsx scripts/verificacion/bench-panel.ts [archivo.db]
// Con archivo: lo crea la primera vez y lo reutiliza (para comparar antes/después de un cambio).
import { existsSync } from 'node:fs'
import { createApp } from '../../src/app.js'
import { openDb } from '../../src/db-node.js'

const NEG = Number(process.env.NEG ?? 40), VENTAS = Number(process.env.VENTAS ?? 1500)
const file = process.argv[2] ?? ':memory:'
const fresh = file === ':memory:' || !existsSync(file)
const db = openDb(file)
const clock = { t: new Date('2026-09-01T15:00:00Z') }
const app = createApp({ db, now: () => new Date(clock.t), notifier: { sendCode: () => false, smsEnabled: false } })
const call = async (m: string, p: string, token?: string, body?: unknown) => {
  const r = await app.request(p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return (await r.json()) as any
}
let probe = ''
if (fresh) {
  console.time('preparar')
  const owners: { T: string; prods: string[] }[] = []
  for (let i = 0; i < NEG; i++) {
    const phone = '55' + String(10000000 + i)
    const r = await call('POST', '/auth/register', undefined, { businessName: `Negocio ${i}`, ownerName: 'Dueño', phone, password: 'secreto123' })
    const T = r.token
    await call('PATCH', '/business', T, { forcePasswordChange: false })
    const prods: string[] = []
    for (let k = 0; k < 15; k++) prods.push((await call('POST', '/products', T, { name: `P${k}`, unit: 'pieza', price: 1000 + k })).product.id)
    await call('POST', '/purchases', T, { payment: 'contado', items: prods.map((productId) => ({ productId, quantity: 1e6, cost: 5e8 })) })
    owners.push({ T, prods })
  }
  db.prepare("UPDATE businesses SET trial_ends_at = '2100-01-01T00:00:00.000Z'").run()
  // VENTAS por negocio, repartidas en ~85 días (sep → 24 nov), con un turno por día.
  const perDay = Math.ceil(VENTAS / 85)
  for (let d = 0; d < 85; d++) {
    clock.t = new Date(Date.parse('2026-09-01T15:00:00Z') + d * 86_400_000)
    db.prepare("UPDATE sessions SET expires_at = '2100-01-01T00:00:00.000Z'").run()
    for (const o of owners) {
      const cur = (await call('GET', '/shifts/current', o.T)).shift
      const sh = cur ? { shift: cur } : await call('POST', '/shifts/open', o.T, { openingFloat: 0 })
      for (let v = 0; v < perDay; v++) await call('POST', '/sales', o.T, { id: crypto.randomUUID(), paymentMethod: v % 3 ? 'efectivo' : 'tarjeta', items: [{ productId: o.prods[v % 15], quantity: 1 }, { productId: o.prods[(v * 7) % 15], quantity: 2 }] })
      const tot = (await call('GET', `/shifts/${sh.shift.id}`, o.T)).totals
      await call('POST', `/shifts/${sh.shift.id}/close`, o.T, { countedCash: tot?.expectedCash ?? 0 })
    }
  }
  console.timeEnd('preparar')
}
clock.t = new Date('2026-11-24T18:00:00Z')
db.prepare("UPDATE sessions SET expires_at = '2100-01-01T00:00:00.000Z'").run()
const tok = (db.prepare("SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.role = 'owner' LIMIT 1").get() as any)
// Sesión nueva para medir (los tokens no se guardan en claro).
const ownerPhone = (db.prepare("SELECT phone FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1").get() as any).phone
probe = (await call('POST', '/auth/owner/login', undefined, { phone: ownerPhone, password: 'secreto123' })).token
void tok
const total = (db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n
console.log(`base: ${NEG} negocios, ${total} ventas en total`)
const time = async (p: string, n = 15) => { const a: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); const r = await app.request(p, { headers: { authorization: `Bearer ${probe}` } }); await r.text(); a.push(performance.now() - t0) } a.sort((x, y) => x - y); return a[Math.floor(n / 2)]! }
for (const p of ['/dashboard/panel', '/reports/daily?days=7', '/reports/recent?limit=8', '/today', '/notifications', '/products', '/reports/summary'])
  console.log(`${p.padEnd(26)} mediana ${(await time(p)).toFixed(1)} ms`)
