import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, hasPerm, ownerOnly, parse, requirePerm, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { consume, getProduct, type MoveCtx } from './inventory.js'
import { carryMilli, createSale, parseSale } from './sales.js'
import { getSettings } from './settings.js'
import { AppError, bad, conflict, forbidden, iso, localDate, newId, notFound, type Clock } from './util.js'

/** Baños públicos: entradas cobradas, pases con QR, conteo de accesos, insumos por acceso, limpieza y cobro por tiempo. */
export const baths = new Hono<Env>()

const accessOwner = (businessId: string) => `access:${businessId}`
type TimeRate = { blockMin: number; blockPrice: number }
const timeRateOf = (attrs: string) => (JSON.parse(attrs) as { timeRate?: TimeRate }).timeRate

/** Insumos de uso por acceso (papel, jabón, cloro…), con la referencia que define el dueño. */
function consumeAccessSupplies(db: Db, now: Clock, user: UserRow, branchId: string, accessId: string) {
  const ctx: MoveCtx = { db, now, businessId: user.business_id, branchId, userId: user.id }
  const recipe = db.prepare('SELECT product_id, qty_micro FROM recipes WHERE owner_id = ?').all(accessOwner(user.business_id)) as { product_id: string; qty_micro: number }[]
  for (const r of recipe) {
    const milli = carryMilli(db, branchId, r.product_id, r.qty_micro)
    if (milli > 0) consume(ctx, r.product_id, milli, 'consumo', accessId, 'Insumos por acceso')
  }
}

baths.put('/baths/access-supplies', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  // Ej.: un rollo de papel cada 40 accesos → quantity 0.025.
  const d = parse(z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).max(30) }), await body(c))
  for (const it of d.items) getProduct(db, u.business_id, it.productId)
  db.transaction(() => {
    db.prepare('DELETE FROM recipes WHERE owner_id = ?').run(accessOwner(u.business_id))
    for (const it of d.items) db.prepare('INSERT INTO recipes (owner_id, product_id, qty_micro) VALUES (?,?,?)').run(accessOwner(u.business_id), it.productId, Math.max(1, Math.round(it.quantity * 1_000_000)))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'banos.insumos_por_acceso', newValue: d.items })
  })()
  return c.json({ ok: true })
})

/** Cobro al entrar: varias tarifas en una sola entrada. Un servicio por tiempo se cobra a la salida. */
baths.post('/baths/entry', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(
    z.object({
      id: z.string().uuid().optional(), services: z.array(z.object({ serviceId: z.string(), quantity: z.number().int().min(1).max(50).default(1) })).min(1).max(10),
      paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), cashReceived: z.number().int().optional(), createdAt: z.string().datetime().optional(),
    }),
    await body(c),
  )
  if (d.id) {
    const prev = db.prepare('SELECT id, sale_id FROM accesses WHERE id = ? AND business_id = ?').get(d.id, u.business_id)
    if (prev) return c.json({ duplicate: true, access: prev })
  }
  const svcs = d.services.map((s) => {
    const row = db.prepare('SELECT id, name, price, attrs FROM services WHERE id = ? AND business_id = ? AND active = 1').get(s.serviceId, u.business_id) as { id: string; name: string; price: number; attrs: string } | undefined
    if (!row) throw bad('Una de las tarifas no existe.')
    return { ...s, name: row.name, timed: timeRateOf(row.attrs) }
  })
  const timed = svcs.filter((s) => s.timed)
  if (timed.length > 1) throw bad('Solo puede haber un servicio por tiempo por entrada.')
  const charged = svcs.filter((s) => !s.timed)
  const shift = db.prepare("SELECT id, branch_id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string; branch_id: string } | undefined
  if (!shift) throw conflict('Abre tu caja con el fondo inicial para cobrar entradas.', 'caja_cerrada')
  const accessId = d.id ?? newId()
  const result = db.transaction(() => {
    const sale = charged.length
      ? createSale(deps, u, parseSale({ id: newId(), paymentMethod: d.paymentMethod, cashReceived: d.cashReceived, createdAt: d.createdAt, items: charged.map((s) => ({ serviceId: s.serviceId, quantity: s.quantity })) })).sale
      : null
    db.prepare('INSERT INTO accesses (id, business_id, branch_id, kind, sale_id, services, at, timed_service_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(
      accessId, u.business_id, shift.branch_id, 'cobro', sale?.id ?? null, JSON.stringify(svcs.map((s) => ({ serviceId: s.serviceId, name: s.name, quantity: s.quantity }))), sale?.createdAt ?? iso(now()), timed[0]?.serviceId ?? null, u.id,
    )
    consumeAccessSupplies(db, now, u, shift.branch_id, accessId)
    return { accessId, sale }
  })()
  return c.json(result, 201)
})

