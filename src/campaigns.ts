import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { requireModule } from './common.js'
import { body, ownerOnly, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, conflict, iso, localDate, newId, notFound } from './util.js'

/**
 * Rifa o carrera de sellos (p. ej. Barbería Fénix): premios con cupo limitado para los primeros que junten N sellos.
 * - Gana quien llega primero a la meta (desde que empezó la rifa). Si varios llegan el mismo día, desempata
 *   quien tenga más faciales pagados o más productos comprados, según el premio.
 * - Cada persona gana un solo premio por rifa; si califica a varios, se le asigna el más alto.
 * - Al entregar el premio se descuentan los sellos de la meta (como un canje).
 */

export type Tiebreak = 'faciales' | 'productos' | 'ninguno'
interface Campaign { id: string; business_id: string; name: string; starts_at: string; active: number; created_at: string }
interface Prize { id: string; campaign_id: string; name: string; goal: number; quantity: number; tiebreak: Tiebreak; sort: number }

/** Momento en que cada cliente juntó por primera vez `goal` sellos desde el inicio de la rifa (con su saldo corriendo). */
function reachedAt(db: Db, businessId: string, startsAt: string, goals: number[]): Map<string, Map<number, string>> {
  const rows = db.prepare('SELECT customer_id, delta, created_at FROM loyalty_ledger WHERE business_id = ? ORDER BY created_at, rowid').all(businessId) as { customer_id: string; delta: number; created_at: string }[]
  const bal = new Map<string, number>()
  const out = new Map<string, Map<number, string>>()
  const mark = (cid: string, at: string) => {
    const b = bal.get(cid) ?? 0
    for (const g of goals) {
      if (b < g) continue
      const m = out.get(cid) ?? new Map<number, string>()
      if (!m.has(g)) m.set(g, at)
      out.set(cid, m)
    }
  }
  let started = false
  for (const r of rows) {
    // Lo que ya traían antes de la rifa cuenta como si lo hubieran juntado el día que empezó.
    if (!started && r.created_at >= startsAt) { started = true; for (const cid of bal.keys()) mark(cid, startsAt) }
    bal.set(r.customer_id, (bal.get(r.customer_id) ?? 0) + r.delta)
    if (started) mark(r.customer_id, r.created_at)
  }
  if (!started) for (const cid of bal.keys()) mark(cid, startsAt)
  return out
}

/** Faciales pagados y productos comprados por cliente (ventas no canceladas). */
function metrics(db: Db, businessId: string) {
  const fac = db.prepare(`SELECT s.customer_id c, COALESCE(SUM(i.quantity),0) n FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN services sv ON sv.id = i.service_id
    WHERE s.business_id = ? AND s.status = 'completada' AND s.customer_id IS NOT NULL AND (lower(i.description) LIKE '%facial%' OR lower(COALESCE(sv.category,'')) LIKE '%facial%') GROUP BY s.customer_id`).all(businessId) as { c: string; n: number }[]
  const prod = db.prepare(`SELECT s.customer_id c, COALESCE(SUM(i.quantity),0) n FROM sale_items i JOIN sales s ON s.id = i.sale_id
    WHERE s.business_id = ? AND s.status = 'completada' AND s.customer_id IS NOT NULL AND i.product_id IS NOT NULL GROUP BY s.customer_id`).all(businessId) as { c: string; n: number }[]
  return { faciales: new Map(fac.map((r) => [r.c, r.n])), productos: new Map(prod.map((r) => [r.c, r.n])) }
}

export interface Standing { customerId: string; name: string; reachedAt: string; day: string; score: number | null; status: 'ganador' | 'entregado' | 'en_espera' }

