import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, hasPerm, parse, requirePerm, type C, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, clampTime, conflict, forbidden, iso, newId, notFound, type Clock } from './util.js'

// Cantidades de inventario en milésimas de la unidad base (1 pieza = 1000, 1 kg = 1000 g).
export const toMilli = (q: number) => Math.round(q * 1000)
export const fromMilli = (m: number) => m / 1000

export interface ProductRow {
  id: string; business_id: string; name: string; category_id: string | null; barcode: string | null; unit: 'pieza' | 'kg' | 'metro' | 'litro'
  price: number; margin_bp: number | null; min_stock_milli: number; track_expiry: number; last_cost: number; version: number
  updated_at: string; updated_device: string | null; active: number
}
export interface LotRow {
  id: string; branch_id: string; product_id: string; qty_initial_milli: number; qty_remaining_milli: number; unit_cost: number; price: number
  expires_at: string | null; received_at: string; purchase_id: string | null
}

export function getProduct(db: Db, businessId: string, id: string): ProductRow {
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(id, businessId) as ProductRow | undefined
  if (!p) throw notFound('No se encontró ese producto.')
  return p
}

const fifoLots = (db: Db, branchId: string, productId: string) =>
  db.prepare('SELECT * FROM lots WHERE branch_id = ? AND product_id = ? AND qty_remaining_milli > 0 ORDER BY received_at, rowid').all(branchId, productId) as LotRow[]

export function stockOf(db: Db, branchId: string, productId: string): number {
  return (db.prepare('SELECT COALESCE(SUM(qty_milli),0) q FROM stock_movements WHERE branch_id = ? AND product_id = ?').get(branchId, productId) as { q: number }).q
}

/** Precio vigente por unidad: el del lote más viejo con existencia; sin lotes, el del producto. */
export function currentPrice(db: Db, branchId: string, p: ProductRow): number {
  return fifoLots(db, branchId, p.id)[0]?.price ?? p.price
}

/**
 * Importe de vender `qtyMilli` (lotes con precio: primero el lote más viejo; lo que pase de la
 * existencia se cobra al precio del último lote o del producto).
 */
export function priceFor(db: Db, branchId: string, p: ProductRow, qtyMilli: number): number {
  let left = qtyMilli, total = 0, last = p.price
  for (const l of fifoLots(db, branchId, p.id)) {
    if (left <= 0) break
    const take = Math.min(left, l.qty_remaining_milli)
    total += (take * l.price) / 1000
    left -= take
    last = l.price
  }
  total += (left * last) / 1000
  return Math.round(total)
}

export interface MoveCtx { db: Db; now: Clock; businessId: string; branchId: string; userId: string }

/** Saca existencia primero-entra-primero-sale y devuelve el costo (centavos). Si no alcanza, el faltante queda en negativo al último costo. */
export function consume(ctx: MoveCtx, productId: string, qtyMilli: number, type: 'venta' | 'merma' | 'traspaso_salida' | 'consumo' | 'ajuste', refId: string | null, reason: string | null = null, onlyLot?: string) {
  const { db, now } = ctx
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as ProductRow
  let left = qtyMilli, cost = 0
  const parts: { lot: LotRow; qty: number; cost: number }[] = []
  const lots = fifoLots(db, ctx.branchId, productId).filter((l) => !onlyLot || l.id === onlyLot)
  for (const l of lots) {
    if (left <= 0) break
    const take = Math.min(left, l.qty_remaining_milli)
    const c = Math.round((take * l.unit_cost) / 1000)
    db.prepare('UPDATE lots SET qty_remaining_milli = qty_remaining_milli - ? WHERE id = ?').run(take, l.id)
    db.prepare('INSERT INTO stock_movements (id, business_id, branch_id, product_id, lot_id, type, qty_milli, cost, ref_id, reason, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      newId(), ctx.businessId, ctx.branchId, productId, l.id, type, -take, -c, refId, reason, ctx.userId, iso(now()),
    )
    parts.push({ lot: l, qty: take, cost: c })
    cost += c
    left -= take
  }
  if (left > 0) {
    if (onlyLot) throw conflict('Ese lote no tiene suficiente existencia.', 'sin_existencia')
    const c = Math.round((left * p.last_cost) / 1000)
    db.prepare('INSERT INTO stock_movements (id, business_id, branch_id, product_id, lot_id, type, qty_milli, cost, ref_id, reason, user_id, created_at) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?)').run(
      newId(), ctx.businessId, ctx.branchId, productId, type, -left, -c, refId, reason ?? 'sin existencia registrada', ctx.userId, iso(now()),
    )
    cost += c
  }
  return { cost, parts }
}

