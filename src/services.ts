import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, ownerOnly, parse, requirePerm, type C, type Env } from './context.js'
import type { Db } from './db.js'
import { getProduct, toMilli, fromMilli } from './inventory.js'
import { createSale, parseSale } from './sales.js'
import { bad, conflict, iso, newId, notFound } from './util.js'

/** Servicios, recetas (consumibles), combos, copiadoras con contador y encargos con anticipo. */
export const services = new Hono<Env>()

// ---------- Servicios ----------

const serviceBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(60).nullable().optional(),
  price: z.number().int().min(0),
  durationMin: z.number().int().min(0).max(24 * 60).nullable().optional(),
  /** Atributos del giro: tamaño (carta/oficio), color, técnica, tiempo de secado… */
  attrs: z.record(z.string(), z.unknown()).optional(),
  machineId: z.string().nullable().optional(),
  sheetsPerUnit: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
  /** Costo directo por servicio (centavos): material, insumos… Lo de la receta se suma aparte. */
  cost: z.number().int().min(0).optional(),
})

export interface ServiceRow { id: string; business_id: string; name: string; category: string | null; price: number; duration_min: number | null; attrs: string; machine_id: string | null; sheets_per_unit: number; active: number; cost?: number }
export const serviceView = (s: ServiceRow) => ({ id: s.id, name: s.name, category: s.category, price: s.price, durationMin: s.duration_min, attrs: JSON.parse(s.attrs), machineId: s.machine_id, sheetsPerUnit: s.sheets_per_unit, active: !!s.active, cost: s.cost ?? 0 })

export function loadService(db: Db, businessId: string, id: string): ServiceRow {
  const s = db.prepare('SELECT * FROM services WHERE id = ? AND business_id = ?').get(id, businessId) as ServiceRow | undefined
  if (!s) throw notFound('No se encontró ese servicio.')
  return s
}

services.get('/services', (c) => {
  const rows = c.get('deps').db.prepare('SELECT * FROM services WHERE business_id = ? ORDER BY category, name').all(c.get('session').user.business_id) as ServiceRow[]
  return c.json({ services: rows.map(serviceView) })
})

services.post('/services', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(serviceBody, await body(c))
  if (d.machineId && !db.prepare('SELECT 1 FROM machines WHERE id = ? AND business_id = ?').get(d.machineId, u.business_id)) throw bad('Ese equipo no existe.')
  const id = newId()
  db.prepare('INSERT INTO services (id, business_id, name, category, price, duration_min, attrs, machine_id, sheets_per_unit, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, u.business_id, d.name, d.category ?? null, d.price, d.durationMin ?? null, JSON.stringify(d.attrs ?? {}), d.machineId ?? null, d.sheetsPerUnit ?? 0, d.cost ?? 0, iso(now()),
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'servicio.alta', entity: 'service', entityId: id, newValue: d })
  return c.json({ service: serviceView(loadService(db, u.business_id, id)) }, 201)
})

services.patch('/services/:id', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const s = loadService(db, u.business_id, c.req.param('id'))
  const d = parse(serviceBody.partial().extend({ authCode: z.string().optional() }), await body(c))
  // Cambiar el precio de un servicio también pide código.
  let auth: string | null = null
  if (d.price !== undefined && d.price !== s.price) auth = authorize(c.get('deps'), u, d.authCode, 'change_prices', 'precio de servicio').id
  db.prepare('UPDATE services SET name=?, category=?, price=?, duration_min=?, attrs=?, machine_id=?, sheets_per_unit=?, active=?, cost=? WHERE id=?').run(
    d.name ?? s.name, d.category === undefined ? s.category : d.category, d.price ?? s.price, d.durationMin === undefined ? s.duration_min : d.durationMin,
    d.attrs ? JSON.stringify(d.attrs) : s.attrs, d.machineId === undefined ? s.machine_id : d.machineId, d.sheetsPerUnit ?? s.sheets_per_unit, d.active === undefined ? s.active : d.active ? 1 : 0, d.cost ?? s.cost ?? 0, s.id,
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'servicio.cambio', entity: 'service', entityId: s.id, oldValue: serviceView(s), newValue: { ...d, authCode: undefined }, authorizedBy: auth })
  return c.json({ service: serviceView(loadService(db, u.business_id, s.id)) })
})