/** Tabla de cada premio: quién llegó, en qué orden, y quién gana (los lugares que quedan libres). */
export function standings(db: Db, campaignId: string) {
  const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as Campaign
  const prizes = db.prepare('SELECT * FROM campaign_prizes WHERE campaign_id = ? ORDER BY goal DESC, sort').all(c.id) as Prize[]
  const p = db.prepare('SELECT scope FROM loyalty_program WHERE business_id = ?').get(c.business_id) as { scope: string } | undefined
  const customers = new Map((db.prepare('SELECT id, name, loyalty_enrolled FROM customers WHERE business_id = ? AND active = 1').all(c.business_id) as { id: string; name: string; loyalty_enrolled: number }[])
    .filter((x) => p?.scope !== 'por_persona' || x.loyalty_enrolled).map((x) => [x.id, x.name]))
  const awards = db.prepare('SELECT prize_id, customer_id, delivered_at FROM campaign_awards WHERE campaign_id = ?').all(c.id) as { prize_id: string; customer_id: string; delivered_at: string }[]
  const awarded = new Set(awards.map((a) => a.customer_id))
  const reached = reachedAt(db, c.business_id, c.starts_at, [...new Set(prizes.map((x) => x.goal))])
  const m = metrics(db, c.business_id)
  const taken = new Set<string>() // ya ganan un premio más alto en esta rifa
  const result = prizes.map((pr) => {
    const delivered = awards.filter((a) => a.prize_id === pr.id)
    const list: Standing[] = delivered.map((a) => ({ customerId: a.customer_id, name: customers.get(a.customer_id) ?? 'Cliente', reachedAt: a.delivered_at, day: localDate(new Date(a.delivered_at)), score: null, status: 'entregado' }))
    const waiting = [...reached.entries()]
      .filter(([cid, g]) => g.has(pr.goal) && customers.has(cid) && !awarded.has(cid))
      .map(([cid, g]) => {
        const at = g.get(pr.goal)!
        const score = pr.tiebreak === 'ninguno' ? null : (pr.tiebreak === 'faciales' ? m.faciales : m.productos).get(cid) ?? 0
        return { customerId: cid, name: customers.get(cid)!, reachedAt: at, day: localDate(new Date(at)), score, status: 'en_espera' as Standing['status'] }
      })
      .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : (b.score ?? 0) - (a.score ?? 0) || (a.reachedAt < b.reachedAt ? -1 : 1)))
    let free = pr.quantity - delivered.length
    for (const w of waiting) {
      if (free > 0 && !taken.has(w.customerId)) { w.status = 'ganador'; taken.add(w.customerId); free-- }
    }
    list.push(...waiting.filter((w) => w.status === 'ganador'), ...waiting.filter((w) => w.status !== 'ganador' && !taken.has(w.customerId)))
    return { id: pr.id, name: pr.name, goal: pr.goal, quantity: pr.quantity, tiebreak: pr.tiebreak, remaining: pr.quantity - delivered.length, standings: list }
  })
  // Se muestran en el orden en que se capturaron (no por meta).
  const order = (db.prepare('SELECT id FROM campaign_prizes WHERE campaign_id = ? ORDER BY sort').all(c.id) as { id: string }[]).map((x) => x.id)
  result.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  return { id: c.id, name: c.name, startsAt: c.starts_at, active: !!c.active, prizes: result }
}

const activeCampaign = (db: Db, businessId: string) => db.prepare('SELECT id FROM campaigns WHERE business_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1').get(businessId) as { id: string } | undefined

export const campaigns = new Hono<Env>()

const prizeSchema = z.object({ name: z.string().trim().min(2).max(100), goal: z.number().int().min(1).max(1000), quantity: z.number().int().min(1).max(100), tiebreak: z.enum(['faciales', 'productos', 'ninguno']) })

campaigns.get('/campaigns', requireModule('fidelidad'), (c) => {
  const { db } = c.get('deps')
  const rows = db.prepare('SELECT id FROM campaigns WHERE business_id = ? ORDER BY active DESC, created_at DESC LIMIT 10').all(c.get('session').user.business_id) as { id: string }[]
  return c.json({ campaigns: rows.map((r) => standings(db, r.id)) })
})