/** Revierte los movimientos de `refId` (p. ej. al cancelar una venta): regresa la existencia a sus lotes. */
export function restore(ctx: MoveCtx, refId: string, type: 'cancelacion') {
  const { db, now } = ctx
  const moves = db.prepare("SELECT * FROM stock_movements WHERE ref_id = ? AND type IN ('venta','consumo')").all(refId) as { branch_id: string; product_id: string; lot_id: string | null; qty_milli: number; cost: number }[]
  for (const m of moves) {
    if (m.lot_id) db.prepare('UPDATE lots SET qty_remaining_milli = qty_remaining_milli + ? WHERE id = ?').run(-m.qty_milli, m.lot_id)
    db.prepare('INSERT INTO stock_movements (id, business_id, branch_id, product_id, lot_id, type, qty_milli, cost, ref_id, reason, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)').run(
      newId(), ctx.businessId, m.branch_id, m.product_id, m.lot_id, type, -m.qty_milli, -m.cost, refId, ctx.userId, iso(now()),
    )
  }
}

export function addLot(ctx: MoveCtx, a: { productId: string; qtyMilli: number; unitCost: number; price: number; expiresAt?: string | null; purchaseId?: string | null; sourceLotId?: string | null; receivedAt?: string; type: 'compra' | 'traspaso_entrada' | 'ajuste'; refId: string | null }) {
  const { db, now } = ctx
  const id = newId()
  const at = a.receivedAt ?? iso(now())
  db.prepare('INSERT INTO lots (id, business_id, branch_id, product_id, purchase_id, source_lot_id, qty_initial_milli, qty_remaining_milli, unit_cost, price, expires_at, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    id, ctx.businessId, ctx.branchId, a.productId, a.purchaseId ?? null, a.sourceLotId ?? null, a.qtyMilli, a.qtyMilli, a.unitCost, a.price, a.expiresAt ?? null, at,
  )
  db.prepare('INSERT INTO stock_movements (id, business_id, branch_id, product_id, lot_id, type, qty_milli, cost, ref_id, reason, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)').run(
    newId(), ctx.businessId, ctx.branchId, a.productId, id, a.type, a.qtyMilli, Math.round((a.qtyMilli * a.unitCost) / 1000), a.refId, ctx.userId, at,
  )
  return id
}

/** Reparto con residuo mayor: la suma de las partes es exactamente el total. */
export function splitProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0)
  if (!sum) return weights.map(() => 0)
  const raw = weights.map((w) => (total * w) / sum)
  const out = raw.map(Math.floor)
  let rest = total - out.reduce((a, b) => a + b, 0)
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f).forEach(({ i }) => { if (rest > 0) { out[i]!++; rest-- } })
  return out
}

/** Margen: el del producto; si no, el de su categoría; si no, no hay sugerencia. */
export function suggestedPrice(db: Db, p: ProductRow, unitCost = p.last_cost): number | null {
  const margin = p.margin_bp ?? (p.category_id ? (db.prepare('SELECT margin_bp FROM categories WHERE id = ?').get(p.category_id) as { margin_bp: number | null }).margin_bp : null)
  if (margin == null || !unitCost) return null
  return Math.round(unitCost * (1 + margin / 10_000))
}

function productView(db: Db, p: ProductRow, branchId: string | null) {
  const presentations = db.prepare('SELECT id, name, factor_milli AS factorMilli, price, barcode FROM presentations WHERE product_id = ? AND active = 1').all(p.id)
  return {
    id: p.id, name: p.name, categoryId: p.category_id, barcode: p.barcode, unit: p.unit, basePrice: p.price, marginBp: p.margin_bp,
    minStock: fromMilli(p.min_stock_milli), trackExpiry: !!p.track_expiry, lastCost: p.last_cost, version: p.version, updatedAt: p.updated_at, active: !!p.active,
    ...(branchId ? { price: currentPrice(db, branchId, p), stock: fromMilli(stockOf(db, branchId, p.id)) } : {}),
    suggestedPrice: suggestedPrice(db, p), presentations,
  }
}

const branchOf = (c: C, q?: string) => {
  const u = c.get('session').user
  const id = q ?? c.req.query('branchId') ?? u.branch_id
  if (!id || !c.get('deps').db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(id, u.business_id)) throw bad('Sucursal no válida.')
  return id
}

export const inventory = new Hono<Env>()

// ---------- Categorías ----------

inventory.get('/categories', (c) => c.json({ categories: c.get('deps').db.prepare('SELECT id, name, margin_bp AS marginBp FROM categories WHERE business_id = ? ORDER BY name').all(c.get('session').user.business_id) }))