/** Receta: lo que gasta un servicio o producto por unidad vendida. Reemplaza la lista completa. */
services.put('/recipes/:ownerId', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const owner = c.req.param('ownerId')
  const isService = db.prepare('SELECT 1 FROM services WHERE id = ? AND business_id = ?').get(owner, u.business_id)
  const isProduct = db.prepare('SELECT 1 FROM products WHERE id = ? AND business_id = ?').get(owner, u.business_id)
  if (!isService && !isProduct) throw notFound()
  const d = parse(z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).max(50) }), await body(c))
  for (const it of d.items) {
    if (it.productId === owner) throw bad('Un producto no puede gastarse a sí mismo.')
    getProduct(db, u.business_id, it.productId)
  }
  db.transaction(() => {
    db.prepare('DELETE FROM recipes WHERE owner_id = ?').run(owner)
    for (const it of d.items) {
      const micro = Math.round(it.quantity * 1_000_000)
      if (micro < 1) throw bad('La cantidad de la receta es demasiado pequeña.')
      db.prepare('INSERT INTO recipes (owner_id, product_id, qty_micro) VALUES (?,?,?)').run(owner, it.productId, micro)
    }
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'receta.cambio', entity: isService ? 'service' : 'product', entityId: owner, newValue: d.items })
  })()
  return c.json({ ok: true })
})

services.get('/recipes/:ownerId', (c) => {
  const rows = c.get('deps').db.prepare('SELECT r.product_id AS productId, p.name, r.qty_micro FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.owner_id = ? AND p.business_id = ?').all(c.req.param('ownerId'), c.get('session').user.business_id) as { qty_micro: number }[]
  return c.json({ items: rows.map(({ qty_micro, ...r }) => ({ ...r, quantity: qty_micro / 1_000_000 })) })
})

/** Combo o paquete con un solo precio (útiles por grado, sets…): define sus componentes. */
services.put('/products/:id/combo', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = getProduct(db, u.business_id, c.req.param('id'))
  if (p.unit !== 'pieza') throw bad('Un combo se vende por pieza.')
  const d = parse(z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).max(100) }), await body(c))
  for (const it of d.items) {
    if (it.productId === p.id) throw bad('Un combo no puede contenerse a sí mismo.')
    if (db.prepare('SELECT 1 FROM combo_items WHERE combo_id = ?').get(it.productId)) throw bad('Un combo no puede llevar otro combo.')
    getProduct(db, u.business_id, it.productId)
  }
  db.transaction(() => {
    db.prepare('DELETE FROM combo_items WHERE combo_id = ?').run(p.id)
    for (const it of d.items) db.prepare('INSERT INTO combo_items (combo_id, product_id, qty_milli) VALUES (?,?,?)').run(p.id, it.productId, toMilli(it.quantity))
    db.prepare('UPDATE products SET version = version + 1, updated_at = ? WHERE id = ?').run(iso(now()), p.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'combo.cambio', entity: 'product', entityId: p.id, newValue: d.items })
  })()
  return c.json({ ok: true })
})

// ---------- Copiadoras: lectura del contador al inicio y fin de turno ----------

services.get('/machines', (c) => c.json({ machines: c.get('deps').db.prepare('SELECT id, branch_id AS branchId, name, active FROM machines WHERE business_id = ? ORDER BY name').all(c.get('session').user.business_id) }))

services.patch('/machines/:id', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const m = db.prepare('SELECT * FROM machines WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; name: string; active: number } | undefined
  if (!m) throw bad('Ese equipo no existe.')
  const d = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() }), await body(c))
  db.prepare('UPDATE machines SET name = ?, active = ? WHERE id = ?').run(d.name ?? m.name, d.active === undefined ? m.active : d.active ? 1 : 0, m.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'equipo.cambio', entity: 'machine', entityId: m.id, oldValue: m, newValue: d })
  return c.json({ ok: true })
})

services.post('/machines', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(1).max(60), branchId: z.string().optional() }), await body(c))
  const branchId = d.branchId ?? u.branch_id
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(branchId, u.business_id)) throw bad('Sucursal no válida.')
  const id = newId()
  db.prepare('INSERT INTO machines (id, business_id, branch_id, name, created_at) VALUES (?,?,?,?,?)').run(id, u.business_id, branchId, d.name, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'equipo.alta', entity: 'machine', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

services.post('/machines/:id/readings', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const m = db.prepare('SELECT id FROM machines WHERE id = ? AND business_id = ? AND active = 1').get(c.req.param('id'), u.business_id) as { id: string } | undefined
  if (!m) throw notFound('No se encontró ese equipo.')
  const d = parse(z.object({ type: z.enum(['inicio', 'fin']), value: z.number().int().min(0), shiftId: z.string().optional() }), await body(c))
  const shift = (d.shiftId ? db.prepare('SELECT id FROM shifts WHERE id = ? AND business_id = ?').get(d.shiftId, u.business_id) : db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id)) as { id: string } | undefined
  if (!shift) throw conflict('Abre tu caja para registrar el contador.', 'caja_cerrada')
  if (d.type === 'fin') {
    const start = db.prepare("SELECT value FROM counter_readings WHERE machine_id = ? AND shift_id = ? AND type = 'inicio'").get(m.id, shift.id) as { value: number } | undefined
    if (!start) throw conflict('Primero registra el contador de inicio.', 'falta_inicio')
    if (d.value < start.value) throw bad('El contador final no puede ser menor que el inicial.')
  }
  try {
    db.prepare('INSERT INTO counter_readings (id, machine_id, shift_id, type, value, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), m.id, shift.id, d.type, d.value, u.id, iso(now()))
  } catch {
    throw conflict('Ya se registró esa lectura en este turno.', 'lectura_repetida')
  }
  audit(db, now, { businessId: u.business_id, userId: u.id, action: `contador.${d.type}`, entity: 'machine', entityId: m.id, newValue: { value: d.value, shiftId: shift.id } })
  return c.json({ ok: true }, 201)
})