campaigns.post('/campaigns', requireModule('fidelidad'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(100), startsAt: z.string().datetime().optional(), prizes: z.array(prizeSchema).min(1).max(10) }), await body(c))
  if (!db.prepare('SELECT 1 FROM loyalty_program WHERE business_id = ?').get(u.business_id)) throw bad('Primero configura la tarjeta de sellos.')
  if (activeCampaign(db, u.business_id)) throw conflict('Ya hay una rifa activa. Termínala antes de empezar otra.', 'rifa_activa')
  const id = newId()
  db.transaction(() => {
    db.prepare('INSERT INTO campaigns (id, business_id, name, starts_at, active, created_by, created_at) VALUES (?,?,?,?,1,?,?)').run(id, u.business_id, d.name, d.startsAt ?? iso(now()), u.id, iso(now()))
    d.prizes.forEach((p, i) => db.prepare('INSERT INTO campaign_prizes (id, campaign_id, name, goal, quantity, tiebreak, sort) VALUES (?,?,?,?,?,?,?)').run(newId(), id, p.name, p.goal, p.quantity, p.tiebreak, i))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'rifa.alta', entity: 'campaign', entityId: id, newValue: d })
  })()
  return c.json({ campaign: standings(db, id) }, 201)
})

campaigns.post('/campaigns/:id/end', requireModule('fidelidad'), ownerOnly, (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const r = db.prepare('UPDATE campaigns SET active = 0 WHERE id = ? AND business_id = ?').run(c.req.param('id'), u.business_id)
  if (!r.changes) throw notFound()
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'rifa.fin', entity: 'campaign', entityId: c.req.param('id') })
  return c.json({ ok: true })
})

/** Entregar el premio a un ganador: se descuentan los sellos de la meta y queda en bitácora. */
campaigns.post('/campaigns/:id/prizes/:prizeId/deliver', requireModule('fidelidad'), requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ customerId: z.string() }), await body(c))
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as Campaign | undefined
  if (!camp) throw notFound()
  return db.transaction(() => {
    const st = standings(db, camp.id).prizes.find((p) => p.id === c.req.param('prizeId'))
    if (!st) throw notFound('No se encontró ese premio.')
    const w = st.standings.find((s) => s.customerId === d.customerId)
    if (!w || w.status !== 'ganador') throw conflict(w?.status === 'entregado' ? 'Ya se le entregó.' : 'Este cliente no es ganador de ese premio.', 'no_ganador')
    db.prepare('INSERT INTO campaign_awards (id, campaign_id, prize_id, customer_id, delivered_by, delivered_at) VALUES (?,?,?,?,?,?)').run(newId(), camp.id, st.id, d.customerId, u.id, iso(now()))
    db.prepare("INSERT INTO loyalty_ledger (id, business_id, customer_id, delta, reason, created_by, created_at) VALUES (?,?,?,?,'rifa',?,?)").run(newId(), u.business_id, d.customerId, -st.goal, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'rifa.entrega', entity: 'customer', entityId: d.customerId, newValue: { premio: st.name, sellos: st.goal } })
    return c.json({ campaign: standings(db, camp.id) })
  })()
})

/** Lo que el cliente ve de la rifa en su tarjeta (sin datos de otros clientes, solo su lugar). */
export function campaignForCustomer(db: Db, businessId: string, customerId: string) {
  const a = activeCampaign(db, businessId)
  if (!a) return null
  const s = standings(db, a.id)
  return {
    name: s.name,
    prizes: s.prizes.map((p) => {
      const i = p.standings.findIndex((x) => x.customerId === customerId)
      const me = i >= 0 ? p.standings[i]! : null
      return { name: p.name, goal: p.goal, quantity: p.quantity, remaining: p.remaining, tiebreak: p.tiebreak, status: me?.status ?? null, place: me ? i + 1 : null }
    }),
  }
}

export const publicCampaigns = new Hono<Env>()
publicCampaigns.get('/public/loyalty/:code/campaign', (c) => {
  const { db } = c.get('deps')
  const cu = db.prepare('SELECT id, business_id FROM customers WHERE code = ? AND active = 1').get(c.req.param('code').toUpperCase()) as { id: string; business_id: string } | undefined
  if (!cu) throw notFound()
  return c.json({ campaign: campaignForCustomer(db, cu.business_id, cu.id) })
})
