import { describe, expect, it } from 'vitest'
import { importAll } from '../src/backup.js'
import { openDb } from '../src/db-node.js'
import { DEMOS } from '../src/demo.js'
import { createApp } from '../src/app.js'
import { exportBusiness, GLOBAL_TABLES, unclassified } from '../src/partition.js'
import { setup } from './helpers.js'

/**
 * Base para crecer de 100 a 500 negocios: separar la base por negocio sin perder ni mezclar datos.
 * Con los 13 giros de demostración (datos de todo tipo): cada negocio se extrae completo, la suma de las
 * extracciones es exactamente la base, y un negocio extraído funciona igual en una base nueva.
 */
describe('separar la base por negocio', () => {
  it('toda tabla está clasificada (de un negocio o global)', () => {
    expect(unclassified(openDb(':memory:'))).toEqual([])
  })

  it('13 giros: las extracciones por negocio suman exactamente la base, sin repetidos; un negocio extraído funciona igual solo', async () => {
    const s = setup()
    const at = await s.adminToken()
    for (const d of DEMOS) expect((await s.call('POST', `/admin/demos/${d.giro}`, { token: at })).json.created, d.giro).toBe(true)
    const ids = (s.db.prepare('SELECT id FROM businesses').all() as { id: string }[]).map((r) => r.id)
    expect(ids.length).toBe(13)
    const tables = (s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name)
    const exports = ids.map((id) => exportBusiness(s.db, id))
    let checked = 0
    for (const t of tables) {
      if ((GLOBAL_TABLES as readonly string[]).includes(t)) continue
      const all = (s.db.prepare(`SELECT * FROM "${t}"`).all() as object[]).map((r) => JSON.stringify(r)).sort()
      // Renglones de la plataforma (bitácora del super panel, respaldos: business_id vacío) se quedan en la parte global.
      const cols = (s.db.pragma(`table_info("${t}")`) as { name: string }[]).map((c) => c.name)
      const platform = cols.includes('business_id') ? (s.db.prepare(`SELECT * FROM "${t}" WHERE business_id IS NULL`).all() as object[]).map((r) => JSON.stringify(r)) : []
      const parts = [...exports.flatMap((e) => (e.tables[t] ?? []).map((r) => JSON.stringify(r))), ...platform].sort()
      expect(parts, `${t}: lo extraído por negocio debe ser exactamente la tabla`).toEqual(all)
      checked += all.length
    }
    expect(checked).toBeGreaterThan(1000)

    // Cada negocio, solo en una base nueva: mismos reportes y su dueño entra igual.
    const login = async (app: ReturnType<typeof createApp>, phone: string) => {
      const r = await app.request('/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password: 'demo1234' }) })
      let j = (await r.json()) as any
      if (j.challengeId) j = await (await app.request('/auth/owner/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: j.challengeId, code: s.codes[phone] }) })).json()
      return j.token as string
    }
    const get = async (app: ReturnType<typeof createApp>, token: string, p: string) => (await (await app.request(p, { headers: { authorization: `Bearer ${token}` } })).json()) as any
    for (const [i, id] of ids.entries()) {
      const phone = (s.db.prepare("SELECT phone FROM users WHERE business_id = ? AND role = 'owner'").get(id) as { phone: string }).phone
      const solo = openDb(':memory:')
      const r = importAll(solo, exportBusiness(s.db, id, { withGlobals: true }))
      expect(r.rows, DEMOS[i]!.giro).toBeGreaterThan(20)
      const appSolo = createApp({ db: solo, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: (p: string, c: string) => void (s.codes[p] = c) } })
      const before = await get(s.app, await login(s.app, phone), '/reports/summary')
      const after = await get(appSolo, await login(appSolo, phone), '/reports/summary')
      expect(after, DEMOS[i]!.giro).toEqual(before)
      expect((solo.prepare('SELECT COUNT(*) n FROM businesses').get() as { n: number }).n).toBe(1)
    }
  }, 120_000)
})
