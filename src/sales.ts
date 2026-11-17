import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { earnForSale, moduleOn, reverseSalePoints } from './common.js'
import { activePromotions, bestPromotions } from './promotions.js'
import { body, hasPerm, parse, requirePerm, type C, type Deps, type Env, type UserRow } from './context.js'
import { consume, currentPrice, getProduct, priceFor, restore, toMilli, type MoveCtx } from './inventory.js'
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
    /** Servicio del catálogo (copias, corte, manicure, tarifa…). */
    serviceId: z.string().optional(),
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
    /** Pago mixto (con paymentMethod "efectivo"): lo que se paga con tarjeta o transferencia; el resto es efectivo. */
    otherPayments: z.array(z.object({ method: z.enum(['tarjeta', 'transferencia']), amount: z.number().int().min(1) })).max(4).optional(),
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
  ref: string | null; category: string | null; productId: string | null; presentationId: string | null; qtyMilli: number | null; serviceId: string | null
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

/** Convierte millonésimas a milésimas acumulando la fracción sobrante por sucursal y producto. */
export function carryMilli(db: Deps['db'], branchId: string, productId: string, micro: number): number {
  const prev = (db.prepare('SELECT micro FROM consumption_carry WHERE branch_id = ? AND product_id = ?').get(branchId, productId) as { micro: number } | undefined)?.micro ?? 0
  const total = prev + micro
  const milli = Math.floor(total / 1000)
  db.prepare('INSERT INTO consumption_carry (branch_id, product_id, micro) VALUES (?,?,?) ON CONFLICT(branch_id, product_id) DO UPDATE SET micro = excluded.micro').run(branchId, productId, total - milli * 1000)
  return milli
}

/**
 * Descuenta lo vendido: un combo descuenta sus componentes; un producto con existencia, sus lotes;
 * un platillo (sin existencia propia) solo su receta. Devuelve el costo.
 */
export function consumeProduct(ctx: MoveCtx, productId: string, qtyMilli: number, refId: string, depth = 0): number {
  const { db } = ctx
  const p = db.prepare('SELECT track_stock FROM products WHERE id = ?').get(productId) as { track_stock: number }
  const parts = db.prepare('SELECT product_id, qty_milli FROM combo_items WHERE combo_id = ?').all(productId) as { product_id: string; qty_milli: number }[]
  let cost = 0
  if (parts.length && depth < 3) for (const pt of parts) cost += consumeProduct(ctx, pt.product_id, Math.round((pt.qty_milli * qtyMilli) / 1000), refId, depth + 1)
  else if (p.track_stock) cost += consume(ctx, productId, qtyMilli, 'venta', refId).cost
  return cost + consumeRecipe(ctx, productId, qtyMilli / 1000, refId)
}

/** Insumos de una receta por `units` vendidas (millonésimas con acumulación exacta). */
export function consumeRecipe(ctx: MoveCtx, ownerId: string, units: number, refId: string): number {
  const recipe = ctx.db.prepare('SELECT product_id, qty_micro FROM recipes WHERE owner_id = ?').all(ownerId) as { product_id: string; qty_micro: number }[]
  let cost = 0
  for (const r of recipe) {
    const milli = carryMilli(ctx.db, ctx.branchId, r.product_id, Math.round(r.qty_micro * units))
    if (milli > 0) cost += consume(ctx, r.product_id, milli, 'consumo', refId).cost
  }
  return cost
}

/** Escalas de precio por volumen: la de mayor cantidad mínima que se alcance. */
export function tierPrice(db: Deps['db'], productId: string, qtyMilli: number): number | null {
  const t = db.prepare('SELECT price FROM price_tiers WHERE product_id = ? AND min_milli <= ? ORDER BY min_milli DESC LIMIT 1').get(productId, qtyMilli) as { price: number } | undefined
  return t?.price ?? null
}