inventory.post('/categories', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(80), marginBp: z.number().int().min(0).max(100_000).nullable().optional() }), await body(c))
  if (db.prepare('SELECT 1 FROM categories WHERE business_id = ? AND name = ?').get(u.business_id, d.name)) throw conflict('Esa categoría ya existe.')
  const id = newId()
  db.prepare('INSERT INTO categories (id, business_id, name, margin_bp, created_at) VALUES (?,?,?,?,?)').run(id, u.business_id, d.name, d.marginBp ?? null, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'categoria.alta', entity: 'category', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

inventory.patch('/categories/:id', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const old = db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; name: string; margin_bp: number | null } | undefined
  if (!old) throw notFound()
  const d = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), marginBp: z.number().int().min(0).max(100_000).nullable().optional() }), await body(c))
  db.prepare('UPDATE categories SET name = ?, margin_bp = ? WHERE id = ?').run(d.name ?? old.name, d.marginBp === undefined ? old.margin_bp : d.marginBp, old.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'categoria.cambio', entity: 'category', entityId: old.id, oldValue: old, newValue: d })
  return c.json({ ok: true })
})

// ---------- Productos ----------

const productBody = z.object({
  name: z.string().trim().min(1).max(150),
  categoryId: z.string().nullable().optional(),
  barcode: z.string().trim().min(3).max(50).nullable().optional(),
  unit: z.enum(['pieza', 'kg', 'metro', 'litro']),
  price: z.number().int().min(0),
  marginBp: z.number().int().min(0).max(100_000).nullable().optional(),
  minStock: z.number().min(0).optional(),
  trackExpiry: z.boolean().optional(),
  presentations: z.array(z.object({ name: z.string().trim().min(1).max(60), factor: z.number().positive(), price: z.number().int().min(0), barcode: z.string().trim().min(3).max(50).optional() })).max(20).optional(),
})

function checkBarcode(db: Db, businessId: string, code: string | null | undefined, exceptProduct?: string) {
  if (!code) return
  const hit = db.prepare('SELECT p.id FROM products p WHERE p.business_id = ? AND p.barcode = ? AND p.id != ? UNION SELECT pr.product_id FROM presentations pr JOIN products p ON p.id = pr.product_id WHERE p.business_id = ? AND pr.barcode = ? AND pr.product_id != ?').get(
    businessId, code, exceptProduct ?? '', businessId, code, exceptProduct ?? '',
  )
  if (hit) throw conflict(`El código de barras ${code} ya está en otro producto.`, 'codigo_barras_repetido')
}

export function createProduct(db: Db, now: Clock, businessId: string, userId: string, d: z.infer<typeof productBody>) {
  if (d.categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ? AND business_id = ?').get(d.categoryId, businessId)) throw bad('Esa categoría no existe.')
  checkBarcode(db, businessId, d.barcode)
  for (const pr of d.presentations ?? []) checkBarcode(db, businessId, pr.barcode)
  const id = newId()
  const t = iso(now())
  db.prepare('INSERT INTO products (id, business_id, name, category_id, barcode, unit, price, margin_bp, min_stock_milli, track_expiry, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    id, businessId, d.name, d.categoryId ?? null, d.barcode ?? null, d.unit, d.price, d.marginBp ?? null, toMilli(d.minStock ?? 0), d.trackExpiry ? 1 : 0, t, t,
  )
  for (const pr of d.presentations ?? []) db.prepare('INSERT INTO presentations (id, product_id, name, factor_milli, price, barcode) VALUES (?,?,?,?,?,?)').run(newId(), id, pr.name, toMilli(pr.factor), pr.price, pr.barcode ?? null)
  audit(db, now, { businessId, userId, action: 'producto.alta', entity: 'product', entityId: id, newValue: d })
  return id
}

inventory.get('/products', (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const branchId = branchOf(c)
  const q = c.req.query('q')
  const since = c.req.query('updatedSince')
  const rows = db
    .prepare(`SELECT * FROM products WHERE business_id = ? ${q ? 'AND (name LIKE ? OR barcode = ?)' : ''} ${since ? 'AND updated_at > ?' : ''} ORDER BY name LIMIT 2000`)
    .all(...[u.business_id, ...(q ? [`%${q}%`, q] : []), ...(since ? [since] : [])]) as ProductRow[]
  return c.json({ products: rows.map((p) => productView(db, p, branchId)) })
})

/** Búsqueda por código de barras (producto o presentación) para el lector de la caja. */
inventory.get('/products/barcode/:code', (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const code = c.req.param('code')
  const p = db.prepare('SELECT * FROM products WHERE business_id = ? AND barcode = ? AND active = 1').get(u.business_id, code) as ProductRow | undefined
  if (p) return c.json({ product: productView(db, p, branchOf(c)), presentationId: null })
  const pr = db.prepare('SELECT pr.id, pr.product_id FROM presentations pr JOIN products p ON p.id = pr.product_id WHERE p.business_id = ? AND pr.barcode = ? AND pr.active = 1').get(u.business_id, code) as { id: string; product_id: string } | undefined
  if (!pr) throw notFound('Ningún producto tiene ese código.')
  return c.json({ product: productView(db, getProduct(db, u.business_id, pr.product_id), branchOf(c)), presentationId: pr.id })
})

inventory.get('/products/:id', (c) => {
  const { db } = c.get('deps')
  const p = getProduct(db, c.get('session').user.business_id, c.req.param('id'))
  return c.json({ product: productView(db, p, branchOf(c)) })
})

inventory.post('/products', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(productBody, await body(c))
  const id = createProduct(db, now, u.business_id, u.id, d)
  return c.json({ product: productView(db, getProduct(db, u.business_id, id), u.branch_id) }, 201)
})

