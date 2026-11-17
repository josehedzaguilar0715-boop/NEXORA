import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, hasPerm, ownerOnly, parse, requirePerm, type C, type Env } from './context.js'
import type { Db } from './db.js'
import { activePromotions, bestPromotions } from './promotions.js'
import { AppError, bad, clampTime, conflict, forbidden, iso, localDate, newId, notFound, type Clock } from './util.js'

export const MODULES = ['membresias', 'promociones', 'fidelidad', 'asistencia', 'reservas', 'recordatorios'] as const
export type Module = (typeof MODULES)[number]

export function moduleOn(db: Db, businessId: string, m: Module): boolean {
  const r = db.prepare('SELECT modules FROM businesses WHERE id = ?').get(businessId) as { modules: string }
  return (JSON.parse(r.modules) as string[]).includes(m)
}
export const requireModule = (m: Module) =>
  createMiddleware<Env>(async (c, next) => {
    if (!moduleOn(c.get('deps').db, c.get('session').user.business_id, m)) throw new AppError(409, 'modulo_inactivo', `El módulo de ${m} no está activado.`)
    await next()
  })

/** Código de cliente: 20 caracteres aleatorios (no consecutivo, no adivinable). */
const customerCode = () => 'NX' + randomBytes(12).toString('base64url').replace(/[-_]/g, '').toUpperCase().slice(0, 18).padEnd(18, '7')

export const common = new Hono<Env>()

common.get('/modules', (c) => {
  const r = c.get('deps').db.prepare('SELECT modules FROM businesses WHERE id = ?').get(c.get('session').user.business_id) as { modules: string }
  return c.json({ available: MODULES, active: JSON.parse(r.modules) })
})

common.put('/modules', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ active: z.array(z.enum(MODULES)) }), await body(c))
  const old = db.prepare('SELECT modules FROM businesses WHERE id = ?').get(u.business_id) as { modules: string }
  db.prepare('UPDATE businesses SET modules = ? WHERE id = ?').run(JSON.stringify([...new Set(d.active)]), u.business_id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'negocio.modulos', oldValue: JSON.parse(old.modules), newValue: d.active })
  return c.json({ active: d.active })
})

// ---------- Clientes finales ----------

common.get('/customers', requirePerm('customers_credit'), (c) => {
  const q = `%${c.req.query('q') ?? ''}%`
  const rows = c.get('deps').db
    .prepare('SELECT id, name, phone, notes, code, loyalty_enrolled AS loyaltyEnrolled, active FROM customers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT 200')
    .all(c.get('session').user.business_id, q, q)
  return c.json({ customers: rows })
})

common.post('/customers', requirePerm('customers_credit'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().max(20).optional(), notes: z.string().max(2000).optional(), loyaltyEnrolled: z.boolean().optional() }), await body(c))
  if (d.notes && u.role !== 'owner') throw new AppError(403, 'sin_permiso', 'Solo el dueño escribe las notas del cliente.')
  const id = newId()
  const code = customerCode()
  db.prepare('INSERT INTO customers (id, business_id, name, phone, notes, code, loyalty_enrolled, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    id, u.business_id, d.name, d.phone ?? null, d.notes ?? null, code, d.loyaltyEnrolled ? 1 : 0, iso(now()),
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cliente.alta', entity: 'customer', entityId: id, newValue: { name: d.name } })
  return c.json({ customer: { id, name: d.name, phone: d.phone ?? null, code } }, 201)
})

export function loadCustomer(c: C, id = c.req.param('id')) {
  const r = c.get('deps').db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(id, c.get('session').user.business_id) as
    | { id: string; name: string; phone: string | null; notes: string | null; code: string; loyalty_enrolled: number; active: number }
    | undefined
  if (!r) throw notFound('No se encontró ese cliente.')
  return r
}