/** Salida de un servicio por tiempo: se cobra por bloques completos o empezados. */
baths.post('/baths/accesses/:id/exit', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const a = db.prepare('SELECT * FROM accesses WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; at: string; timed_service_id: string | null; exited_at: string | null } | undefined
  if (!a) throw notFound('No se encontró ese acceso.')
  if (!a.timed_service_id) throw bad('Esa entrada no tiene servicio por tiempo.')
  if (a.exited_at) throw conflict('Esa salida ya se cobró.', 'ya_cobrado')
  const d = parse(z.object({ paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), cashReceived: z.number().int().optional() }), await body(c))
  const svc = db.prepare('SELECT name, attrs FROM services WHERE id = ?').get(a.timed_service_id) as { name: string; attrs: string }
  const rate = timeRateOf(svc.attrs)!
  const minutes = Math.max(1, Math.ceil((now().getTime() - Date.parse(a.at)) / 60_000))
  const blocks = Math.ceil(minutes / rate.blockMin)
  const result = db.transaction(() => {
    const sale = createSale(deps, u, parseSale({ id: newId(), paymentMethod: d.paymentMethod, cashReceived: d.cashReceived, items: [{ serviceId: a.timed_service_id, quantity: blocks, unitPrice: rate.blockPrice, description: `${svc.name} (${minutes} min)` }] }), { trustedPrices: true }).sale
    db.prepare('UPDATE accesses SET exited_at = ?, exit_sale_id = ? WHERE id = ?').run(iso(now()), sale.id, a.id)
    return { minutes, blocks, sale }
  })()
  return c.json(result)
})

/** Entrada con pase (día, semana o mes): el QR valida el pase, cuenta el acceso y registra asistencia. */
baths.post('/baths/pass-entry', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (!hasPerm(u, 'sell') && !hasPerm(u, 'attendance')) throw forbidden()
  const d = parse(z.object({ code: z.string().trim().min(4).max(64) }), await body(c))
  const cu = db.prepare('SELECT id, name FROM customers WHERE code = ? AND business_id = ? AND active = 1').get(d.code.toUpperCase(), u.business_id) as { id: string; name: string } | undefined
  if (!cu) throw new AppError(404, 'codigo_invalido', 'Código no válido para este negocio.')
  const t = iso(now())
  const pass = (db.prepare('SELECT id, plan_snapshot, ends_at FROM customer_memberships WHERE customer_id = ? AND starts_at <= ? AND ends_at > ? ORDER BY ends_at DESC').all(cu.id, t, t) as { id: string; plan_snapshot: string; ends_at: string }[])
    .find((m) => (JSON.parse(m.plan_snapshot) as { kind?: string }).kind === 'pase')
  if (!pass) throw conflict('Este cliente no tiene un pase vigente.', 'pase_no_vigente')
  // Un código no se usa dos veces en la misma visita (ventana configurable, 30 min por defecto).
  const reentry = (getSettings(db, u.business_id) as { passReentryMin?: number }).passReentryMin ?? 30
  const last = db.prepare("SELECT at FROM accesses WHERE membership_id = ? ORDER BY at DESC LIMIT 1").get(pass.id) as { at: string } | undefined
  if (last && Date.parse(t) - Date.parse(last.at) < reentry * 60_000) throw conflict('Este pase ya entró hace un momento.', 'ya_registrado')
  const branchId = u.branch_id!
  const id = newId()
  db.transaction(() => {
    db.prepare("INSERT INTO accesses (id, business_id, branch_id, kind, customer_id, membership_id, services, at, created_by) VALUES (?,?,?,'pase',?,?,'[]',?,?)").run(id, u.business_id, branchId, cu.id, pass.id, t, u.id)
    db.prepare('INSERT OR IGNORE INTO visits (id, business_id, customer_id, visit_date, at, scanned_by) VALUES (?,?,?,?,?,?)').run(newId(), u.business_id, cu.id, localDate(now()), t, u.id)
    consumeAccessSupplies(db, now, u, branchId, id)
  })()
  return c.json({ accessId: id, customer: cu.name, passEndsAt: pass.ends_at }, 201)
})