/**
 * Editar producto. Si se edita sin conexión, el equipo manda la versión que tenía (`baseVersion`) y la hora
 * del cambio (`updatedAt`): si otro equipo lo cambió en medio, gana el más reciente y queda conflicto para revisión.
 * Cambiar el precio pide permiso y código, y aplica también al precio de los lotes en existencia.
 */
inventory.patch('/products/:id', requirePerm('configure_catalog'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const p = getProduct(db, u.business_id, c.req.param('id'))
  const d = parse(
    productBody.omit({ presentations: true, unit: true }).partial().extend({
      active: z.boolean().optional(), authCode: z.string().optional(), baseVersion: z.number().int().optional(), updatedAt: z.string().datetime().optional(), deviceId: z.string().max(100).optional(),
    }),
    await body(c),
  )
  const changedAt = iso(clampTime(d.updatedAt, now()))
  let priceAuth: string | null = null
  if (d.price !== undefined && d.price !== p.price) {
    if (!hasPerm(u, 'change_prices')) throw forbidden('No tienes permiso para cambiar precios.')
    priceAuth = authorize(deps, u, d.authCode, 'change_prices', 'cambio de precio').id
  }
  if (d.categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ? AND business_id = ?').get(d.categoryId, u.business_id)) throw bad('Esa categoría no existe.')
  if (d.barcode !== undefined) checkBarcode(db, u.business_id, d.barcode, p.id)

  const fields = {
    name: d.name ?? p.name, category_id: d.categoryId === undefined ? p.category_id : d.categoryId, barcode: d.barcode === undefined ? p.barcode : d.barcode,
    price: d.price ?? p.price, margin_bp: d.marginBp === undefined ? p.margin_bp : d.marginBp, min_stock_milli: d.minStock === undefined ? p.min_stock_milli : toMilli(d.minStock),
    track_expiry: d.trackExpiry === undefined ? p.track_expiry : d.trackExpiry ? 1 : 0, active: d.active === undefined ? p.active : d.active ? 1 : 0,
  }
  const stale = d.baseVersion !== undefined && d.baseVersion !== p.version
  const incomingWins = !stale || changedAt >= p.updated_at
  const result = db.transaction(() => {
    if (stale) {
      const current = { name: p.name, price: p.price, barcode: p.barcode, minStock: p.min_stock_milli, active: p.active }
      const incoming = { ...d, authCode: undefined }
      db.prepare('INSERT INTO sync_conflicts (id, business_id, entity, entity_id, winner, loser, winner_device, loser_device, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        newId(), u.business_id, 'producto', p.id, JSON.stringify(incomingWins ? incoming : current), JSON.stringify(incomingWins ? current : incoming),
        incomingWins ? d.deviceId ?? 'servidor' : p.updated_device ?? 'servidor', incomingWins ? p.updated_device ?? 'servidor' : d.deviceId ?? 'servidor', iso(now()),
      )
    }
    if (!incomingWins) return 'conflicto_pierde'
    db.prepare('UPDATE products SET name=?, category_id=?, barcode=?, price=?, margin_bp=?, min_stock_milli=?, track_expiry=?, active=?, version = version + 1, updated_at=?, updated_device=? WHERE id=?').run(
      fields.name, fields.category_id, fields.barcode, fields.price, fields.margin_bp, fields.min_stock_milli, fields.track_expiry, fields.active, changedAt, d.deviceId ?? null, p.id,
    )
    if (d.price !== undefined && d.price !== p.price) db.prepare('UPDATE lots SET price = ? WHERE product_id = ? AND qty_remaining_milli > 0').run(d.price, p.id)
    audit(db, now, {
      businessId: u.business_id, userId: u.id, action: d.price !== undefined && d.price !== p.price ? 'producto.cambio_precio' : 'producto.cambio', entity: 'product', entityId: p.id,
      oldValue: { name: p.name, price: p.price, barcode: p.barcode, active: p.active }, newValue: { ...d, authCode: undefined }, authorizedBy: priceAuth,
    })
    return stale ? 'conflicto_gana' : 'aplicado'
  })()
  return c.json({ status: result, product: productView(db, getProduct(db, u.business_id, p.id), u.branch_id) })
})

inventory.post('/products/:id/presentations', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = getProduct(db, u.business_id, c.req.param('id'))
  const d = parse(z.object({ name: z.string().trim().min(1).max(60), factor: z.number().positive(), price: z.number().int().min(0), barcode: z.string().trim().min(3).max(50).optional() }), await body(c))
  checkBarcode(db, u.business_id, d.barcode)
  const id = newId()
  db.prepare('INSERT INTO presentations (id, product_id, name, factor_milli, price, barcode) VALUES (?,?,?,?,?,?)').run(id, p.id, d.name, toMilli(d.factor), d.price, d.barcode ?? null)
  db.prepare('UPDATE products SET version = version + 1, updated_at = ? WHERE id = ?').run(iso(now()), p.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'producto.presentacion_alta', entity: 'product', entityId: p.id, newValue: d })
  return c.json({ id }, 201)
})

