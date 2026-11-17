import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, hasPerm, parse, requirePerm, type C, type Deps, type Env } from './context.js'
import { bad, conflict, forbidden, iso, newId, notFound } from './util.js'

export const sales = new Hono<Env>()

interface SaleRow {
  id: string; business_id: string; branch_id: string; shift_id: string; folio: number; cashier_id: string
  subtotal: number; discount: number; total: number; payment_method: string; status: string
  cancel_reason: string | null; created_at: string
}

const itemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: z.number().int('Usa centavos enteros').min(0),
})

const saleSchema = z.object({
  /** Identificador único creado en el equipo; el servidor ignora repetidos. */
  id: z.string().uuid(),
  items: z.array(itemSchema).min(1).max(200),
  paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']),
  discount: z.number().int().min(0).optional(),
  authCode: z.string().optional(),
  /** Turno en el que se cobró (útil al reenviar ventas hechas sin internet). */
  shiftId: z.string().uuid().optional(),
  createdAt: z.string().datetime().optional(),
})

function saleView(deps: Deps, s: SaleRow) {
  const items = deps.db.prepare('SELECT description, quantity, unit_price AS unitPrice, total FROM sale_items WHERE sale_id = ? ORDER BY rowid').all(s.id) as { description: string; quantity: number; unitPrice: number; total: number }[]
  return {
    id: s.id, folio: s.folio, shiftId: s.shift_id, subtotal: s.subtotal, discount: s.discount, total: s.total,
    paymentMethod: s.payment_method, status: s.status, cancelReason: s.cancel_reason, createdAt: s.created_at, items,
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
    ? db.prepare("SELECT id, branch_id, status FROM shifts WHERE id = ? AND cashier_id = ?").get(d.shiftId, u.id)
    : db.prepare("SELECT id, branch_id, status FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id)) as { id: string; branch_id: string; status: string } | undefined
  if (!shift) throw conflict('Abre tu caja con el fondo inicial para poder vender.', 'caja_cerrada')
  if (shift.status !== 'abierto') throw conflict('Ese turno ya tiene corte; la venta no se puede agregar.', 'turno_cerrado')

  const lines = d.items.map((i) => ({ ...i, total: Math.round(i.quantity * i.unitPrice) }))
  const subtotal = lines.reduce((a, l) => a + l.total, 0)
  const discount = d.discount ?? 0
  if (discount > subtotal) throw bad('El descuento no puede ser mayor al total.')
  let discountAuth: string | null = null
  if (discount > 0) {
    if (!hasPerm(u, 'cancel_discount')) throw forbidden('No tienes permiso para dar descuentos.')
    discountAuth = authorize(deps, u, d.authCode, 'cancel_discount', 'descuento').id
  }
  const total = subtotal - discount
  const t = now()
  // La hora de la venta es la del equipo (puede venir de una caja sin internet), sin aceptar fechas futuras.
  const createdAt = d.createdAt && new Date(d.createdAt) <= t ? d.createdAt : iso(t)

  db.transaction(() => {
    db.prepare('INSERT INTO sale_counters (branch_id, last) VALUES (?, 0) ON CONFLICT(branch_id) DO NOTHING').run(shift.branch_id)
    db.prepare('UPDATE sale_counters SET last = last + 1 WHERE branch_id = ?').run(shift.branch_id)
    const folio = (db.prepare('SELECT last FROM sale_counters WHERE branch_id = ?').get(shift.branch_id) as { last: number }).last
    db.prepare(
      `INSERT INTO sales (id, business_id, branch_id, shift_id, folio, cashier_id, subtotal, discount, total, payment_method, discount_authorized_by, created_at, received_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(d.id, u.business_id, shift.branch_id, shift.id, folio, u.id, subtotal, discount, total, d.paymentMethod, discountAuth, createdAt, iso(t))
    const ins = db.prepare('INSERT INTO sale_items (id, sale_id, description, quantity, unit_price, total) VALUES (?,?,?,?,?,?)')
    for (const l of lines) ins.run(newId(), d.id, l.description, l.quantity, l.unitPrice, l.total)
    if (discount > 0) {
      audit(db, now, { businessId: u.business_id, userId: u.id, action: 'venta.descuento', entity: 'sale', entityId: d.id, newValue: { subtotal, discount, total }, authorizedBy: discountAuth })
    }
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
  db.prepare("UPDATE sales SET status='cancelada', cancelled_by=?, cancel_authorized_by=?, cancel_reason=?, cancelled_at=? WHERE id=?").run(u.id, auth.id, d.reason, iso(now()), s.id)
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
    items: v.items, subtotal: s.subtotal, discount: s.discount, total: s.total, paymentMethod: s.payment_method, cashier: cashier.name,
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