/** Compara lo que avanzó cada contador contra las hojas vendidas en el turno y marca la diferencia. */
export function counterReport(db: Db, businessId: string, shiftId: string) {
  const machines = db.prepare('SELECT id, name FROM machines WHERE business_id = ?').all(businessId) as { id: string; name: string }[]
  return machines.map((m) => {
    const r = (type: string) => (db.prepare('SELECT value FROM counter_readings WHERE machine_id = ? AND shift_id = ? AND type = ?').get(m.id, shiftId, type) as { value: number } | undefined)?.value ?? null
    const start = r('inicio'), end = r('fin')
    const sold = (db.prepare("SELECT COALESCE(SUM(si.quantity * sv.sheets_per_unit),0) n FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN services sv ON sv.id = si.service_id WHERE s.shift_id = ? AND s.status = 'completada' AND sv.machine_id = ?").get(shiftId, m.id) as { n: number }).n
    const counted = start != null && end != null ? end - start : null
    return { machineId: m.id, name: m.name, start, end, counted, sold, difference: counted == null ? null : counted - sold }
  })
}

services.get('/shifts/:id/counters', requirePerm('open_close_cash'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  if (!db.prepare('SELECT 1 FROM shifts WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id)) throw notFound()
  return c.json({ machines: counterReport(db, u.business_id, c.req.param('id')) })
})

// ---------- Encargos con anticipo ----------

interface OrderRow { id: string; business_id: string; folio: number; customer_id: string | null; customer_name: string | null; phone: string | null; description: string; total: number; deposit: number; deposit_sale_id: string | null; final_sale_id: string | null; due_date: string | null; status: string; created_at: string }
const orderView = (o: OrderRow) => ({ id: o.id, folio: o.folio, customerId: o.customer_id, customerName: o.customer_name, phone: o.phone, description: o.description, total: o.total, deposit: o.deposit, balance: o.total - o.deposit, dueDate: o.due_date, status: o.status, depositSaleId: o.deposit_sale_id, finalSaleId: o.final_sale_id, createdAt: o.created_at })

function loadOrder(c: C) {
  const o = c.get('deps').db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as OrderRow | undefined
  if (!o) throw notFound('No se encontró ese encargo.')
  return o
}

/** El anticipo se cobra como venta (entra al corte); al entregar se cobra el saldo. */
services.post('/orders', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(
    z.object({
      id: z.string().uuid().optional(), customerId: z.string().optional(), customerName: z.string().trim().max(100).optional(), phone: z.string().trim().max(20).optional(),
      description: z.string().trim().min(3).max(1000), total: z.number().int().min(1), deposit: z.number().int().min(0),
      paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    await body(c),
  )
  if (d.id) {
    const prev = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(d.id, u.business_id) as OrderRow | undefined
    if (prev) return c.json({ duplicate: true, order: orderView(prev) })
  }
  if (d.deposit > d.total) throw bad('El anticipo no puede ser mayor que el total.')
  if (!d.customerId && !d.customerName) throw bad('Indica el nombre del cliente.')
  if (d.customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ? AND business_id = ?').get(d.customerId, u.business_id)) throw bad('Ese cliente no existe.')
  const id = d.id ?? newId()
  const result = db.transaction(() => {
    const folio = ((db.prepare('SELECT MAX(folio) m FROM orders WHERE business_id = ?').get(u.business_id) as { m: number | null }).m ?? 0) + 1
    let depositSale: string | null = null
    if (d.deposit > 0) {
      depositSale = createSale(deps, u, parseSale({ id: newId(), paymentMethod: d.paymentMethod, customerId: d.customerId, items: [{ description: `Anticipo encargo #${folio}`, quantity: 1, unitPrice: d.deposit }] }), { trustedPrices: true }).sale.id
    }
    db.prepare('INSERT INTO orders (id, business_id, folio, customer_id, customer_name, phone, description, total, deposit, deposit_sale_id, due_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, folio, d.customerId ?? null, d.customerName ?? null, d.phone ?? null, d.description, d.total, d.deposit, depositSale, d.dueDate ?? null, u.id, iso(now()),
    )
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'encargo.alta', entity: 'order', entityId: id, newValue: { folio, total: d.total, deposit: d.deposit } })
    return orderView(db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow)
  })()
  return c.json({ order: result }, 201)
})

services.get('/orders', requirePerm('sell'), (c) => {
  const status = c.req.query('status')
  const rows = c.get('deps').db.prepare(`SELECT * FROM orders WHERE business_id = ? ${status ? 'AND status = ?' : "AND status IN ('pendiente','listo')"} ORDER BY due_date, folio`).all(...[c.get('session').user.business_id, ...(status ? [status] : [])]) as OrderRow[]
  return c.json({ orders: rows.map(orderView) })
})

services.post('/orders/:id/ready', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const o = loadOrder(c)
  if (o.status !== 'pendiente') throw conflict(`El encargo ya está ${o.status}.`)
  db.prepare("UPDATE orders SET status = 'listo' WHERE id = ?").run(o.id)
  audit(db, now, { businessId: o.business_id, userId: c.get('session').user.id, action: 'encargo.listo', entity: 'order', entityId: o.id })
  return c.json({ order: orderView({ ...o, status: 'listo' }) })
})

/** Entregar: se cobra el saldo (y opcionalmente los productos usados, que descuentan inventario). */
services.post('/orders/:id/deliver', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const o = loadOrder(c)
  if (o.status === 'entregado' || o.status === 'cancelado') throw conflict(`El encargo ya está ${o.status}.`, 'encargo_cerrado')
  const d = parse(z.object({ paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta', 'fiado']).default('efectivo'), cashReceived: z.number().int().optional(), authCode: z.string().optional() }), await body(c))
  const balance = o.total - o.deposit
  const result = db.transaction(() => {
    let saleId: string | null = null
    if (balance > 0) {
      saleId = createSale(deps, u, parseSale({ id: newId(), paymentMethod: d.paymentMethod, cashReceived: d.cashReceived, authCode: d.authCode, customerId: o.customer_id ?? undefined, items: [{ description: `Saldo encargo #${o.folio}: ${o.description}`.slice(0, 200), quantity: 1, unitPrice: balance }] }), { trustedPrices: true }).sale.id
    }
    db.prepare("UPDATE orders SET status = 'entregado', final_sale_id = ? WHERE id = ?").run(saleId, o.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'encargo.entregado', entity: 'order', entityId: o.id, newValue: { balance, saleId } })
    return { saleId, balance }
  })()
  return c.json(result)
})

/** Cancelar un encargo. Devolver o no el anticipo lo decide el dueño, con su código. */
services.post('/orders/:id/cancel', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const o = loadOrder(c)
  if (o.status === 'entregado' || o.status === 'cancelado') throw conflict(`El encargo ya está ${o.status}.`, 'encargo_cerrado')
  const d = parse(z.object({ refundDeposit: z.boolean(), refundMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), reason: z.string().trim().min(3).max(300), authCode: z.string().optional() }), await body(c))
  const auth = authorize(deps, u, d.authCode, 'cancel_discount', 'cancelación de encargo', { ownerOnly: true })
  db.transaction(() => {
    if (d.refundDeposit && o.deposit > 0) {
      const shift = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined
      if (d.refundMethod === 'efectivo' && !shift) throw conflict('Abre tu caja para devolver el anticipo en efectivo.', 'caja_cerrada')
      const rid = newId()
      db.prepare('INSERT INTO returns (id, business_id, branch_id, sale_id, shift_id, customer_id, amount, refund_method, reason, authorized_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
        rid, u.business_id, u.branch_id, o.deposit_sale_id, shift?.id ?? null, o.customer_id, o.deposit, d.refundMethod, `Encargo #${o.folio} cancelado: ${d.reason}`, auth.id, u.id, iso(now()),
      )
      db.prepare('INSERT INTO return_items (id, return_id, sale_item_id, product_id, description, qty_milli, amount, restocked) VALUES (?,?,NULL,NULL,?,1000,?,0)').run(newId(), rid, `Anticipo encargo #${o.folio}`, o.deposit)
      if (d.refundMethod === 'efectivo') db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift!.id, o.deposit, `Devolución de anticipo encargo #${o.folio}`, u.id, iso(now()))
    }
    db.prepare("UPDATE orders SET status = 'cancelado', cancel_reason = ?, deposit_refunded = ? WHERE id = ?").run(d.reason, d.refundDeposit ? 1 : 0, o.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'encargo.cancelado', entity: 'order', entityId: o.id, newValue: { refundDeposit: d.refundDeposit, deposit: o.deposit }, authorizedBy: auth.id, reason: d.reason })
  })()
  return c.json({ ok: true })
})