inventory.get('/products/:id/lots', requirePerm('view_inventory'), (c) => {
  const { db } = c.get('deps')
  const p = getProduct(db, c.get('session').user.business_id, c.req.param('id'))
  const rows = db.prepare('SELECT id, qty_initial_milli, qty_remaining_milli, unit_cost AS unitCost, price, expires_at AS expiresAt, received_at AS receivedAt FROM lots WHERE product_id = ? AND branch_id = ? ORDER BY received_at').all(p.id, branchOf(c)) as { qty_initial_milli: number; qty_remaining_milli: number }[]
  return c.json({ lots: rows.map(({ qty_initial_milli, qty_remaining_milli, ...r }) => ({ ...r, initial: fromMilli(qty_initial_milli), remaining: fromMilli(qty_remaining_milli) })) })
})

inventory.get('/products/:id/movements', requirePerm('view_inventory'), (c) => {
  const { db } = c.get('deps')
  const p = getProduct(db, c.get('session').user.business_id, c.req.param('id'))
  const rows = db.prepare('SELECT type, qty_milli, cost, ref_id AS refId, reason, created_at AS createdAt FROM stock_movements WHERE product_id = ? AND branch_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 500').all(p.id, branchOf(c)) as { qty_milli: number }[]
  return c.json({ movements: rows.map(({ qty_milli, ...r }) => ({ ...r, qty: fromMilli(qty_milli) })) })
})

// ---------- Alertas ----------

inventory.get('/inventory/low-stock', requirePerm('view_inventory'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const branchId = branchOf(c)
  const rows = (db.prepare('SELECT * FROM products WHERE business_id = ? AND active = 1 AND min_stock_milli > 0').all(u.business_id) as ProductRow[])
    .map((p) => ({ p, stock: stockOf(db, branchId, p.id) }))
    .filter((x) => x.stock < x.p.min_stock_milli)
    .map(({ p, stock }) => ({ id: p.id, name: p.name, stock: fromMilli(stock), minStock: fromMilli(p.min_stock_milli), missing: fromMilli(p.min_stock_milli - stock), restockCost: Math.round(((p.min_stock_milli - stock) * p.last_cost) / 1000) }))
  return c.json({ products: rows })
})

inventory.get('/inventory/expiring', requirePerm('view_inventory'), (c) => {
  const { db, now } = c.get('deps')
  const days = Math.min(Number(c.req.query('days') ?? 7) || 7, 365)
  const limit = iso(new Date(now().getTime() + days * 86_400_000))
  const rows = db
    .prepare('SELECT l.id AS lotId, p.id AS productId, p.name, l.qty_remaining_milli, l.expires_at AS expiresAt FROM lots l JOIN products p ON p.id = l.product_id WHERE p.business_id = ? AND l.branch_id = ? AND l.qty_remaining_milli > 0 AND l.expires_at IS NOT NULL AND l.expires_at <= ? ORDER BY l.expires_at')
    .all(c.get('session').user.business_id, branchOf(c), limit) as { qty_remaining_milli: number; expiresAt: string }[]
  return c.json({ lots: rows.map(({ qty_remaining_milli, ...r }) => ({ ...r, remaining: fromMilli(qty_remaining_milli), expired: r.expiresAt <= iso(now()) })) })
})