/** Conteo de accesos por hora, día, tipo de servicio y tipo de entrada. */
baths.get('/reports/accesses', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const today = localDate(now())
  const from = c.req.query('from') ?? today
  const to = c.req.query('to') ?? today
  const start = new Date(`${from}T06:00:00.000Z`).toISOString()
  const end = new Date(new Date(`${to}T06:00:00.000Z`).getTime() + 86_400_000).toISOString()
  const rows = db.prepare('SELECT a.kind, a.services, a.at, s.status FROM accesses a LEFT JOIN sales s ON s.id = a.sale_id WHERE a.business_id = ? AND a.at >= ? AND a.at < ?').all(u.business_id, start, end) as { kind: string; services: string; at: string; status: string | null }[]
  const valid = rows.filter((r) => r.status !== 'cancelada')
  const byHour = Array.from({ length: 24 }, () => 0)
  const byDay: Record<string, number> = {}
  const byService: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  for (const r of valid) {
    const local = new Date(Date.parse(r.at) - 6 * 3600_000)
    byHour[local.getUTCHours()]!++
    const day = local.toISOString().slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + 1
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    for (const s of JSON.parse(r.services) as { name: string; quantity: number }[]) byService[s.name] = (byService[s.name] ?? 0) + s.quantity
  }
  return c.json({ from, to, total: valid.length, byHour, byDay, byService, byKind })
})

// ---------- Limpieza por turno (interno) ----------

baths.get('/cleaning/tasks', (c) => c.json({ tasks: c.get('deps').db.prepare('SELECT id, name, active FROM cleaning_tasks WHERE business_id = ? ORDER BY name').all(c.get('session').user.business_id) }))

baths.post('/cleaning/tasks', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(100) }), await body(c))
  const id = newId()
  db.prepare('INSERT INTO cleaning_tasks (id, business_id, name, created_at) VALUES (?,?,?,?)').run(id, u.business_id, d.name, iso(now()))
  return c.json({ id }, 201)
})

/** Quién hizo cada tarea y a qué hora. */
baths.post('/cleaning/log', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ taskId: z.string(), note: z.string().max(300).optional() }), await body(c))
  if (!db.prepare('SELECT 1 FROM cleaning_tasks WHERE id = ? AND business_id = ? AND active = 1').get(d.taskId, u.business_id)) throw bad('Esa tarea no existe.')
  const shift = db.prepare("SELECT id FROM shifts WHERE business_id = ? AND branch_id = ? AND status = 'abierto' ORDER BY opened_at DESC LIMIT 1").get(u.business_id, u.branch_id) as { id: string } | undefined
  const id = newId()
  db.prepare('INSERT INTO cleaning_log (id, business_id, task_id, user_id, shift_id, at, note) VALUES (?,?,?,?,?,?,?)').run(id, u.business_id, d.taskId, u.id, shift?.id ?? null, iso(now()), d.note ?? null)
  return c.json({ id }, 201)
})

baths.get('/cleaning/log', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const date = c.req.query('date') ?? localDate(now())
  const start = new Date(`${date}T06:00:00.000Z`).toISOString()
  const end = new Date(Date.parse(start) + 86_400_000).toISOString()
  const all = hasPerm(u, 'view_reports')
  const rows = db.prepare(`SELECT l.at, t.name AS task, us.name AS who, l.note FROM cleaning_log l JOIN cleaning_tasks t ON t.id = l.task_id JOIN users us ON us.id = l.user_id WHERE l.business_id = ? AND l.at >= ? AND l.at < ? ${all ? '' : 'AND l.user_id = ?'} ORDER BY l.at`).all(...[u.business_id, start, end, ...(all ? [] : [u.id])])
  return c.json({ date, log: rows })
})