common.patch('/customers/:id', requirePerm('customers_credit'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const cu = loadCustomer(c)
  const d = parse(z.object({ name: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(20).nullable().optional(), notes: z.string().max(2000).nullable().optional(), loyaltyEnrolled: z.boolean().optional(), active: z.boolean().optional(), address: z.string().trim().max(300).nullable().optional(), homeAll: z.boolean().optional() }), await body(c))
  // Las notas del cliente son texto libre que escribe el dueño (sin fichas médicas estructuradas).
  if (d.notes !== undefined && u.role !== 'owner') throw new AppError(403, 'sin_permiso', 'Solo el dueño escribe las notas del cliente.')
  if (d.address !== undefined) db.prepare('UPDATE customers SET address = ? WHERE id = ?').run(d.address, cu.id)
  if (d.homeAll !== undefined) db.prepare('UPDATE customers SET home_all = ? WHERE id = ?').run(d.homeAll ? 1 : 0, cu.id)
  db.prepare('UPDATE customers SET name = ?, phone = ?, notes = ?, loyalty_enrolled = ?, active = ? WHERE id = ?').run(
    d.name ?? cu.name, d.phone === undefined ? cu.phone : d.phone, d.notes === undefined ? cu.notes : d.notes,
    d.loyaltyEnrolled === undefined ? cu.loyalty_enrolled : d.loyaltyEnrolled ? 1 : 0, d.active === undefined ? cu.active : d.active ? 1 : 0, cu.id,
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cliente.cambio', entity: 'customer', entityId: cu.id, oldValue: { name: cu.name, phone: cu.phone, active: cu.active }, newValue: d })
  return c.json({ ok: true })
})

common.get('/customers/:id', requirePerm('customers_credit'), (c) => {
  const { db, now } = c.get('deps')
  const cu = loadCustomer(c)
  return c.json({ customer: cu, ...customerStatus(db, now, cu.id) })
})

/** Código nuevo si el cliente perdió el suyo; el anterior deja de servir. */
common.post('/customers/:id/new-code', requirePerm('customers_credit'), (c) => {
  const { db, now } = c.get('deps')
  const cu = loadCustomer(c)
  const code = customerCode()
  db.prepare('UPDATE customers SET code = ? WHERE id = ?').run(code, cu.id)
  audit(db, now, { businessId: c.get('session').user.business_id, userId: c.get('session').user.id, action: 'cliente.codigo_nuevo', entity: 'customer', entityId: cu.id })
  return c.json({ code })
})

function customerStatus(db: Db, now: Clock, customerId: string) {
  const t = now()
  const memberships = (db.prepare('SELECT * FROM customer_memberships WHERE customer_id = ? AND ends_at > ? AND starts_at <= ? ORDER BY ends_at').all(customerId, iso(t), iso(t)) as MembershipRow[]).map((m) => membershipView(db, m, t))
  const points = (db.prepare('SELECT COALESCE(SUM(delta),0) p FROM loyalty_ledger WHERE customer_id = ?').get(customerId) as { p: number }).p
  const lastVisit = db.prepare('SELECT at FROM visits WHERE customer_id = ? ORDER BY at DESC LIMIT 1').get(customerId) as { at: string } | undefined
  return { memberships, loyaltyBalance: points, lastVisit: lastVisit?.at ?? null }
}

// ---------- QR público para que el cliente lo descargue ----------

export const publicCommon = new Hono<Env>()
publicCommon.get('/public/qr/:code', async (c) => {
  const code = c.req.param('code').replace(/\.svg$/, '')
  const cu = c.get('deps').db.prepare('SELECT c.code, b.name AS business FROM customers c JOIN businesses b ON b.id = c.business_id WHERE c.code = ? AND c.active = 1').get(code) as { code: string; business: string } | undefined
  if (!cu) throw notFound()
  const svg = await QRCode.toString(cu.code, { type: 'svg', margin: 2, width: 320 })
  return c.body(svg, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=3600' })
})

// ---------- Membresías ----------

interface MembershipRow { id: string; customer_id: string; plan_snapshot: string; starts_at: string; ends_at: string }
type Period = 'dia' | 'semana' | 'mes'

function addPeriod(d: Date, p: Period, n = 1) {
  const r = new Date(d)
  if (p === 'mes') r.setUTCMonth(r.getUTCMonth() + n)
  else r.setUTCDate(r.getUTCDate() + (p === 'semana' ? 7 : 1) * n)
  return r
}
/** Inicio del periodo de usos que contiene `at` (los periodos cuentan desde el inicio de la membresía). */
export function periodStart(start: Date, p: Period, at: Date) {
  let cur = start
  for (let i = 0; i < 10_000; i++) {
    const next = addPeriod(start, p, i + 1)
    if (next > at) return cur
    cur = next
  }
  return cur
}

function membershipView(db: Db, m: MembershipRow, at: Date) {
  const plan = JSON.parse(m.plan_snapshot) as { name: string; uses_per_period: number; period: Period; kind?: string }
  // Paquete de sesiones: un solo periodo que dura toda la vigencia.
  const ps = plan.kind === 'paquete' ? new Date(m.starts_at) : periodStart(new Date(m.starts_at), plan.period, at)
  const used = (db.prepare('SELECT COUNT(*) n FROM membership_uses WHERE membership_id = ? AND period_start = ?').get(m.id, iso(ps)) as { n: number }).n
  return { id: m.id, name: plan.name, kind: plan.kind ?? 'periodo', startsAt: m.starts_at, endsAt: m.ends_at, usesPerPeriod: plan.uses_per_period, period: plan.kind === 'paquete' ? 'vigencia' : plan.period, usedThisPeriod: used, remaining: Math.max(0, plan.uses_per_period - used), periodStart: iso(ps) }
}

const planBody = z.object({
  name: z.string().trim().min(2).max(100), usesPerPeriod: z.number().int().min(1).max(1000), period: z.enum(['dia', 'semana', 'mes']),
  /** paquete: usesPerPeriod sesiones en total, válidas validityDays días. */
  kind: z.enum(['periodo', 'paquete']).optional(), validityDays: z.number().int().min(1).max(3650).optional(),
  price: z.number().int().min(0), appliesTo: z.array(z.string()).max(200).optional(), active: z.boolean().optional(),
})

common.get('/membership-plans', requireModule('membresias'), (c) => c.json({ plans: c.get('deps').db.prepare('SELECT * FROM membership_plans WHERE business_id = ? ORDER BY name').all(c.get('session').user.business_id) }))

common.post('/membership-plans', requireModule('membresias'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(planBody, await body(c))
  const id = newId()
  if (d.kind === 'paquete' && !d.validityDays) throw bad('Un paquete necesita su vigencia en días.')
  db.prepare('INSERT INTO membership_plans (id, business_id, name, uses_per_period, period, price, applies_to, kind, validity_days, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, u.business_id, d.name, d.usesPerPeriod, d.period, d.price, JSON.stringify(d.appliesTo ?? []), d.kind ?? 'periodo', d.validityDays ?? null, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'membresia.plan_alta', entity: 'membership_plan', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

common.patch('/membership-plans/:id', requireModule('membresias'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const old = db.prepare('SELECT * FROM membership_plans WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as Record<string, unknown> | undefined
  if (!old) throw notFound()
  const d = parse(planBody.partial(), await body(c))
  db.prepare('UPDATE membership_plans SET name = ?, uses_per_period = ?, period = ?, price = ?, applies_to = ?, active = ? WHERE id = ?').run(
    d.name ?? old.name, d.usesPerPeriod ?? old.uses_per_period, d.period ?? old.period, d.price ?? old.price,
    d.appliesTo ? JSON.stringify(d.appliesTo) : old.applies_to, d.active === undefined ? old.active : d.active ? 1 : 0, old.id,
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'membresia.plan_cambio', entity: 'membership_plan', entityId: String(old.id), oldValue: old, newValue: d })
  return c.json({ ok: true })
})

common.post('/customers/:id/memberships', requireModule('membresias'), requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const cu = loadCustomer(c)
  const d = parse(z.object({ planId: z.string(), periods: z.number().int().min(1).max(36).default(1), startsAt: z.string().datetime().optional(), saleId: z.string().optional() }), await body(c))
  const plan = db.prepare('SELECT * FROM membership_plans WHERE id = ? AND business_id = ? AND active = 1').get(d.planId, u.business_id) as { id: string; name: string; uses_per_period: number; period: Period; price: number; applies_to: string; kind: string; validity_days: number | null } | undefined
  if (!plan) throw bad('Ese plan no existe o está desactivado.')
  const start = d.startsAt ? new Date(d.startsAt) : now()
  const end = plan.kind === 'paquete' ? new Date(start.getTime() + plan.validity_days! * 86_400_000) : addPeriod(start, plan.period, d.periods)
  const id = newId()
  db.prepare('INSERT INTO customer_memberships (id, business_id, customer_id, plan_id, plan_snapshot, starts_at, ends_at, price_paid, sale_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, u.business_id, cu.id, plan.id, JSON.stringify(plan), iso(start), iso(end), plan.kind === 'paquete' ? plan.price : plan.price * d.periods, d.saleId ?? null, u.id, iso(now()),
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'membresia.venta', entity: 'customer_membership', entityId: id, newValue: { customer: cu.id, plan: plan.name, startsAt: iso(start), endsAt: iso(end) } })
  return c.json({ membership: membershipView(db, db.prepare('SELECT * FROM customer_memberships WHERE id = ?').get(id) as MembershipRow, now()) }, 201)
})

// ---------- Escaneo de QR ----------

common.post('/scan', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (!hasPerm(u, 'sell') && !hasPerm(u, 'attendance')) throw forbidden()
  const d = parse(z.object({ code: z.string().trim().min(4).max(64), action: z.enum(['consulta', 'entrada', 'membresia']), membershipId: z.string().optional(), at: z.string().datetime().optional() }), await body(c))
  // El servidor valida cada escaneo: el código debe existir y ser de este negocio.
  const cu = db.prepare('SELECT * FROM customers WHERE code = ? AND business_id = ? AND active = 1').get(d.code.toUpperCase(), u.business_id) as { id: string; name: string; loyalty_enrolled: number } | undefined
  if (!cu) throw new AppError(404, 'codigo_invalido', 'Código no válido para este negocio.')
  const t = clampTime(d.at, now())
  const day = localDate(t)
  const result: Record<string, unknown> = { customer: { id: cu.id, name: cu.name } }

  if (d.action === 'entrada') {
    if (!moduleOn(db, u.business_id, 'asistencia')) throw new AppError(409, 'modulo_inactivo', 'El módulo de asistencia no está activado.')
    if (db.prepare('SELECT 1 FROM visits WHERE customer_id = ? AND visit_date = ?').get(cu.id, day)) throw conflict('Este código ya registró su entrada en esta visita.', 'ya_registrado')
    db.prepare('INSERT INTO visits (id, business_id, customer_id, visit_date, at, scanned_by) VALUES (?,?,?,?,?,?)').run(newId(), u.business_id, cu.id, day, iso(t), u.id)
    result.visit = { at: iso(t) }
    const earned = earnForVisit(db, now, u.business_id, u.id, cu)
    if (earned) result.loyaltyEarned = earned
  }

  if (d.action === 'membresia') {
    if (!moduleOn(db, u.business_id, 'membresias')) throw new AppError(409, 'modulo_inactivo', 'El módulo de membresías no está activado.')
    const all = db.prepare('SELECT * FROM customer_memberships WHERE customer_id = ? ORDER BY ends_at').all(cu.id) as MembershipRow[]
    const valid = all.filter((m) => m.starts_at <= iso(t) && m.ends_at > iso(t))
    const m = d.membershipId ? valid.find((x) => x.id === d.membershipId) : valid.find((x) => membershipView(db, x, t).remaining > 0) ?? valid[0]
    if (!m) throw conflict(all.length ? 'La membresía no está vigente.' : 'Este cliente no tiene membresía.', 'membresia_no_vigente')
    const v = membershipView(db, m, t)
    if (db.prepare('SELECT 1 FROM membership_uses WHERE membership_id = ? AND use_date = ?').get(m.id, day)) throw conflict('Este código ya se usó en esta visita.', 'ya_usado')
    if (v.remaining <= 0) throw conflict('Ya no quedan usos en este periodo.', 'sin_usos')
    db.prepare('INSERT INTO membership_uses (id, membership_id, use_date, period_start, at, scanned_by) VALUES (?,?,?,?,?,?)').run(newId(), m.id, day, v.periodStart, iso(t), u.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'membresia.uso', entity: 'customer_membership', entityId: m.id })
    result.membership = membershipView(db, m, t)
  }

  return c.json({ ...result, ...customerStatus(db, () => t, cu.id) })
})

// ---------- Promociones ----------

const promoBody = z.object({
  name: z.string().trim().min(2).max(100),
  kind: z.enum(['porcentaje', 'monto']),
  /** porcentaje en puntos base (1500 = 15 %); monto en centavos. */
  value: z.number().int().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  appliesTo: z.union([z.object({ all: z.literal(true) }), z.object({ refs: z.array(z.string()).max(500).optional(), categories: z.array(z.string()).max(100).optional() })]),
  combinable: z.boolean().optional(),
  minQuantity: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
})

common.get('/promotions', requireModule('promociones'), (c) => c.json({ promotions: c.get('deps').db.prepare('SELECT * FROM promotions WHERE business_id = ? ORDER BY starts_at DESC').all(c.get('session').user.business_id) }))

common.post('/promotions', requireModule('promociones'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(promoBody, await body(c))
  if (d.kind === 'porcentaje' && d.value > 10_000) throw bad('El porcentaje no puede pasar de 100 %.')
  if (d.endsAt <= d.startsAt) throw bad('La vigencia termina antes de empezar.')
  const id = newId()
  db.prepare('INSERT INTO promotions (id, business_id, name, kind, value, starts_at, ends_at, applies_to, combinable, min_quantity, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id, u.business_id, d.name, d.kind, d.value, d.startsAt, d.endsAt, JSON.stringify(d.appliesTo), d.combinable ? 1 : 0, d.minQuantity ?? 0, iso(now()),
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'promocion.alta', entity: 'promotion', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

common.patch('/promotions/:id', requireModule('promociones'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const old = db.prepare('SELECT * FROM promotions WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as Record<string, unknown> | undefined
  if (!old) throw notFound()
  const d = parse(promoBody.partial(), await body(c))
  db.prepare('UPDATE promotions SET name=?, kind=?, value=?, starts_at=?, ends_at=?, applies_to=?, combinable=?, min_quantity=?, active=? WHERE id=?').run(
    d.name ?? old.name, d.kind ?? old.kind, d.value ?? old.value, d.startsAt ?? old.starts_at, d.endsAt ?? old.ends_at,
    d.appliesTo ? JSON.stringify(d.appliesTo) : old.applies_to, d.combinable === undefined ? old.combinable : d.combinable ? 1 : 0,
    d.minQuantity ?? old.min_quantity, d.active === undefined ? old.active : d.active ? 1 : 0, old.id,
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'promocion.cambio', entity: 'promotion', entityId: String(old.id), oldValue: old, newValue: d })
  return c.json({ ok: true })
})

/** Vista previa para la caja: qué promociones aplican a un carrito. */
common.post('/promotions/evaluate', requireModule('promociones'), async (c) => {
  const { db, now } = c.get('deps')
  const d = parse(z.object({ items: z.array(z.object({ ref: z.string().optional(), category: z.string().optional(), quantity: z.number().positive(), unitPrice: z.number().int().min(0) })).min(1) }), await body(c))
  const lines = d.items.map((i) => ({ ...i, total: Math.round(i.quantity * i.unitPrice) }))
  return c.json(bestPromotions(activePromotions(db, c.get('session').user.business_id, iso(now())), lines))
})

// ---------- Fidelidad ----------

interface Program { unit: string; earn_by: 'monto' | 'visita'; earn_amount: number | null; earn_points: number; scope: 'todos' | 'por_persona' }
const program = (db: Db, businessId: string) => db.prepare('SELECT * FROM loyalty_program WHERE business_id = ?').get(businessId) as Program | undefined
const eligible = (p: Program, cu: { loyalty_enrolled: number }) => p.scope === 'todos' || !!cu.loyalty_enrolled

function earnForVisit(db: Db, now: Clock, businessId: string, userId: string, cu: { id: string; loyalty_enrolled: number }) {
  if (!moduleOn(db, businessId, 'fidelidad')) return 0
  const p = program(db, businessId)
  if (!p || p.earn_by !== 'visita' || !eligible(p, cu)) return 0
  db.prepare('INSERT INTO loyalty_ledger (id, business_id, customer_id, delta, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), businessId, cu.id, p.earn_points, 'visita', userId, iso(now()))
  return p.earn_points
}

/** Puntos por monto al cobrar una venta con cliente. Se llama dentro de la transacción de la venta. */
export function earnForSale(db: Db, now: Clock, businessId: string, userId: string, customerId: string, saleId: string, total: number) {
  if (!moduleOn(db, businessId, 'fidelidad')) return 0
  const p = program(db, businessId)
  const cu = db.prepare('SELECT id, loyalty_enrolled FROM customers WHERE id = ?').get(customerId) as { id: string; loyalty_enrolled: number }
  if (!p || p.earn_by !== 'monto' || !p.earn_amount || !eligible(p, cu)) return 0
  const pts = Math.floor(total / p.earn_amount) * p.earn_points
  if (pts > 0) db.prepare('INSERT INTO loyalty_ledger (id, business_id, customer_id, delta, reason, sale_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(newId(), businessId, customerId, pts, 'venta', saleId, userId, iso(now()))
  return pts
}

/** Al cancelar una venta se revierten los puntos que dio (con un movimiento contrario, no borrando). */
export function reverseSalePoints(db: Db, now: Clock, businessId: string, userId: string, saleId: string) {
  const r = db.prepare("SELECT customer_id, COALESCE(SUM(delta),0) pts FROM loyalty_ledger WHERE sale_id = ? AND reason = 'venta' GROUP BY customer_id").get(saleId) as { customer_id: string; pts: number } | undefined
  if (r && r.pts > 0) db.prepare("INSERT INTO loyalty_ledger (id, business_id, customer_id, delta, reason, sale_id, created_by, created_at) VALUES (?,?,?,?,'cancelacion',?,?,?)").run(newId(), businessId, r.customer_id, -r.pts, saleId, userId, iso(now()))
}

common.get('/loyalty', requireModule('fidelidad'), (c) => {
  const { db } = c.get('deps')
  const b = c.get('session').user.business_id
  return c.json({ program: program(db, b) ?? null, rewards: db.prepare('SELECT * FROM loyalty_rewards WHERE business_id = ? ORDER BY cost').all(b) })
})

common.put('/loyalty', requireModule('fidelidad'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(
    z.object({ unit: z.enum(['puntos', 'sellos']), earnBy: z.enum(['monto', 'visita']), earnAmount: z.number().int().min(1).optional(), earnPoints: z.number().int().min(1), scope: z.enum(['todos', 'por_persona']) }),
    await body(c),
  )
  if (d.earnBy === 'monto' && !d.earnAmount) throw bad('Indica cada cuánto dinero se gana (earnAmount).')
  const old = program(db, u.business_id)
  db.prepare(
    `INSERT INTO loyalty_program (business_id, unit, earn_by, earn_amount, earn_points, scope, updated_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(business_id) DO UPDATE SET unit=excluded.unit, earn_by=excluded.earn_by, earn_amount=excluded.earn_amount, earn_points=excluded.earn_points, scope=excluded.scope, updated_at=excluded.updated_at`,
  ).run(u.business_id, d.unit, d.earnBy, d.earnAmount ?? null, d.earnPoints, d.scope, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fidelidad.programa', oldValue: old, newValue: d })
  return c.json({ ok: true })
})

common.post('/loyalty/rewards', requireModule('fidelidad'), ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(100), cost: z.number().int().min(1) }), await body(c))
  const id = newId()
  db.prepare('INSERT INTO loyalty_rewards (id, business_id, name, cost, created_at) VALUES (?,?,?,?,?)').run(id, u.business_id, d.name, d.cost, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fidelidad.premio_alta', entity: 'loyalty_reward', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

common.post('/customers/:id/redeem', requireModule('fidelidad'), requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const cu = loadCustomer(c)
  const d = parse(z.object({ rewardId: z.string() }), await body(c))
  const r = db.prepare('SELECT * FROM loyalty_rewards WHERE id = ? AND business_id = ? AND active = 1').get(d.rewardId, u.business_id) as { id: string; name: string; cost: number } | undefined
  if (!r) throw bad('Ese premio no existe.')
  return db.transaction(() => {
    const bal = (db.prepare('SELECT COALESCE(SUM(delta),0) p FROM loyalty_ledger WHERE customer_id = ?').get(cu.id) as { p: number }).p
    if (bal < r.cost) throw conflict(`Le faltan ${r.cost - bal} para este premio.`, 'saldo_insuficiente')
    db.prepare("INSERT INTO loyalty_ledger (id, business_id, customer_id, delta, reason, reward_id, created_by, created_at) VALUES (?,?,?,?,'canje',?,?,?)").run(newId(), u.business_id, cu.id, -r.cost, r.id, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fidelidad.canje', entity: 'customer', entityId: cu.id, newValue: { reward: r.name, cost: r.cost } })
    return c.json({ reward: r.name, balance: bal - r.cost })
  })()
})

common.get('/customers/:id/loyalty', requirePerm('customers_credit'), (c) => {
  const cu = loadCustomer(c)
  const { db } = c.get('deps')
  const ledger = db.prepare('SELECT delta, reason, sale_id AS saleId, created_at AS createdAt FROM loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200').all(cu.id)
  const balance = (db.prepare('SELECT COALESCE(SUM(delta),0) p FROM loyalty_ledger WHERE customer_id = ?').get(cu.id) as { p: number }).p
  return c.json({ balance, ledger })
})

common.get('/visits', requireModule('asistencia'), requirePerm('view_reports'), (c) => {
  const date = c.req.query('date') ?? localDate(c.get('deps').now())
  const rows = c.get('deps').db.prepare('SELECT v.at, c.id AS customerId, c.name FROM visits v JOIN customers c ON c.id = v.customer_id WHERE v.business_id = ? AND v.visit_date = ? ORDER BY v.at').all(c.get('session').user.business_id, date)
  return c.json({ date, visits: rows })
})

// ---------- Asistencia del personal ----------

common.post('/attendance/clock', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ type: z.enum(['entrada', 'salida']), at: z.string().datetime().optional() }), await body(c))
  const last = db.prepare('SELECT type FROM staff_attendance WHERE user_id = ? ORDER BY at DESC, rowid DESC LIMIT 1').get(u.id) as { type: string } | undefined
  if ((last?.type ?? 'salida') === d.type) throw conflict(d.type === 'entrada' ? 'Ya registraste tu entrada.' : 'No tienes una entrada abierta.', 'asistencia_repetida')
  const at = iso(clampTime(d.at, now()))
  db.prepare('INSERT INTO staff_attendance (id, business_id, user_id, type, at) VALUES (?,?,?,?,?)').run(newId(), u.business_id, u.id, d.type, at)
  return c.json({ type: d.type, at }, 201)
})

common.get('/attendance', requirePerm('attendance'), (c) => {
  const u = c.get('session').user
  const from = c.req.query('from') ?? '0000'
  const to = c.req.query('to') ?? '9999'
  const all = u.role === 'owner' || hasPerm(u, 'view_reports')
  const rows = c.get('deps').db
    .prepare(`SELECT a.type, a.at, us.id AS userId, us.name FROM staff_attendance a JOIN users us ON us.id = a.user_id WHERE a.business_id = ? AND a.at >= ? AND a.at < ? ${all ? '' : 'AND a.user_id = ?'} ORDER BY a.at`)
    .all(...[u.business_id, from, to, ...(all ? [] : [u.id])])
  return c.json({ attendance: rows })
})
