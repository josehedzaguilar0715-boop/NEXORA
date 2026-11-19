import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, parse, requirePerm, type C, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { fromMilli, stockOf } from './inventory.js'
import { createSale, parseSale, resolveLine } from './sales.js'
import { bad, conflict, iso, localDate, newId, notFound } from './util.js'

/**
 * Apartados con anticipo: el cliente aparta mercancía con precio fijo, deja un anticipo, abona y se la lleva al liquidar.
 * - El dinero (anticipo y abonos) entra a la caja al recibirlo; todavía no es venta (es un anticipo de cliente).
 * - Al entregar se registra la venta real: sale del inventario y cuenta como ingreso, pagada con lo abonado.
 * - Al cancelar (con código) se decide si se devuelve lo abonado; si no, queda como ingreso.
 * La mercancía apartada sigue en la tienda hasta entregarse, pero ya no está disponible para vender.
 */
export const layaways = new Hono<Env>()

const method = z.enum(['efectivo', 'transferencia', 'tarjeta'])
interface LayawayRow { id: string; business_id: string; branch_id: string; folio: number; customer_id: string; total: number; due_date: string | null; status: string; sale_id: string | null; cancel_reason: string | null; created_at: string; closed_at: string | null }

const paidOf = (db: Db, id: string) => (db.prepare('SELECT COALESCE(SUM(amount),0) v FROM layaway_payments WHERE layaway_id = ?').get(id) as { v: number }).v

/** Cantidad apartada (sin entregar) de un producto en una sucursal, en milésimas. */
export function reservedOf(db: Db, branchId: string, productId: string, exceptLayaway = ''): number {
  return (db.prepare("SELECT COALESCE(SUM(i.qty_milli),0) v FROM layaway_items i JOIN layaways l ON l.id = i.layaway_id WHERE l.branch_id = ? AND l.status = 'abierto' AND i.product_id = ? AND l.id <> ?").get(branchId, productId, exceptLayaway) as { v: number }).v
}

function view(db: Db, l: LayawayRow, today: string) {
  const paid = paidOf(db, l.id)
  const customer = db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(l.customer_id) as { id: string; name: string; phone: string | null }
  return {
    id: l.id, folio: l.folio, customer, total: l.total, paid, balance: l.total - paid, dueDate: l.due_date, status: l.status,
    overdue: l.status === 'abierto' && !!l.due_date && l.due_date < today, saleId: l.sale_id, cancelReason: l.cancel_reason, createdAt: l.created_at, closedAt: l.closed_at,
  }
}

