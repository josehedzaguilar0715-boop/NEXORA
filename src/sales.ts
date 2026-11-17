import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { earnForSale, moduleOn, reverseSalePoints } from './common.js'
import { activePromotions, bestPromotions } from './promotions.js'
import { body, hasPerm, parse, requirePerm, type C, type Deps, type Env, type UserRow } from './context.js'
import { consume, currentPrice, getProduct, priceFor, restore, toMilli } from './inventory.js'
import { bad, conflict, forbidden, iso, newId, notFound } from './util.js'

export const sales = new Hono<Env>()

export interface SaleRow {
  promo_discount: number; customer_id: string | null; cash_received: number | null
  id: string; business_id: string; branch_id: string; shift_id: string; folio: number; cashier_id: string
  subtotal: number; discount: number; total: number; payment_method: string; status: string
  cancel_reason: string | null; created_at: string
}

const itemSchema = z
  .object({
    /** Producto del catálogo (descuenta inventario). Sin producto: renglón libre (servicio, varios). */
    productId: z.string().optional(),
    presentationId: z.string().optional(),
    description: z.string().trim().min(1).max(200).optional(),
    /** Piezas, presentaciones o kilos (báscula). */
    quantity: z.number().positive().max(1_000_000).optional(),
    /** Venta a granel por importe: "dame $20 de jamón". */
    amount: z.number().int().min(1).optional(),
    /** Precio por unidad. En productos del catálogo solo si se cambia el precio (pide código). */
    unitPrice: z.number().int('Usa centavos enteros').min(0).optional(),
    ref: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
  })
  .passthrough()

const saleSchema = z
  .object({
    /** Identificador único creado en el equipo; el servidor ignora repetidos. */
    id: z.string().uuid(),
    items: z.array(itemSchema).min(1).max(300),
    paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta', 'fiado']),
    /** Efectivo que entrega el cliente, para calcular el cambio. */
    cashReceived: z.number().int().min(0).optional(),
    discount: z.number().int().min(0).optional(),
    authCode: z.string().optional(),
    /** Turno en el que se cobró (útil al reenviar ventas hechas sin internet). */
    shiftId: z.string().uuid().optional(),
    customerId: z.string().optional(),
    createdAt: z.string().datetime().optional(),
  })
  .passthrough()

export type SaleInput = z.infer<typeof saleSchema>
export interface ResolvedLine {
  input: z.infer<typeof itemSchema>
  description: string; quantity: number; unitPrice: number; total: number
  ref: string | null; category: string | null; productId: string | null; presentationId: string | null; qtyMilli: number | null
  priceChanged: boolean; cost: number; itemId: string
}
export interface SaleHookCtx { deps: Deps; user: UserRow; saleId: string; branchId: string; shiftId: string; input: SaleInput; lines: ResolvedLine[]; total: number }

/**
 * Puntos de extensión para los giros (comisiones, recetas, propinas, mesas…). Corren dentro de la
 * transacción de la venta: si uno falla, la venta no se guarda.
 */
export const saleHooks: ((ctx: SaleHookCtx) => void)[] = []
export const cancelHooks: ((ctx: { deps: Deps; user: UserRow; saleId: string }) => void)[] = []
/** Validaciones antes de cobrar (p. ej. aforo o stock de un giro). */
export const saleValidators: ((ctx: Omit<SaleHookCtx, 'saleId' | 'total'> & { total: number }) => void)[] = []

export function customerBalance(db: Deps['db'], customerId: string): number {
  return (db.prepare('SELECT COALESCE(SUM(delta),0) b FROM credit_ledger WHERE customer_id = ?').get(customerId) as { b: number }).b
}

