import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, parse, requirePerm, type Env } from './context.js'
import { returnValidators } from './hardware.js'
import { addLot, consume, currentPrice, fromMilli, getProduct, stockOf, toMilli, type ProductRow } from './inventory.js'
import { AppError, bad, conflict, iso, newId } from './util.js'

/** Perfumería: decants (fraccionar frascos), testers y devoluciones solo de lo sellado. */
export const perfume = new Hono<Env>()

const attrsOf = (p: ProductRow) => JSON.parse(p.attrs) as { brand?: string; fragrance?: string; sizeMl?: number; presentation?: string }

/**
 * Decant: se abre (o se sigue usando) un frasco grande, se descuentan sus mililitros y se crean
 * frascos pequeños con costo proporcional (más el envase, si se indica).
 */
perfume.post('/decants', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ sourceProductId: z.string(), targetProductId: z.string(), quantity: z.number().int().min(1).max(500), containerProductId: z.string().optional(), branchId: z.string().optional() }), await body(c))
  const branchId = d.branchId ?? u.branch_id
  if (!branchId) throw bad('Sucursal no válida.')
  const src = getProduct(db, u.business_id, d.sourceProductId)
  const dst = getProduct(db, u.business_id, d.targetProductId)
  const srcMl = Number(attrsOf(src).sizeMl ?? 0)
  const dstMl = Number(attrsOf(dst).sizeMl ?? 0)
  if (!srcMl || !dstMl) throw bad('Indica los mililitros (sizeMl) del frasco grande y del decant.')
  if (dstMl >= srcMl) throw bad('El decant debe ser más chico que el frasco.')
  const needMl = dstMl * d.quantity
  const ctx = { db, now, businessId: u.business_id, branchId, userId: u.id }
  const id = newId()
  const out = db.transaction(() => {
    let left = needMl
    let cost = 0
    const bottles = db.prepare('SELECT * FROM open_bottles WHERE branch_id = ? AND product_id = ? AND ml_remaining > 0 ORDER BY opened_at').all(branchId, src.id) as { id: string; ml_remaining: number; cost_per_ml: number }[]
    const take = (b: { id: string; ml_remaining: number; cost_per_ml: number }) => {
      const ml = Math.min(left, b.ml_remaining)
      db.prepare('UPDATE open_bottles SET ml_remaining = ml_remaining - ? WHERE id = ?').run(ml, b.id)
      cost += ml * b.cost_per_ml
      left -= ml
    }
    for (const b of bottles) { if (left <= 0) break; take(b) }
    let opened = 0
    while (left > 1e-9) {
      // Abrir un frasco nuevo: sale una pieza del inventario y queda como mililitros.
      if (stockOf(db, branchId, src.id) < 1000) throw conflict(`No hay suficiente ${src.name} para hacer los decants.`, 'sin_existencia')
      const r = consume(ctx, src.id, 1000, 'fraccion_salida', id, 'Frasco abierto para decants')
      const b = { id: newId(), ml_remaining: srcMl, cost_per_ml: r.cost / srcMl }
      db.prepare('INSERT INTO open_bottles (id, business_id, branch_id, product_id, ml_total, ml_remaining, cost_per_ml, opened_by, opened_at) VALUES (?,?,?,?,?,?,?,?,?)').run(b.id, u.business_id, branchId, src.id, srcMl, srcMl, b.cost_per_ml, u.id, iso(now()))
      opened++
      take(b)
    }
    if (d.containerProductId) cost += consume(ctx, getProduct(db, u.business_id, d.containerProductId).id, toMilli(d.quantity), 'consumo', id, 'Envase de decant').cost
    const unitCost = cost / d.quantity
    addLot(ctx, { productId: dst.id, qtyMilli: toMilli(d.quantity), unitCost, price: currentPrice(db, branchId, dst), type: 'fraccion_entrada', refId: id })
    db.prepare('UPDATE products SET last_cost = ? WHERE id = ?').run(unitCost, dst.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'perfumeria.decant', entity: 'product', entityId: dst.id, newValue: { from: src.name, quantity: d.quantity, ml: needMl, openedBottles: opened, unitCost: Math.round(unitCost) } })
    return { quantity: d.quantity, ml: needMl, openedBottles: opened, unitCost: Math.round(unitCost) }
  })()
  return c.json({ id, ...out }, 201)
})

perfume.get('/open-bottles', requirePerm('view_inventory'), (c) => {
  const rows = c.get('deps').db
    .prepare('SELECT ob.id, p.name, ob.ml_total AS mlTotal, ob.ml_remaining AS mlRemaining, ob.opened_at AS openedAt FROM open_bottles ob JOIN products p ON p.id = ob.product_id WHERE ob.business_id = ? AND ob.ml_remaining > 0 ORDER BY ob.opened_at')
    .all(c.get('session').user.business_id)
  return c.json({ bottles: rows })
})

/** Testers y muestras: inventario de uso. Se registra lo que se gasta, no se venden. */
perfume.post('/testers/use', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ productId: z.string(), quantity: z.number().positive(), reason: z.string().trim().min(3).max(200).default('Uso de tester o muestra') }), await body(c))
  const p = getProduct(db, u.business_id, d.productId)
  if (p.sellable) throw bad('Ese producto es de venta; los testers y muestras se dan de alta como uso interno.')
  const id = newId()
  const r = db.transaction(() => consume({ db, now, businessId: u.business_id, branchId: u.branch_id!, userId: u.id }, p.id, toMilli(d.quantity), 'consumo', id, d.reason))()
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'perfumeria.tester', entity: 'product', entityId: p.id, newValue: { quantity: d.quantity, cost: r.cost }, reason: d.reason })
  return c.json({ cost: r.cost, stock: fromMilli(stockOf(db, u.branch_id!, p.id)) }, 201)
})

// Devoluciones en perfumería: solo productos sellados o sin usar, con ticket (y código, como siempre).
returnValidators.push(({ c, productId, input }) => {
  const { db } = c.get('deps')
  const giro = (db.prepare('SELECT giro FROM businesses WHERE id = ?').get(c.get('session').user.business_id) as { giro: string }).giro
  if (giro !== 'perfumeria') return
  if (!input.saleItemId) throw new AppError(400, 'requiere_ticket', 'En perfumería las devoluciones son con ticket.')
  if (productId) {
    const p = db.prepare('SELECT attrs, sellable FROM products WHERE id = ?').get(productId) as { attrs: string; sellable: number }
    const pres = (JSON.parse(p.attrs) as { presentation?: string }).presentation
    if (pres === 'tester' || !p.sellable) throw new AppError(400, 'no_devolvible', 'Los testers y muestras no se devuelven.')
  }
  if ((input as { sealed?: boolean }).sealed !== true) throw new AppError(400, 'producto_abierto', 'Solo se devuelven productos sellados o sin usar.')
})