function load(c: C): LayawayRow {
  const l = c.get('deps').db.prepare('SELECT * FROM layaways WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as LayawayRow | undefined
  if (!l) throw notFound('No se encontró ese apartado.')
  return l
}

function openShift(db: Db, u: UserRow) {
  return db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined
}

/** Registra dinero del apartado; en efectivo entra a la caja abierta. */
function recordPayment(db: Db, now: () => Date, u: UserRow, l: { id: string; folio: number }, kind: 'anticipo' | 'abono' | 'devolucion', amount: number, m: string) {
  const shift = openShift(db, u)
  if (m === 'efectivo' && !shift) throw conflict('Abre tu caja para recibir o devolver efectivo.', 'caja_cerrada')
  db.prepare('INSERT INTO layaway_payments (id, layaway_id, kind, amount, method, shift_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(newId(), l.id, kind, amount, m, shift?.id ?? null, u.id, iso(now()))
  if (m === 'efectivo') {
    const label = kind === 'anticipo' ? 'Anticipo' : kind === 'abono' ? 'Abono' : 'Devolución'
    db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at, origin) VALUES (?,?,?,?,?,?,?,'sistema')").run(newId(), shift!.id, amount > 0 ? 'deposito' : 'retiro', Math.abs(amount), `${label} apartado #${l.folio}`, u.id, iso(now()))
  }
}

layaways.post('/layaways', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(z.object({
    id: z.string().uuid().optional(),
    customerId: z.string(),
    items: z.array(z.object({ productId: z.string(), presentationId: z.string().optional(), quantity: z.number().positive() })).min(1).max(100),
    deposit: z.number().int().min(1, 'El anticipo debe ser mayor a cero.'),
    method,
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }), await body(c))
  if (d.id) { const prev = db.prepare('SELECT * FROM layaways WHERE id = ? AND business_id = ?').get(d.id, u.business_id) as LayawayRow | undefined; if (prev) return c.json({ layaway: view(db, prev, localDate(now())), duplicate: true }) }
  if (!db.prepare('SELECT 1 FROM customers WHERE id = ? AND business_id = ?').get(d.customerId, u.business_id)) throw bad('Elige al cliente del apartado.')
  const branchId = u.branch_id ?? (db.prepare('SELECT id FROM branches WHERE business_id = ? ORDER BY created_at LIMIT 1').get(u.business_id) as { id: string }).id
  // Precio de hoy (con mayoreo si aplica); queda fijo en el apartado.
  const lines = d.items.map((it) => resolveLine(deps, u, branchId, it))
  for (const l of lines) {
    if (!l.productId || !l.qtyMilli) throw bad('Solo se apartan productos del inventario.')
    const want = lines.filter((x) => x.productId === l.productId).reduce((a, x) => a + x.qtyMilli!, 0)
    const free = stockOf(db, branchId, l.productId) - reservedOf(db, branchId, l.productId)
    if (want > free) throw conflict(`De ${l.description} solo hay ${Math.max(0, fromMilli(free))} disponibles para apartar.`, 'sin_existencia')
  }
  const total = lines.reduce((a, l) => a + l.total, 0)
  if (d.deposit > total) throw bad('El anticipo no puede ser mayor que el total.')
  if (d.dueDate && d.dueDate < localDate(now())) throw bad('La fecha límite ya pasó.')
  const id = d.id ?? newId()
  db.transaction(() => {
    const folio = ((db.prepare('SELECT MAX(folio) m FROM layaways WHERE business_id = ?').get(u.business_id) as { m: number | null }).m ?? 0) + 1
    db.prepare('INSERT INTO layaways (id, business_id, branch_id, folio, customer_id, total, due_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, u.business_id, branchId, folio, d.customerId, total, d.dueDate ?? null, u.id, iso(now()))
    for (const l of lines) db.prepare('INSERT INTO layaway_items (id, layaway_id, product_id, presentation_id, description, quantity, qty_milli, unit_price, total) VALUES (?,?,?,?,?,?,?,?,?)').run(newId(), id, l.productId, l.presentationId, l.description, l.quantity, l.qtyMilli, l.unitPrice, l.total)
    recordPayment(db, now, u, { id, folio }, 'anticipo', d.deposit, d.method)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'apartado.alta', entity: 'layaway', entityId: id, newValue: { folio, total, deposit: d.deposit } })
  })()
  return c.json({ layaway: view(db, db.prepare('SELECT * FROM layaways WHERE id = ?').get(id) as LayawayRow, localDate(now())) }, 201)
})

layaways.get('/layaways', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const status = c.req.query('status') ?? 'abierto'
  const rows = db.prepare(`SELECT * FROM layaways WHERE business_id = ? ${status === 'todos' ? '' : 'AND status = ?'} ORDER BY folio DESC LIMIT 500`).all(...[c.get('session').user.business_id, ...(status === 'todos' ? [] : [status])]) as LayawayRow[]
  const today = localDate(now())
  return c.json({ layaways: rows.map((l) => view(db, l, today)) })
})

layaways.get('/layaways/:id', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const l = load(c)
  return c.json({
    layaway: view(db, l, localDate(now())),
    items: db.prepare('SELECT product_id AS productId, description, quantity, unit_price AS unitPrice, total FROM layaway_items WHERE layaway_id = ? ORDER BY rowid').all(l.id),
    payments: db.prepare('SELECT kind, amount, method, created_at AS createdAt FROM layaway_payments WHERE layaway_id = ? ORDER BY created_at, rowid').all(l.id),
  })
})

layaways.post('/layaways/:id/payments', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const l = load(c)
  if (l.status !== 'abierto') throw conflict('Ese apartado ya está cerrado.', 'apartado_cerrado')
  const d = parse(z.object({ amount: z.number().int().min(1), method }), await body(c))
  const balance = l.total - paidOf(db, l.id)
  if (d.amount > balance) throw bad(`Solo resta ${balance / 100}; el abono no puede ser mayor.`)
  db.transaction(() => {
    recordPayment(db, now, u, l, 'abono', d.amount, d.method)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'apartado.abono', entity: 'layaway', entityId: l.id, newValue: d })
  })()
  return c.json({ layaway: view(db, load(c), localDate(now())) }, 201)
})