function resolveLine(deps: Deps, u: UserRow, branchId: string, it: z.infer<typeof itemSchema>): ResolvedLine {
  const { db } = deps
  const base = { input: it, ref: it.ref ?? null, category: it.category ?? null, presentationId: null, qtyMilli: null, priceChanged: false, cost: 0, itemId: newId() }
  if (!it.productId) {
    if (!it.description || it.quantity === undefined || it.unitPrice === undefined) throw bad('Cada renglón libre necesita descripción, cantidad y precio.')
    return { ...base, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: Math.round(it.quantity * it.unitPrice), productId: null }
  }
  const p = getProduct(db, u.business_id, it.productId)
  if (!p.active) throw bad(`${p.name} está desactivado.`)
  const category = it.category ?? p.category_id
  if (it.presentationId) {
    const pr = db.prepare('SELECT * FROM presentations WHERE id = ? AND product_id = ? AND active = 1').get(it.presentationId, p.id) as { id: string; name: string; factor_milli: number; price: number } | undefined
    if (!pr) throw bad('Esa presentación no existe.')
    const q = it.quantity ?? 1
    if (!Number.isInteger(q)) throw bad('Las presentaciones se venden completas.')
    const unitPrice = it.unitPrice ?? pr.price
    return { ...base, category, description: `${p.name} ${pr.name}`, quantity: q, unitPrice, total: unitPrice * q, productId: p.id, presentationId: pr.id, qtyMilli: q * pr.factor_milli, priceChanged: unitPrice !== pr.price, ref: p.id }
  }
  const price = currentPrice(db, branchId, p)
  if (it.amount !== undefined) {
    if (p.unit === 'pieza') throw bad(`${p.name} se vende por pieza, no por importe.`)
    if (!price) throw bad(`${p.name} no tiene precio.`)
    const qtyMilli = Math.round((it.amount * 1000) / price)
    return { ...base, category, description: p.name, quantity: qtyMilli / 1000, unitPrice: price, total: it.amount, productId: p.id, qtyMilli, ref: p.id }
  }
  const q = it.quantity
  if (q === undefined) throw bad(`Indica la cantidad de ${p.name}.`)
  if (p.unit === 'pieza' && !Number.isInteger(q)) throw bad(`${p.name} se vende por pieza.`)
  const qtyMilli = toMilli(q)
  if (it.unitPrice !== undefined && it.unitPrice !== price) {
    return { ...base, category, description: p.name, quantity: q, unitPrice: it.unitPrice, total: Math.round(q * it.unitPrice), productId: p.id, qtyMilli, priceChanged: true, ref: p.id }
  }
  const total = priceFor(db, branchId, p, qtyMilli)
  return { ...base, category, description: p.name, quantity: q, unitPrice: Math.round(total / q), total, productId: p.id, qtyMilli, ref: p.id }
}

function saleView(deps: Deps, s: SaleRow) {
  const items = deps.db.prepare('SELECT description, quantity, unit_price AS unitPrice, total, product_id AS productId FROM sale_items WHERE sale_id = ? ORDER BY rowid').all(s.id) as { description: string; quantity: number; unitPrice: number; total: number }[]
  return {
    id: s.id, folio: s.folio, shiftId: s.shift_id, subtotal: s.subtotal, promoDiscount: s.promo_discount, discount: s.discount, total: s.total, customerId: s.customer_id,
    paymentMethod: s.payment_method, cashReceived: s.cash_received, change: s.cash_received != null ? s.cash_received - s.total : null,
    status: s.status, cancelReason: s.cancel_reason, createdAt: s.created_at, items,
  }
}