inventory.get('/inventory/value', requirePerm('view_reports'), (c) => {
  const { db } = c.get('deps')
  const r = db.prepare('SELECT COALESCE(SUM(qty_remaining_milli * unit_cost / 1000.0),0) v FROM lots WHERE business_id = ? AND branch_id = ?').get(c.get('session').user.business_id, branchOf(c)) as { v: number }
  return c.json({ value: Math.round(r.v) })
})

// ---------- Mermas ----------

inventory.post('/inventory/waste', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ productId: z.string(), quantity: z.number().positive(), reason: z.string().trim().min(3).max(200), lotId: z.string().optional(), branchId: z.string().optional() }), await body(c))
  const branchId = branchOf(c, d.branchId)
  const p = getProduct(db, u.business_id, d.productId)
  if (p.unit === 'pieza' && !Number.isInteger(d.quantity)) throw bad('Este producto se cuenta por pieza.')
  const id = newId()
  const r = db.transaction(() => consume({ db, now, businessId: u.business_id, branchId, userId: u.id }, p.id, toMilli(d.quantity), 'merma', id, d.reason, d.lotId))()
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'inventario.merma', entity: 'product', entityId: p.id, newValue: { quantity: d.quantity, cost: r.cost }, reason: d.reason })
  return c.json({ id, cost: r.cost, stock: fromMilli(stockOf(db, branchId, p.id)) }, 201)
})

/** Ajuste por conteo físico: deja la existencia igual a lo contado. */
inventory.post('/inventory/count', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ productId: z.string(), counted: z.number().min(0), reason: z.string().trim().min(3).max(200), branchId: z.string().optional() }), await body(c))
  const branchId = branchOf(c, d.branchId)
  const p = getProduct(db, u.business_id, d.productId)
  const ctx = { db, now, businessId: u.business_id, branchId, userId: u.id }
  const before = stockOf(db, branchId, p.id)
  const diff = toMilli(d.counted) - before
  const id = newId()
  db.transaction(() => {
    if (diff < 0) consume(ctx, p.id, -diff, 'ajuste', id, d.reason)
    if (diff > 0) addLot(ctx, { productId: p.id, qtyMilli: diff, unitCost: p.last_cost, price: currentPrice(db, branchId, p), type: 'ajuste', refId: id })
  })()
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'inventario.conteo', entity: 'product', entityId: p.id, oldValue: { stock: fromMilli(before) }, newValue: { stock: d.counted }, reason: d.reason })
  return c.json({ before: fromMilli(before), after: d.counted, difference: fromMilli(diff) })
})

// ---------- Traspasos entre sucursales ----------

inventory.post('/inventory/transfers', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ fromBranchId: z.string(), toBranchId: z.string(), items: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).min(1).max(200) }), await body(c))
  const from = branchOf(c, d.fromBranchId)
  const to = branchOf(c, d.toBranchId)
  if (from === to) throw bad('Elige dos sucursales distintas.')
  const id = newId()
  db.transaction(() => {
    for (const it of d.items) {
      const p = getProduct(db, u.business_id, it.productId)
      const qty = toMilli(it.quantity)
      if (stockOf(db, from, p.id) < qty) throw conflict(`No hay suficiente ${p.name} para traspasar.`, 'sin_existencia')
      const out = consume({ db, now, businessId: u.business_id, branchId: from, userId: u.id }, p.id, qty, 'traspaso_salida', id)
      // Cada parte conserva su costo, precio y caducidad en la sucursal destino.
      for (const part of out.parts) {
        addLot({ db, now, businessId: u.business_id, branchId: to, userId: u.id }, { productId: p.id, qtyMilli: part.qty, unitCost: part.lot.unit_cost, price: part.lot.price, expiresAt: part.lot.expires_at, sourceLotId: part.lot.id, receivedAt: part.lot.received_at, type: 'traspaso_entrada', refId: id })
      }
    }
    db.prepare('INSERT INTO transfers (id, business_id, from_branch, to_branch, items, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(id, u.business_id, from, to, JSON.stringify(d.items), u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'inventario.traspaso', entity: 'transfer', entityId: id, newValue: d })
  })()
  return c.json({ id }, 201)
})

// ---------- Proveedores ----------

