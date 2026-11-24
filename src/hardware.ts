import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, hasPerm, parse, requirePerm, type C, type Env } from './context.js'
import { addLot, fromMilli, getProduct, toMilli } from './inventory.js'
import { createSale, parseSale, tierPrice, type SaleRow } from './sales.js'
import { bad, conflict, forbidden, iso, localDate, newId, notFound } from './util.js'
import { scopeBranch } from './scope.js'
import { assertCashAvailable } from './cash.js'

/** Ferretería (y cualquier giro que lo necesite): escalas de precio, claves de proveedor, cotizaciones y devoluciones. */
export const hardware = new Hono<Env>()

// ---------- Escalas de precio por volumen ----------

hardware.get('/products/:id/price-tiers', (c) => {
  const { db } = c.get('deps')
  const p = getProduct(db, c.get('session').user.business_id, c.req.param('id'))
  const rows = db.prepare('SELECT min_milli, price FROM price_tiers WHERE product_id = ? ORDER BY min_milli').all(p.id) as { min_milli: number; price: number }[]
  return c.json({ tiers: rows.map((r) => ({ minQuantity: fromMilli(r.min_milli), price: r.price })) })
})

/** El dueño o encargado configura las escalas; la caja las aplica sola. Reemplaza la lista completa. */
hardware.put('/products/:id/price-tiers', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = getProduct(db, u.business_id, c.req.param('id'))
  const d = parse(z.object({ tiers: z.array(z.object({ minQuantity: z.number().positive(), price: z.number().int().min(0) })).max(20) }), await body(c))
  const mins = d.tiers.map((t) => toMilli(t.minQuantity))
  if (new Set(mins).size !== mins.length) throw bad('Hay dos escalas con la misma cantidad.')
  const old = db.prepare('SELECT min_milli, price FROM price_tiers WHERE product_id = ?').all(p.id)
  db.transaction(() => {
    db.prepare('DELETE FROM price_tiers WHERE product_id = ?').run(p.id)
    for (const t of d.tiers) db.prepare('INSERT INTO price_tiers (product_id, min_milli, price) VALUES (?,?,?)').run(p.id, toMilli(t.minQuantity), t.price)
    db.prepare('UPDATE products SET version = version + 1, updated_at = ? WHERE id = ?').run(iso(now()), p.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'producto.escalas', entity: 'product', entityId: p.id, oldValue: old, newValue: d.tiers })
  })()
  return c.json({ ok: true })
})

// ---------- Clave del proveedor por producto ----------

hardware.put('/products/:id/supplier-codes', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = getProduct(db, u.business_id, c.req.param('id'))
  const d = parse(z.object({ supplierId: z.string(), code: z.string().trim().min(1).max(60) }), await body(c))
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND business_id = ?').get(d.supplierId, u.business_id)) throw bad('Ese proveedor no existe.')
  const taken = db.prepare('SELECT product_id FROM product_suppliers WHERE supplier_id = ? AND supplier_code = ? AND product_id != ?').get(d.supplierId, d.code, p.id)
  if (taken) throw conflict('Esa clave ya está asignada a otro producto de este proveedor.', 'clave_repetida')
  db.prepare('INSERT INTO product_suppliers (product_id, supplier_id, supplier_code) VALUES (?,?,?) ON CONFLICT(product_id, supplier_id) DO UPDATE SET supplier_code = excluded.supplier_code').run(p.id, d.supplierId, d.code)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'producto.clave_proveedor', entity: 'product', entityId: p.id, newValue: d })
  return c.json({ ok: true })
})

hardware.get('/suppliers/:id/codes/:code', requirePerm('edit_inventory'), (c) => {
  const { db } = c.get('deps')
  const r = db.prepare('SELECT ps.product_id FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE s.business_id = ? AND ps.supplier_id = ? AND ps.supplier_code = ?').get(c.get('session').user.business_id, c.req.param('id'), c.req.param('code')) as { product_id: string } | undefined
  if (!r) throw notFound('Ningún producto tiene esa clave con este proveedor.')
  return c.json({ productId: r.product_id })
})

// ---------- Cotizaciones ----------

interface QuoteItem { productId?: string; presentationId?: string; description: string; quantity: number; unitPrice: number; total: number }
interface QuoteRow { id: string; business_id: string; folio: number; customer_id: string | null; customer_name: string | null; items: string; total: number; valid_until: string; status: string; sale_id: string | null; created_at: string }