/** Entregar: si falta algo se cobra en ese momento; se registra la venta (inventario e ingreso). */
layaways.post('/layaways/:id/deliver', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const l = load(c)
  if (l.status !== 'abierto') throw conflict('Ese apartado ya está cerrado.', 'apartado_cerrado')
  const d = parse(z.object({ method: method.optional() }), await body(c))
  const balance = l.total - paidOf(db, l.id)
  if (balance > 0 && !d.method) throw bad(`Resta ${balance / 100}: cóbralo para entregar.`, 'saldo_pendiente')
  const items = db.prepare('SELECT product_id, presentation_id, description, quantity, unit_price FROM layaway_items WHERE layaway_id = ? ORDER BY rowid').all(l.id) as { product_id: string; presentation_id: string | null; description: string; quantity: number; unit_price: number }[]
  let saleId = ''
  db.transaction(() => {
    if (balance > 0) recordPayment(db, now, u, l, 'abono', balance, d.method!)
    saleId = createSale(deps, u, parseSale({
      id: newId(), paymentMethod: 'efectivo', customerId: l.customer_id,
      items: items.map((i) => ({ productId: i.product_id, ...(i.presentation_id ? { presentationId: i.presentation_id } : {}), quantity: i.quantity, unitPrice: i.unit_price })),
    }), { trustedPrices: true, prepaid: true }).sale.id
    db.prepare("UPDATE layaways SET status = 'entregado', sale_id = ?, closed_at = ? WHERE id = ?").run(saleId, iso(now()), l.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'apartado.entregado', entity: 'layaway', entityId: l.id, newValue: { saleId, total: l.total } })
  })()
  return c.json({ layaway: view(db, load(c), localDate(now())), saleId })
})

/** Cancelar con código: se devuelve lo abonado o se queda como ingreso del negocio. */
layaways.post('/layaways/:id/cancel', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const l = load(c)
  if (l.status !== 'abierto') throw conflict('Ese apartado ya está cerrado.', 'apartado_cerrado')
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300), authCode: z.string().optional(), refund: z.boolean(), refundMethod: method.optional() }), await body(c))
  const auth = authorize(deps, u, d.authCode, 'cancel_discount', 'cancelar apartado')
  const paid = paidOf(db, l.id)
  db.transaction(() => {
    if (paid > 0 && d.refund) recordPayment(db, now, u, l, 'devolucion', -paid, d.refundMethod ?? 'efectivo')
    // Lo abonado que no se devuelve es ingreso: se registra como venta pagada con el anticipo.
    if (paid > 0 && !d.refund) createSale(deps, u, parseSale({ id: newId(), paymentMethod: 'efectivo', customerId: l.customer_id, items: [{ description: `Anticipo no reembolsado · apartado #${l.folio}`, quantity: 1, unitPrice: paid }] }), { trustedPrices: true, prepaid: true })
    db.prepare("UPDATE layaways SET status = 'cancelado', cancel_reason = ?, closed_at = ? WHERE id = ?").run(d.reason, iso(now()), l.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'apartado.cancelado', entity: 'layaway', entityId: l.id, newValue: { paid, refund: d.refund }, authorizedBy: auth.id, reason: d.reason })
  })()
  return c.json({ layaway: view(db, load(c), localDate(now())) })
})

/** Comprobante del apartado para el cliente. */
layaways.get('/layaways/:id/ticket', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const l = load(c)
  const v = view(db, l, localDate(now()))
  const biz = db.prepare('SELECT name, phone FROM businesses WHERE id = ?').get(l.business_id) as { name: string; phone: string | null }
  const items = db.prepare('SELECT description, quantity, total FROM layaway_items WHERE layaway_id = ? ORDER BY rowid').all(l.id) as { description: string; quantity: number; total: number }[]
  const pays = db.prepare('SELECT kind, amount, created_at FROM layaway_payments WHERE layaway_id = ? ORDER BY created_at, rowid').all(l.id) as { kind: string; amount: number; created_at: string }[]
  const W = 32
  const money = (n: number) => `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const row = (a: string, b: string) => a.slice(0, W - b.length - 1).padEnd(W - b.length) + b
  const fmt = (d: string) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short' }).format(new Date(d))
  const text = [
    biz.name, biz.phone ? `Tel. ${biz.phone}` : '', `APARTADO #${l.folio}`, `Cliente: ${v.customer.name}`, `Fecha: ${fmt(l.created_at)}`,
    l.due_date ? `Recoger a más tardar: ${l.due_date.split('-').reverse().join('/')}` : '', '='.repeat(W),
    ...items.map((i) => row(`${i.quantity} ${i.description}`, money(i.total))), '='.repeat(W),
    row('TOTAL', money(l.total)),
    ...pays.map((p) => row(`${p.kind === 'anticipo' ? 'Anticipo' : p.kind === 'abono' ? 'Abono' : 'Devolución'} ${fmt(p.created_at)}`, money(p.amount))),
    row('RESTA', money(v.balance)),
    l.status === 'entregado' ? 'ENTREGADO' : l.status === 'cancelado' ? 'CANCELADO' : 'La mercancía se entrega al liquidar.',
  ].filter(Boolean).join('\n')
  return c.json({ text })
})