inventory.get('/suppliers', requirePerm('edit_inventory'), (c) => c.json({ suppliers: c.get('deps').db.prepare('SELECT id, name, phone, notes, active FROM suppliers WHERE business_id = ? ORDER BY name').all(c.get('session').user.business_id) }))

inventory.post('/suppliers', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().max(20).optional(), notes: z.string().max(1000).optional() }), await body(c))
  const id = newId()
  db.prepare('INSERT INTO suppliers (id, business_id, name, phone, notes, created_at) VALUES (?,?,?,?,?,?)').run(id, u.business_id, d.name, d.phone ?? null, d.notes ?? null, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'proveedor.alta', entity: 'supplier', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

// ---------- Compras ----------

const purchaseBody = z.object({
  id: z.string().uuid().optional(),
  branchId: z.string().optional(),
  supplierId: z.string().optional(),
  ticketRef: z.string().max(100).optional(),
  payment: z.enum(['contado', 'credito']),
  /** Si se paga de contado en efectivo desde la caja abierta. */
  paidFromCash: z.boolean().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Fletes y gastos de traer la mercancía (gasolina, casetas…). */
  freight: z.array(z.object({ concept: z.string().trim().min(2).max(80), amount: z.number().int().min(1) })).max(20).default([]),
  items: z.array(z.object({
    productId: z.string().optional(),
    /** Producto nuevo capturado desde el ticket de compra. */
    newProduct: productBody.optional(),
    quantity: z.number().positive(),
    /** Costo total del renglón en el ticket (centavos). */
    cost: z.number().int().min(0),
    /** Precio de venta nuevo; entra cuando se agote lo anterior. */
    newPrice: z.number().int().min(0).optional(),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  })).min(1).max(300),
})

export function purchaseBalance(db: Db, purchaseId: string) {
  const p = db.prepare('SELECT items_total + freight_total AS total, payment FROM purchases WHERE id = ?').get(purchaseId) as { total: number; payment: string }
  const paid = (db.prepare('SELECT COALESCE(SUM(amount),0) a FROM supplier_payments WHERE purchase_id = ?').get(purchaseId) as { a: number }).a
  return { total: p.total, paid, balance: p.total - paid }
}

inventory.post('/purchases', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(purchaseBody, await body(c))
  if (d.id && db.prepare('SELECT 1 FROM purchases WHERE id = ? AND business_id = ?').get(d.id, u.business_id)) return c.json({ id: d.id, duplicate: true })
  const branchId = branchOf(c, d.branchId)
  if (d.supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND business_id = ?').get(d.supplierId, u.business_id)) throw bad('Ese proveedor no existe.')
  if (d.payment === 'credito' && d.paidFromCash) throw bad('Una compra a crédito no sale de la caja.')
  const shift = d.paidFromCash ? (db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined) : undefined
  if (d.paidFromCash && !shift) throw conflict('Abre tu caja para pagar desde el efectivo.', 'caja_cerrada')

  const id = d.id ?? newId()
  const ctx = { db, now, businessId: u.business_id, branchId, userId: u.id }
  const result = db.transaction(() => {
    const items = d.items.map((it) => {
      if (!it.productId && !it.newProduct) throw bad('Cada renglón necesita un producto o los datos de uno nuevo.')
      const pid = it.productId ?? createProduct(db, now, u.business_id, u.id, it.newProduct!)
      const p = getProduct(db, u.business_id, pid)
      if (p.unit === 'pieza' && !Number.isInteger(it.quantity)) throw bad(`${p.name} se compra por pieza.`)
      return { ...it, p, qtyMilli: toMilli(it.quantity) }
    })
    // Reparto de fletes: por pieza en productos por pieza, por kilo (unidad) en granel.
    const freightTotal = d.freight.reduce((a, f) => a + f.amount, 0)
    const shares = splitProportional(freightTotal, items.map((i) => i.qtyMilli))
    const itemsTotal = items.reduce((a, i) => a + i.cost, 0)
    db.prepare('INSERT INTO purchases (id, business_id, branch_id, supplier_id, ticket_ref, items_total, freight_total, freight_detail, payment, due_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, branchId, d.supplierId ?? null, d.ticketRef ?? null, itemsTotal, freightTotal, JSON.stringify(d.freight), d.payment, d.dueDate ?? null, u.id, iso(now()),
    )
    const out = items.map((it, i) => {
      const realCost = it.cost + shares[i]!
      const unitCost = (realCost * 1000) / it.qtyMilli
      const price = it.newPrice ?? currentPrice(db, branchId, it.p)
      const lotId = addLot(ctx, { productId: it.p.id, qtyMilli: it.qtyMilli, unitCost, price, expiresAt: it.expiresAt ?? null, purchaseId: id, type: 'compra', refId: id })
      db.prepare('INSERT INTO purchase_items (id, purchase_id, product_id, qty_milli, cost_total, freight_share, unit_cost, lot_id) VALUES (?,?,?,?,?,?,?,?)').run(newId(), id, it.p.id, it.qtyMilli, it.cost, shares[i]!, unitCost, lotId)
      db.prepare('UPDATE products SET last_cost = ? WHERE id = ?').run(unitCost, it.p.id)
      // Si no hay existencia anterior, el precio nuevo entra de inmediato.
      if (it.newPrice !== undefined && stockOf(db, branchId, it.p.id) === it.qtyMilli) db.prepare('UPDATE products SET price = ?, version = version + 1, updated_at = ? WHERE id = ?').run(it.newPrice, iso(now()), it.p.id)
      const fresh = getProduct(db, u.business_id, it.p.id)
      return { productId: it.p.id, name: it.p.name, quantity: it.quantity, cost: it.cost, freightShare: shares[i]!, realCost, unitCost: Math.round(unitCost * 100) / 100, suggestedPrice: suggestedPrice(db, fresh, unitCost), lotId }
    })
    if (d.payment === 'contado') {
      db.prepare('INSERT INTO supplier_payments (id, purchase_id, amount, method, from_cash_shift, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), id, itemsTotal + freightTotal, d.paidFromCash ? 'efectivo' : 'transferencia', shift?.id ?? null, u.id, iso(now()))
      if (shift) db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift.id, itemsTotal + freightTotal, `Pago de compra ${d.ticketRef ?? id.slice(0, 8)}`, u.id, iso(now()))
    }
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'compra.alta', entity: 'purchase', entityId: id, newValue: { itemsTotal, freightTotal, payment: d.payment } })
    return { items: out, itemsTotal, freightTotal }
  })()
  return c.json({ id, ...result, ...purchaseBalance(db, id) }, 201)
})