sales.post('/sales', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(saleSchema, await body(c))

  // Idempotencia: la misma venta nunca se cobra dos veces.
  const prev = db.prepare('SELECT * FROM sales WHERE id = ?').get(d.id) as SaleRow | undefined
  if (prev) {
    if (prev.business_id !== u.business_id) throw conflict('Ese identificador ya está en uso.', 'id_repetido')
    return c.json({ duplicate: true, sale: saleView(deps, prev) })
  }

  const shift = (d.shiftId
    ? db.prepare('SELECT id, branch_id, status FROM shifts WHERE id = ? AND cashier_id = ?').get(d.shiftId, u.id)
    : db.prepare("SELECT id, branch_id, status FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id)) as { id: string; branch_id: string; status: string } | undefined
  if (!shift) throw conflict('Abre tu caja con el fondo inicial para poder vender.', 'caja_cerrada')
  if (shift.status !== 'abierto') throw conflict('Ese turno ya tiene corte; la venta no se puede agregar.', 'turno_cerrado')

  const lines = d.items.map((it) => resolveLine(deps, u, shift.branch_id, it))
  const subtotal = lines.reduce((a, l) => a + l.total, 0)
  if (d.customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ? AND business_id = ?').get(d.customerId, u.business_id)) throw bad('Ese cliente no existe.')
  const t = now()
  // La hora de la venta es la del equipo (puede venir de una caja sin internet), sin aceptar fechas futuras.
  const createdAt = d.createdAt && new Date(d.createdAt) <= t ? d.createdAt : iso(t)
  // Promociones vigentes: se aplican solas, sin código (las definió el dueño).
  const promo = moduleOn(db, u.business_id, 'promociones') ? bestPromotions(activePromotions(db, u.business_id, createdAt), lines) : { total: 0, applied: [] }
  const discount = d.discount ?? 0
  if (discount > subtotal - promo.total) throw bad('El descuento no puede ser mayor al total.')
  const total = subtotal - promo.total - discount
  if (d.cashReceived !== undefined) {
    if (d.paymentMethod !== 'efectivo') throw bad('El efectivo recibido solo aplica a pagos en efectivo.')
    if (d.cashReceived < total) throw bad('El efectivo recibido no alcanza.', 'efectivo_insuficiente')
  }
  for (const v of saleValidators) v({ deps, user: u, branchId: shift.branch_id, shiftId: shift.id, input: d, lines, total })

  let discountAuth: string | null = null
  if (discount > 0) {
    if (!hasPerm(u, 'cancel_discount')) throw forbidden('No tienes permiso para dar descuentos.')
    discountAuth = authorize(deps, u, d.authCode, 'cancel_discount', 'descuento').id
  }
  let priceAuth: string | null = null
  if (lines.some((l) => l.priceChanged)) {
    if (!hasPerm(u, 'change_prices')) throw forbidden('No tienes permiso para cambiar precios.')
    priceAuth = authorize(deps, u, d.authCode, 'change_prices', 'cambio de precio en venta').id
  }
  let creditAuth: string | null = null
  if (d.paymentMethod === 'fiado') {
    if (!d.customerId) throw bad('Para fiar elige al cliente.')
    if (!hasPerm(u, 'customers_credit')) throw forbidden('No tienes permiso para fiar.')
    const cu = db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(d.customerId) as { credit_limit: number }
    // Pasar el límite de crédito requiere el código del dueño.
    if (customerBalance(db, d.customerId) + total > cu.credit_limit) creditAuth = authorize(deps, u, d.authCode, 'customers_credit', 'fiado sobre el límite', { ownerOnly: true }).id
  }

  db.transaction(() => {
    db.prepare('INSERT INTO sale_counters (branch_id, last) VALUES (?, 0) ON CONFLICT(branch_id) DO NOTHING').run(shift.branch_id)
    db.prepare('UPDATE sale_counters SET last = last + 1 WHERE branch_id = ?').run(shift.branch_id)
    const folio = (db.prepare('SELECT last FROM sale_counters WHERE branch_id = ?').get(shift.branch_id) as { last: number }).last
    db.prepare(
      `INSERT INTO sales (id, business_id, branch_id, shift_id, folio, cashier_id, subtotal, promo_discount, discount, total, payment_method, discount_authorized_by, price_authorized_by, credit_authorized_by, customer_id, cash_received, created_at, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(d.id, u.business_id, shift.branch_id, shift.id, folio, u.id, subtotal, promo.total, discount, total, d.paymentMethod, discountAuth, priceAuth, creditAuth, d.customerId ?? null, d.cashReceived ?? null, createdAt, iso(t))
    const ctx = { db, now, businessId: u.business_id, branchId: shift.branch_id, userId: u.id }
    const ins = db.prepare('INSERT INTO sale_items (id, sale_id, description, quantity, unit_price, total, ref, category, product_id, presentation_id, qty_milli, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    for (const l of lines) {
      if (l.productId && l.qtyMilli) l.cost = consume(ctx, l.productId, l.qtyMilli, 'venta', d.id).cost
      ins.run(l.itemId, d.id, l.description, l.quantity, l.unitPrice, l.total, l.ref, l.category, l.productId, l.presentationId, l.qtyMilli, l.cost)
      if (l.priceChanged) audit(db, now, { businessId: u.business_id, userId: u.id, action: 'venta.cambio_precio', entity: 'sale', entityId: d.id, newValue: { description: l.description, unitPrice: l.unitPrice }, authorizedBy: priceAuth })
    }
    for (const p of promo.applied) db.prepare('INSERT INTO sale_promotions (sale_id, promotion_id, amount) VALUES (?,?,?)').run(d.id, p.id, p.amount)
    if (d.customerId) earnForSale(db, now, u.business_id, u.id, d.customerId, d.id, total)
    if (d.paymentMethod === 'fiado') {
      db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, sale_id, shift_id, created_by, created_at) VALUES (?,?,?,?,'cargo',?,?,?,?)").run(newId(), u.business_id, d.customerId!, total, d.id, shift.id, u.id, createdAt)
      if (creditAuth) audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fiado.sobre_limite', entity: 'customer', entityId: d.customerId!, newValue: { total }, authorizedBy: creditAuth })
    }
    if (discount > 0) audit(db, now, { businessId: u.business_id, userId: u.id, action: 'venta.descuento', entity: 'sale', entityId: d.id, newValue: { subtotal, discount, total }, authorizedBy: discountAuth })
    for (const h of saleHooks) h({ deps, user: u, saleId: d.id, branchId: shift.branch_id, shiftId: shift.id, input: d, lines, total })
  })()
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(d.id) as SaleRow
  return c.json({ duplicate: false, sale: saleView(deps, sale) }, 201)
})

function loadSale(c: C): SaleRow {
  const s = c.get('deps').db.prepare('SELECT * FROM sales WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as SaleRow | undefined
  if (!s) throw notFound('No se encontró esa venta.')
  return s
}

/** Ve la venta quien la cobró, o quien puede ver reportes. */
function ensureCanSee(c: C, s: SaleRow) {
  const u = c.get('session').user
  if (s.cashier_id !== u.id && !hasPerm(u, 'view_reports')) throw forbidden()
}

sales.get('/sales', (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  const shiftId = c.req.query('shiftId')
  const all = hasPerm(u, 'view_reports')
  if (!shiftId && !all) throw forbidden()
  const rows = deps.db
    .prepare(`SELECT * FROM sales WHERE business_id = ? ${shiftId ? 'AND shift_id = ?' : ''} ${all ? '' : 'AND cashier_id = ?'} ORDER BY folio DESC LIMIT 500`)
    .all(...[u.business_id, ...(shiftId ? [shiftId] : []), ...(all ? [] : [u.id])]) as SaleRow[]
  return c.json({ sales: rows.map((s) => saleView(deps, s)) })
})

sales.get('/sales/:id', (c) => {
  const s = loadSale(c)
  ensureCanSee(c, s)
  return c.json({ sale: saleView(c.get('deps'), s) })
})

sales.post('/sales/:id/cancel', requirePerm('cancel_discount'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const s = loadSale(c)
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300), authCode: z.string().optional() }), await body(c))
  if (s.status === 'cancelada') throw conflict('Esa venta ya estaba cancelada.', 'ya_cancelada')
  const shift = db.prepare('SELECT status FROM shifts WHERE id = ?').get(s.shift_id) as { status: string }
  if (shift.status !== 'abierto') throw conflict('El turno de esa venta ya tiene corte; no se puede cancelar.', 'turno_cerrado')
  const auth = authorize(deps, u, d.authCode, 'cancel_discount', 'cancelación')
  db.transaction(() => {
    db.prepare("UPDATE sales SET status='cancelada', cancelled_by=?, cancel_authorized_by=?, cancel_reason=?, cancelled_at=? WHERE id=?").run(u.id, auth.id, d.reason, iso(now()), s.id)
    reverseSalePoints(db, now, u.business_id, u.id, s.id)
    restore({ db, now, businessId: u.business_id, branchId: s.branch_id, userId: u.id }, s.id, 'cancelacion')
    if (s.payment_method === 'fiado' && s.customer_id) db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, sale_id, created_by, created_at) VALUES (?,?,?,?,'cancelacion',?,?,?)").run(newId(), u.business_id, s.customer_id, -s.total, s.id, u.id, iso(now()))
    for (const h of cancelHooks) h({ deps, user: u, saleId: s.id })
  })()
  audit(db, now, {
    businessId: u.business_id, userId: u.id, action: 'venta.cancelacion', entity: 'sale', entityId: s.id,
    oldValue: { status: 'completada', total: s.total }, newValue: { status: 'cancelada' }, authorizedBy: auth.id, reason: d.reason,
  })
  return c.json({ sale: saleView(deps, db.prepare('SELECT * FROM sales WHERE id = ?').get(s.id) as SaleRow) })
})

// Ticket: logo, teléfono, folio, fecha, productos, cantidades, total, forma de pago y cajero.
sales.get('/sales/:id/ticket', (c) => {
  const deps = c.get('deps')
  const { db } = deps
  const s = loadSale(c)
  ensureCanSee(c, s)
  const biz = db.prepare('SELECT name, phone, logo_url FROM businesses WHERE id = ?').get(s.business_id) as { name: string; phone: string | null; logo_url: string | null }
  const cashier = db.prepare('SELECT name FROM users WHERE id = ?').get(s.cashier_id) as { name: string }
  const v = saleView(deps, s)
  const ticket = {
    business: biz.name, logoUrl: biz.logo_url, phone: biz.phone, folio: String(s.folio).padStart(6, '0'), date: s.created_at,
    items: v.items, subtotal: s.subtotal, discount: s.discount + s.promo_discount, total: s.total, paymentMethod: s.payment_method, cashier: cashier.name,
    cancelled: s.status === 'cancelada',
  }
  return c.json({ ticket, text: ticketText(ticket) })
})

const mxn = (cents: number) => `$${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function ticketText(t: { business: string; phone: string | null; folio: string; date: string; items: { description: string; quantity: number; total: number }[]; subtotal: number; discount: number; total: number; paymentMethod: string; cashier: string; cancelled: boolean }) {
  const W = 32
  const row = (l: string, r: string) => l.slice(0, W - r.length - 1).padEnd(W - r.length) + r
  const fecha = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(t.date))
  return [
    t.business, t.phone ? `Tel. ${t.phone}` : '', `Folio ${t.folio}`, fecha, t.cancelled ? '*** CANCELADO ***' : '', '-'.repeat(W),
    ...t.items.map((i) => row(`${i.quantity} ${i.description}`, mxn(i.total))),
    '-'.repeat(W),
    ...(t.discount ? [row('Subtotal', mxn(t.subtotal)), row('Descuento', `-${mxn(t.discount)}`)] : []),
    row('TOTAL', mxn(t.total)), `Pago: ${t.paymentMethod}`, `Atendió: ${t.cashier}`,
  ].filter((l) => l !== '').join('\n')
}