function resolveLine(deps: Deps, u: UserRow, branchId: string, it: z.infer<typeof itemSchema>, trusted = false): ResolvedLine {
  const { db } = deps
  const base = { input: it, ref: it.ref ?? null, category: it.category ?? null, presentationId: null, qtyMilli: null, priceChanged: false, cost: 0, itemId: newId(), serviceId: null }
  if (it.serviceId) {
    const sv = db.prepare('SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1').get(it.serviceId, u.business_id) as { id: string; name: string; price: number; category: string | null } | undefined
    if (!sv) throw bad('Ese servicio no existe o está desactivado.')
    const q = it.quantity ?? 1
    const unitPrice = it.unitPrice ?? sv.price
    return { ...base, serviceId: sv.id, ref: sv.id, category: it.category ?? sv.category, description: it.description ?? sv.name, quantity: q, unitPrice, total: Math.round(q * unitPrice), productId: null, priceChanged: !trusted && unitPrice !== sv.price }
  }
  if (!it.productId) {
    if (!it.description || it.quantity === undefined || it.unitPrice === undefined) throw bad('Cada renglón libre necesita descripción, cantidad y precio.')
    return { ...base, description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: Math.round(it.quantity * it.unitPrice), productId: null }
  }
  const p = getProduct(db, u.business_id, it.productId)
  if (!p.active) throw bad(`${p.name} está desactivado.`)
  if (!p.sellable) throw bad(`${p.name} es de uso interno, no se vende.`)
  const category = it.category ?? p.category_id
  if (it.presentationId) {
    const pr = db.prepare('SELECT * FROM presentations WHERE id = ? AND product_id = ? AND active = 1').get(it.presentationId, p.id) as { id: string; name: string; factor_milli: number; price: number } | undefined
    if (!pr) throw bad('Esa presentación no existe.')
    const q = it.quantity ?? 1
    if (!Number.isInteger(q)) throw bad('Las presentaciones se venden completas.')
    const unitPrice = it.unitPrice ?? pr.price
    return { ...base, category, description: `${p.name} ${pr.name}`, quantity: q, unitPrice, total: unitPrice * q, productId: p.id, presentationId: pr.id, qtyMilli: q * pr.factor_milli, priceChanged: !trusted && unitPrice !== pr.price, ref: p.id }
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
  // La caja aplica sola la escala de precio por volumen.
  const tier = tierPrice(db, p.id, qtyMilli)
  const systemPrice = tier ?? price
  if (it.unitPrice !== undefined && (trusted || it.unitPrice !== systemPrice)) {
    return { ...base, category, description: p.name, quantity: q, unitPrice: it.unitPrice, total: Math.round(q * it.unitPrice), productId: p.id, qtyMilli, priceChanged: !trusted, ref: p.id }
  }
  if (tier !== null) return { ...base, category, description: p.name, quantity: q, unitPrice: tier, total: Math.round(q * tier), productId: p.id, qtyMilli, ref: p.id }
  const total = priceFor(db, branchId, p, qtyMilli)
  return { ...base, category, description: p.name, quantity: q, unitPrice: Math.round(total / q), total, productId: p.id, qtyMilli, ref: p.id }
}

export function saleView(deps: Deps, s: SaleRow) {
  const items = deps.db.prepare('SELECT description, quantity, unit_price AS unitPrice, total, product_id AS productId FROM sale_items WHERE sale_id = ? ORDER BY rowid').all(s.id) as { description: string; quantity: number; unitPrice: number; total: number }[]
  const payments = deps.db.prepare('SELECT method, amount FROM sale_payments WHERE sale_id = ? ORDER BY rowid').all(s.id) as { method: string; amount: number }[]
  const cashPart = payments.length ? payments.filter((p) => p.method === 'efectivo').reduce((a, p) => a + p.amount, 0) : s.total
  return {
    id: s.id, folio: s.folio, shiftId: s.shift_id, subtotal: s.subtotal, promoDiscount: s.promo_discount, discount: s.discount, total: s.total, customerId: s.customer_id,
    paymentMethod: payments.length > 1 ? 'mixto' : s.payment_method, payments, cashReceived: s.cash_received, change: s.cash_received != null ? s.cash_received - cashPart : null,
    status: s.status, cancelReason: s.cancel_reason, createdAt: s.created_at, items,
  }
}

sales.post('/sales', requirePerm('sell'), async (c) => {
  const d = parse(saleSchema, await body(c))
  const r = createSale(c.get('deps'), c.get('session').user, d)
  return c.json(r, r.duplicate ? 200 : 201)
})

export function parseSale(data: unknown): SaleInput {
  return parse(saleSchema, data)
}

/**
 * Registra una venta. `trustedPrices` solo lo usa el servidor (p. ej. al convertir una cotización ya
 * autorizada): acepta los precios dados sin pedir código.
 */
export function createSale(deps: Deps, u: UserRow, d: SaleInput, opts: { trustedPrices?: boolean } = {}): { duplicate: boolean; sale: ReturnType<typeof saleView> } {
  const { db, now } = deps
  if (!hasPerm(u, 'sell')) throw forbidden()
  // Idempotencia: la misma venta nunca se cobra dos veces.
  const prev = db.prepare('SELECT * FROM sales WHERE id = ?').get(d.id) as SaleRow | undefined
  if (prev) {
    if (prev.business_id !== u.business_id) throw conflict('Ese identificador ya está en uso.', 'id_repetido')
    return { duplicate: true, sale: saleView(deps, prev) }
  }

  const shift = (d.shiftId
    ? db.prepare('SELECT id, branch_id, status FROM shifts WHERE id = ? AND cashier_id = ?').get(d.shiftId, u.id)
    : db.prepare("SELECT id, branch_id, status FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id)) as { id: string; branch_id: string; status: string } | undefined
  if (!shift) throw conflict('Abre tu caja con el fondo inicial para poder vender.', 'caja_cerrada')
  if (shift.status !== 'abierto') throw conflict('Ese turno ya tiene corte; la venta no se puede agregar.', 'turno_cerrado')

  const lines = d.items.map((it) => resolveLine(deps, u, shift.branch_id, it, !!opts.trustedPrices))
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
  // Formas de pago de la venta. Mixto: tarjeta/transferencia y el resto en efectivo.
  const others = d.otherPayments ?? []
  if (others.length && d.paymentMethod !== 'efectivo') throw bad('El pago mixto se combina con efectivo.')
  const othersTotal = others.reduce((a, p) => a + p.amount, 0)
  if (othersTotal > total) throw bad(`Con tarjeta o transferencia van ${othersTotal / 100} y la venta es de ${total / 100}: revisa los montos.`, 'pago_no_cuadra')
  const cashPart = d.paymentMethod === 'efectivo' ? total - othersTotal : 0
  const payments = d.paymentMethod === 'efectivo'
    ? [...(cashPart > 0 || !others.length ? [{ method: 'efectivo', amount: cashPart }] : []), ...others]
    : [{ method: d.paymentMethod, amount: total }]
  if (d.cashReceived !== undefined) {
    if (d.paymentMethod !== 'efectivo') throw bad('El efectivo recibido solo aplica a pagos en efectivo.')
    if (d.cashReceived < cashPart) throw bad('El efectivo recibido no alcanza.', 'efectivo_insuficiente')
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
      if (l.productId && l.qtyMilli) l.cost = consumeProduct(ctx, l.productId, l.qtyMilli, d.id)
      // Receta del servicio: lo que gasta (tinta, papel, insumos), como inventario de uso.
      if (l.serviceId) l.cost += consumeRecipe(ctx, l.serviceId, l.quantity, d.id)
      ins.run(l.itemId, d.id, l.description, l.quantity, l.unitPrice, l.total, l.ref, l.category, l.productId, l.presentationId, l.qtyMilli, l.cost)
      if (l.serviceId) db.prepare('UPDATE sale_items SET service_id = ? WHERE id = ?').run(l.serviceId, l.itemId)
      if (l.priceChanged) audit(db, now, { businessId: u.business_id, userId: u.id, action: 'venta.cambio_precio', entity: 'sale', entityId: d.id, newValue: { description: l.description, unitPrice: l.unitPrice }, authorizedBy: priceAuth })
    }
    for (const p of payments) db.prepare('INSERT INTO sale_payments (id, sale_id, method, amount) VALUES (?,?,?,?)').run(newId(), d.id, p.method, p.amount)
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
  return { duplicate: false, sale: saleView(deps, sale) }
}

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

/** Buscar el ticket original por folio (devoluciones). */
sales.get('/sales/folio/:folio', (c) => {
  const u = c.get('session').user
  if (!hasPerm(u, 'cancel_discount') && !hasPerm(u, 'view_reports')) throw forbidden()
  const s = c.get('deps').db.prepare('SELECT * FROM sales WHERE business_id = ? AND branch_id = ? AND folio = ?').get(u.business_id, c.req.query('branchId') ?? u.branch_id, Number(c.req.param('folio'))) as SaleRow | undefined
  if (!s) throw notFound('No se encontró ese folio.')
  const items = c.get('deps').db.prepare('SELECT id, description, quantity, total FROM sale_items WHERE sale_id = ? ORDER BY rowid').all(s.id)
  return c.json({ sale: { ...saleView(c.get('deps'), s), items } })
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
    items: v.items, subtotal: s.subtotal, discount: s.discount + s.promo_discount, total: s.total, paymentMethod: v.paymentMethod, payments: v.payments, cashReceived: s.cash_received, change: v.change, cashier: cashier.name,
    cancelled: s.status === 'cancelada',
  }
  return c.json({ ticket, text: ticketText(ticket) })
})

const mxn = (cents: number) => `$${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', fiado: 'Fiado' }

function ticketText(t: { business: string; phone: string | null; folio: string; date: string; items: { description: string; quantity: number; total: number }[]; subtotal: number; discount: number; total: number; paymentMethod: string; payments: { method: string; amount: number }[]; cashReceived: number | null; change: number | null; cashier: string; cancelled: boolean }) {
  const W = 32
  const row = (l: string, r: string) => l.slice(0, W - r.length - 1).padEnd(W - r.length) + r
  const fecha = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date(t.date))
  return [
    t.business, t.phone ? `Tel. ${t.phone}` : '', `Folio ${t.folio}`, fecha, t.cancelled ? '*** CANCELADO ***' : '', '-'.repeat(W),
    ...t.items.map((i) => row(`${i.quantity} ${i.description}`, mxn(i.total))),
    '-'.repeat(W),
    ...(t.discount ? [row('Subtotal', mxn(t.subtotal)), row('Descuento', `-${mxn(t.discount)}`)] : []),
    row('TOTAL', mxn(t.total)),
    ...(t.payments.length > 1 ? t.payments.map((p) => row(METHOD[p.method] ?? p.method, mxn(p.amount))) : [`Pago: ${METHOD[t.paymentMethod] ?? t.paymentMethod}`]),
    ...(t.cashReceived != null ? [row('Recibido', mxn(t.cashReceived)), row('Cambio', mxn(t.change ?? 0))] : []),
    `Atendió: ${t.cashier}`, '', '¡Gracias por su compra!',
  ].filter((l) => l !== '').join('\n')
}