inventory.get('/purchases/:id', requirePerm('edit_inventory'), (c) => {
  const { db } = c.get('deps')
  const p = db.prepare('SELECT * FROM purchases WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as { id: string } | undefined
  if (!p) throw notFound()
  const items = db.prepare('SELECT pi.*, pr.name FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id WHERE purchase_id = ?').all(p.id)
  return c.json({ purchase: p, items, ...purchaseBalance(db, p.id), payments: db.prepare('SELECT amount, method, created_at AS createdAt FROM supplier_payments WHERE purchase_id = ?').all(p.id) })
})

// Cuentas por pagar.
inventory.get('/payables', requirePerm('edit_inventory'), (c) => {
  const { db } = c.get('deps')
  const rows = db.prepare("SELECT p.id, p.ticket_ref AS ticketRef, p.due_date AS dueDate, p.created_at AS createdAt, s.name AS supplier FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.business_id = ? AND p.payment = 'credito' ORDER BY p.due_date").all(c.get('session').user.business_id) as { id: string }[]
  const list = rows.map((r) => ({ ...r, ...purchaseBalance(db, r.id) })).filter((r) => r.balance > 0)
  return c.json({ payables: list, total: list.reduce((a, r) => a + r.balance, 0) })
})

inventory.post('/purchases/:id/payments', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = db.prepare('SELECT id, ticket_ref FROM purchases WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; ticket_ref: string | null } | undefined
  if (!p) throw notFound()
  const d = parse(z.object({ amount: z.number().int().min(1), method: z.enum(['efectivo', 'transferencia', 'tarjeta']), fromCash: z.boolean().optional() }), await body(c))
  const bal = purchaseBalance(db, p.id)
  if (d.amount > bal.balance) throw bad(`El saldo de esta compra es ${bal.balance}.`)
  const shift = d.fromCash ? (db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined) : undefined
  if (d.fromCash && (d.method !== 'efectivo' || !shift)) throw conflict('Para pagar desde la caja debe ser en efectivo y con la caja abierta.', 'caja_cerrada')
  db.transaction(() => {
    db.prepare('INSERT INTO supplier_payments (id, purchase_id, amount, method, from_cash_shift, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), p.id, d.amount, d.method, shift?.id ?? null, u.id, iso(now()))
    if (shift) db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift.id, d.amount, `Abono a proveedor ${p.ticket_ref ?? p.id.slice(0, 8)}`, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'compra.abono', entity: 'purchase', entityId: p.id, newValue: d })
  })()
  return c.json(purchaseBalance(db, p.id), 201)
})