const quoteView = (q: QuoteRow) => ({ id: q.id, folio: q.folio, customerId: q.customer_id, customerName: q.customer_name, items: JSON.parse(q.items) as QuoteItem[], total: q.total, validUntil: q.valid_until, status: q.status, saleId: q.sale_id, createdAt: q.created_at })

/** Cotización: no aparta existencia. Los precios quedan fijos hasta su vigencia. */
hardware.post('/quotes', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(
    z.object({
      customerId: z.string().optional(), customerName: z.string().trim().max(100).optional(), validDays: z.number().int().min(1).max(90).default(15), authCode: z.string().optional(),
      items: z.array(z.object({ productId: z.string().optional(), presentationId: z.string().optional(), description: z.string().trim().min(1).max(200).optional(), quantity: z.number().positive(), unitPrice: z.number().int().min(0).optional() })).min(1).max(300),
    }),
    await body(c),
  )
  if (!u.branch_id) throw bad('Tu usuario no tiene sucursal.')
  if (d.customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ? AND business_id = ?').get(d.customerId, u.business_id)) throw bad('Ese cliente no existe.')
  let changed = false
  const items: QuoteItem[] = d.items.map((it) => {
    if (!it.productId) {
      if (!it.description || it.unitPrice === undefined) throw bad('Cada renglón libre necesita descripción y precio.')
      return { description: it.description, quantity: it.quantity, unitPrice: it.unitPrice, total: Math.round(it.quantity * it.unitPrice) }
    }
    const p = getProduct(db, u.business_id, it.productId)
    let system: number
    let name = p.name
    if (it.presentationId) {
      const pr = db.prepare('SELECT name, price FROM presentations WHERE id = ? AND product_id = ?').get(it.presentationId, p.id) as { name: string; price: number } | undefined
      if (!pr) throw bad('Esa presentación no existe.')
      system = pr.price
      name = `${p.name} ${pr.name}`
    } else {
      if (p.unit === 'pieza' && !Number.isInteger(it.quantity)) throw bad(`${p.name} se vende por pieza.`)
      system = tierPrice(db, p.id, toMilli(it.quantity)) ?? (db.prepare('SELECT price FROM lots WHERE branch_id = ? AND product_id = ? AND qty_remaining_milli > 0 ORDER BY received_at LIMIT 1').get(u.branch_id, p.id) as { price: number } | undefined)?.price ?? p.price
    }
    const unitPrice = it.unitPrice ?? system
    if (unitPrice !== system) changed = true
    return { productId: p.id, presentationId: it.presentationId, description: name, quantity: it.quantity, unitPrice, total: Math.round(it.quantity * unitPrice) }
  })
  let priceAuth: string | null = null
  if (changed) {
    if (!hasPerm(u, 'change_prices')) throw forbidden('No tienes permiso para cambiar precios.')
    priceAuth = authorize(deps, u, d.authCode, 'change_prices', 'precio especial en cotización').id
  }
  const id = newId()
  const total = items.reduce((a, i) => a + i.total, 0)
  const validUntil = localDate(new Date(now().getTime() + d.validDays * 86_400_000))
  db.transaction(() => {
    const folio = ((db.prepare('SELECT MAX(folio) m FROM quotes WHERE business_id = ?').get(u.business_id) as { m: number | null }).m ?? 0) + 1
    db.prepare('INSERT INTO quotes (id, business_id, branch_id, folio, customer_id, customer_name, items, total, valid_until, price_authorized_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, u.branch_id, folio, d.customerId ?? null, d.customerName ?? null, JSON.stringify(items), total, validUntil, priceAuth, u.id, iso(now()),
    )
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cotizacion.alta', entity: 'quote', entityId: id, newValue: { total, items: items.length }, authorizedBy: priceAuth })
  })()
  return c.json({ quote: quoteView(db.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as QuoteRow) }, 201)
})

hardware.get('/quotes', requirePerm('sell'), (c) => {
  const status = c.req.query('status') ?? 'abierta'
  const br = scopeBranch(c)
  const rows = c.get('deps').db.prepare(`SELECT * FROM quotes WHERE business_id = ? AND status = ? ${br ? 'AND branch_id = ?' : ''} ORDER BY folio DESC LIMIT 200`).all(c.get('session').user.business_id, status, ...(br ? [br] : [])) as QuoteRow[]
  return c.json({ quotes: rows.map(quoteView) })
})

