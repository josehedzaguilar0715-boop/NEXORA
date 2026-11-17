import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { shiftCloseValidators } from './cash.js'
import { body, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { addLot, consume, currentPrice, fromMilli, getProduct, toMilli } from './inventory.js'
import { AppError, bad, conflict, iso, newId, notFound } from './util.js'

/** Taquería: carne del trompo o asada y costo por taco según su receta. */
export const taqueria = new Hono<Env>()

/** Lo vendido de esa carne desde que se empezó: recetas de tacos (consumo) y venta directa por kilo. */
function soldSince(db: Db, branchId: string, productId: string, since: string, until: string) {
  const r = db.prepare("SELECT COALESCE(SUM(qty_milli),0) q FROM stock_movements WHERE branch_id = ? AND product_id = ? AND type IN ('consumo','venta','cancelacion') AND created_at >= ? AND created_at <= ?").get(branchId, productId, since, until) as { q: number }
  return -r.q
}

shiftCloseValidators.push(({ db, shiftId }) => {
  const open = db.prepare('SELECT COUNT(*) n FROM meat_batches WHERE shift_id = ? AND closed_at IS NULL').get(shiftId) as { n: number }
  if (open.n) throw new AppError(409, 'trompo_abierto', 'Antes del corte cuenta el sobrante de carne.')
})

taqueria.post('/meat/batches', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ productId: z.string(), kg: z.number().positive().max(500) }), await body(c))
  const p = getProduct(db, u.business_id, d.productId)
  if (p.unit !== 'kg') throw bad('La carne se registra por kilo.')
  const shift = db.prepare("SELECT id, branch_id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string; branch_id: string } | undefined
  if (!shift) throw conflict('Abre tu caja para empezar el trompo.', 'caja_cerrada')
  if (db.prepare('SELECT 1 FROM meat_batches WHERE branch_id = ? AND product_id = ? AND closed_at IS NULL').get(shift.branch_id, p.id)) throw conflict(`Ya hay ${p.name} en curso. Ciérralo antes de empezar otro.`, 'trompo_abierto')
  const id = newId()
  db.prepare('INSERT INTO meat_batches (id, business_id, branch_id, product_id, shift_id, started_milli, started_at, started_by) VALUES (?,?,?,?,?,?,?,?)').run(id, u.business_id, shift.branch_id, p.id, shift.id, toMilli(d.kg), iso(now()), u.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'taqueria.carne_inicio', entity: 'meat_batch', entityId: id, newValue: { product: p.name, kg: d.kg } })
  return c.json({ id }, 201)
})

taqueria.get('/meat/batches', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const rows = db.prepare('SELECT b.*, p.name FROM meat_batches b JOIN products p ON p.id = b.product_id WHERE b.business_id = ? AND (b.closed_at IS NULL OR b.closed_at >= ?) ORDER BY b.started_at DESC').all(u.business_id, new Date(now().getTime() - 86_400_000).toISOString()) as { id: string; name: string; branch_id: string; product_id: string; started_milli: number; started_at: string; closed_at: string | null; sold_milli: number | null; expected_milli: number | null; counted_milli: number | null; difference_milli: number | null }[]
  return c.json({
    batches: rows.map((b) => {
      const sold = b.closed_at ? b.sold_milli! : soldSince(db, b.branch_id, b.product_id, b.started_at, iso(now()))
      return { id: b.id, name: b.name, startedKg: fromMilli(b.started_milli), soldKg: fromMilli(sold), expectedLeftoverKg: fromMilli(b.closed_at ? b.expected_milli! : b.started_milli - sold), countedKg: b.counted_milli == null ? null : fromMilli(b.counted_milli), differenceKg: b.difference_milli == null ? null : fromMilli(b.difference_milli), open: !b.closed_at, startedAt: b.started_at }
    }),
  })
})

/** Cierre: se cuenta el sobrante con código. La diferencia contra lo esperado ajusta el inventario y queda en bitácora. */
taqueria.post('/meat/batches/:id/close', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const b = db.prepare('SELECT * FROM meat_batches WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; branch_id: string; product_id: string; started_milli: number; started_at: string; closed_at: string | null } | undefined
  if (!b) throw notFound()
  if (b.closed_at) throw conflict('Esa carne ya se cerró.')
  const d = parse(z.object({ leftoverKg: z.number().min(0), reason: z.string().trim().max(200).optional(), authCode: z.string().optional() }), await body(c))
  const auth = authorize(deps, u, d.authCode, 'edit_inventory', 'conteo de sobrante de carne')
  const sold = soldSince(db, b.branch_id, b.product_id, b.started_at, iso(now()))
  const expected = b.started_milli - sold
  const counted = toMilli(d.leftoverKg)
  const diff = counted - expected
  if (diff !== 0 && !d.reason) throw bad('Hay diferencia contra lo esperado. Escribe el motivo.', 'motivo_requerido')
  db.transaction(() => {
    const ctx = { db, now, businessId: u.business_id, branchId: b.branch_id, userId: u.id }
    // Faltante: merma. Sobrante mayor a lo esperado: ajuste a favor.
    if (diff < 0) consume(ctx, b.product_id, -diff, 'merma', b.id, `Diferencia de carne: ${d.reason}`)
    if (diff > 0) {
      const p = getProduct(db, u.business_id, b.product_id)
      addLot(ctx, { productId: p.id, qtyMilli: diff, unitCost: p.last_cost, price: currentPrice(db, b.branch_id, p), type: 'ajuste', refId: b.id })
    }
    db.prepare('UPDATE meat_batches SET closed_at = ?, sold_milli = ?, expected_milli = ?, counted_milli = ?, difference_milli = ?, reason = ?, authorized_by = ? WHERE id = ?').run(iso(now()), sold, expected, counted, diff, d.reason ?? null, auth.id, b.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'taqueria.carne_cierre', entity: 'meat_batch', entityId: b.id, newValue: { startedKg: fromMilli(b.started_milli), soldKg: fromMilli(sold), expectedKg: fromMilli(expected), countedKg: d.leftoverKg, differenceKg: fromMilli(diff) }, authorizedBy: auth.id, reason: d.reason ?? null })
  })()
  return c.json({ startedKg: fromMilli(b.started_milli), soldKg: fromMilli(sold), expectedKg: fromMilli(expected), countedKg: d.leftoverKg, differenceKg: fromMilli(diff) })
})

/** Costo de un taco (o platillo) según su receta y el último costo de cada insumo. */
taqueria.get('/recipes/:ownerId/cost', (c) => {
  const { db } = c.get('deps')
  const rows = db.prepare('SELECT r.qty_micro, p.name, p.last_cost FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.owner_id = ? AND p.business_id = ?').all(c.req.param('ownerId'), c.get('session').user.business_id) as { qty_micro: number; name: string; last_cost: number }[]
  const items = rows.map((r) => ({ name: r.name, quantity: r.qty_micro / 1_000_000, cost: Math.round((r.qty_micro / 1_000_000) * r.last_cost * 100) / 100 }))
  return c.json({ items, cost: Math.round(items.reduce((a, i) => a + i.cost, 0)) })
})