function loadQuote(c: C) {
  const q = c.get('deps').db.prepare('SELECT * FROM quotes WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as QuoteRow | undefined
  if (!q) throw notFound('No se encontró esa cotización.')
  return q
}

hardware.get('/quotes/:id', requirePerm('sell'), (c) => c.json({ quote: quoteView(loadQuote(c)) }))

/** Convertir en venta: ahora sí descuenta existencia, con los precios cotizados. */
hardware.post('/quotes/:id/convert', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const q = loadQuote(c)
  if (q.status !== 'abierta') throw conflict(`Esa cotización ya está ${q.status}.`, 'cotizacion_cerrada')
  if (q.valid_until < localDate(now())) throw conflict('La cotización ya venció. Haz una nueva con los precios de hoy.', 'cotizacion_vencida')
  const raw = (await body(c)) as Record<string, unknown>
  const items = (JSON.parse(q.items) as QuoteItem[]).map((i) => (i.productId ? { productId: i.productId, presentationId: i.presentationId, quantity: i.quantity, unitPrice: i.unitPrice } : { description: i.description, quantity: i.quantity, unitPrice: i.unitPrice }))
  const input = parseSale({ ...raw, id: (raw.id as string | undefined) ?? newId(), items, customerId: (raw.customerId as string | undefined) ?? q.customer_id ?? undefined })
  const result = db.transaction(() => {
    const r = createSale(deps, u, input, { trustedPrices: true })
    db.prepare("UPDATE quotes SET status = 'vendida', sale_id = ? WHERE id = ?").run(r.sale.id, q.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cotizacion.venta', entity: 'quote', entityId: q.id, newValue: { saleId: r.sale.id } })
    return r
  })()
  return c.json(result, 201)
})

hardware.post('/quotes/:id/cancel', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const q = loadQuote(c)
  if (q.status !== 'abierta') throw conflict(`Esa cotización ya está ${q.status}.`)
  db.prepare("UPDATE quotes SET status = 'cancelada' WHERE id = ?").run(q.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cotizacion.cancelada', entity: 'quote', entityId: q.id })
  return c.json({ ok: true })
})

// ---------- Devoluciones ----------

const returnBody = z.object({
  id: z.string().uuid().optional(),
  /** Con ticket: la venta original. Sin ticket: se omite y se indican producto y monto. */
  saleId: z.string().optional(),
  items: z.array(z.object({ saleItemId: z.string().optional(), productId: z.string().optional(), quantity: z.number().positive(), amount: z.number().int().min(0).optional(), restock: z.boolean().default(true), /** Perfumería: el producto regresa sellado / sin usar. */ sealed: z.boolean().optional() })).min(1).max(100),
  refundMethod: z.enum(['efectivo', 'transferencia', 'tarjeta', 'saldo']),
  customerId: z.string().optional(),
  reason: z.string().trim().min(3).max(300),
  authCode: z.string().optional(),
})

/** Validaciones extra por giro (p. ej. perfumería: solo productos sellados). */
export const returnValidators: ((ctx: { c: C; productId: string | null; input: z.infer<typeof returnBody>['items'][number] }) => void)[] = []

hardware.post('/returns', requirePerm('cancel_discount'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(returnBody, await body(c))
  if (d.id) {
    const prev = db.prepare('SELECT id, amount FROM returns WHERE id = ? AND business_id = ?').get(d.id, u.business_id)
    if (prev) return c.json({ duplicate: true, return: prev })
  }
  // Toda devolución, con o sin ticket, requiere código.
  const auth = authorize(deps, u, d.authCode, 'cancel_discount', d.saleId ? 'devolución con ticket' : 'devolución sin ticket')
  const sale = d.saleId ? (db.prepare('SELECT * FROM sales WHERE id = ? AND business_id = ?').get(d.saleId, u.business_id) as (SaleRow & { status: string }) | undefined) : undefined
  if (d.saleId && !sale) throw notFound('No se encontró el ticket original.')
  if (sale?.status === 'cancelada') throw conflict('Esa venta está cancelada.', 'venta_cancelada')
  const shift = db.prepare("SELECT id, branch_id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string; branch_id: string } | undefined
  if (d.refundMethod === 'efectivo' && !shift) throw conflict('Abre tu caja para devolver en efectivo.', 'caja_cerrada')
  const customerId = d.customerId ?? sale?.customer_id ?? null
  if (d.refundMethod === 'saldo' && !customerId) throw bad('Para dejar saldo a favor elige al cliente.')
  // Una venta fiada se devuelve bajando la deuda, no con dinero.
  if (sale?.payment_method === 'fiado' && d.refundMethod !== 'saldo') throw bad('Esa venta fue fiada: la devolución se abona a la cuenta del cliente (saldo).')
  const branchId = sale?.branch_id ?? shift?.branch_id ?? u.branch_id!

  const lines = d.items.map((it) => {
    if (sale) {
      if (!it.saleItemId) throw bad('Indica qué renglón del ticket se devuelve.')
      const si = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(it.saleItemId, sale.id) as { id: string; product_id: string | null; description: string; quantity: number; qty_milli: number | null; total: number; cost: number } | undefined
      if (!si) throw bad('Ese renglón no es de este ticket.')
      const returned = (db.prepare('SELECT COALESCE(SUM(qty_milli),0) q FROM return_items WHERE sale_item_id = ?').get(si.id) as { q: number }).q
      const soldMilli = toMilli(si.quantity)
      const qMilli = toMilli(it.quantity)
      if (returned + qMilli > soldMilli) throw conflict(`De "${si.description}" solo quedan ${fromMilli(soldMilli - returned)} por devolver.`, 'devolucion_excede')
      // Se devuelve lo que se cobró en proporción (con su parte de descuentos de la venta).
      const paidShare = sale.subtotal ? si.total * (sale.total / sale.subtotal) : 0
      const amount = Math.round((paidShare * qMilli) / soldMilli)
      const stockMilli = si.qty_milli ? Math.round((si.qty_milli * qMilli) / soldMilli) : 0
      const unitCost = si.qty_milli ? (si.cost * 1000) / si.qty_milli : 0
      for (const v of returnValidators) v({ c, productId: si.product_id, input: it })
      return { saleItemId: si.id, productId: si.product_id, description: si.description, qMilli, stockMilli, amount, unitCost, restock: it.restock }
    }
    if (!it.productId || it.amount === undefined) throw bad('Sin ticket indica el producto y el monto a devolver.')
    const p = getProduct(db, u.business_id, it.productId)
    for (const v of returnValidators) v({ c, productId: p.id, input: it })
    return { saleItemId: null, productId: p.id, description: p.name, qMilli: toMilli(it.quantity), stockMilli: toMilli(it.quantity), amount: it.amount, unitCost: p.last_cost, restock: it.restock }
  })
  const amount = lines.reduce((a, l) => a + l.amount, 0)
  const id = d.id ?? newId()
  db.transaction(() => {
    db.prepare('INSERT INTO returns (id, business_id, branch_id, sale_id, shift_id, customer_id, amount, refund_method, reason, authorized_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, branchId, sale?.id ?? null, shift?.id ?? null, customerId, amount, d.refundMethod, d.reason, auth.id, u.id, iso(now()),
    )
    const ctx = { db, now, businessId: u.business_id, branchId, userId: u.id }
    for (const l of lines) {
      db.prepare('INSERT INTO return_items (id, return_id, sale_item_id, product_id, description, qty_milli, amount, restocked) VALUES (?,?,?,?,?,?,?,?)').run(newId(), id, l.saleItemId, l.productId, l.description, l.qMilli, l.amount, l.restock ? 1 : 0)
      // Lo que regresa en buen estado vuelve al inventario como lote nuevo a su costo; lo dañado no.
      if (l.productId && l.stockMilli && l.restock) {
        const p = getProduct(db, u.business_id, l.productId)
        const price = (db.prepare('SELECT price FROM lots WHERE branch_id = ? AND product_id = ? AND qty_remaining_milli > 0 ORDER BY received_at LIMIT 1').get(branchId, p.id) as { price: number } | undefined)?.price ?? p.price
        addLot(ctx, { productId: p.id, qtyMilli: l.stockMilli, unitCost: l.unitCost, price, type: 'devolucion', refId: id })
      }
    }
    if (d.refundMethod === 'efectivo') assertCashAvailable(db, shift!.id, amount, 'esta devolución')
    if (d.refundMethod === 'efectivo') db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift!.id, amount, `Devolución: ${d.reason}`, u.id, iso(now()))
    // Saldo a favor (o regreso de fiado): abono a la cuenta del cliente.
    if (d.refundMethod === 'saldo') {
      db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, sale_id, note, created_by, created_at) VALUES (?,?,?,?,'abono',?,?,?,?)").run(newId(), u.business_id, customerId, -amount, sale?.id ?? null, `Devolución: ${d.reason}`, u.id, iso(now()))
    }
    audit(db, now, { businessId: u.business_id, userId: u.id, action: sale ? 'devolucion.con_ticket' : 'devolucion.sin_ticket', entity: 'return', entityId: id, newValue: { saleId: sale?.id ?? null, amount, method: d.refundMethod }, authorizedBy: auth.id, reason: d.reason })
  })()
  return c.json({ id, amount }, 201)
})
