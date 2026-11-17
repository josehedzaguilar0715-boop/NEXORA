import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, hasPerm, ownerOnly, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { cancelHooks, saleHooks, saleValidators, type ResolvedLine } from './sales.js'
import { bad, iso, localDate, newId } from './util.js'

/**
 * Comisiones por persona y por servicio, producto o categoría. Sin valores predeterminados:
 * si no hay regla, no hay comisión. Cada venta guarda el porcentaje aplicado.
 */
export function rateFor(db: Db, businessId: string, staffId: string, t: { serviceId?: string | null; productId?: string | null; category?: string | null; brand?: string | null }): number | null {
  const rules = db.prepare('SELECT staff_id, target_type, target_id, rate_bp FROM commission_rules WHERE business_id = ? AND (staff_id = ? OR staff_id IS NULL)').all(businessId, staffId) as { staff_id: string | null; target_type: string; target_id: string | null; rate_bp: number }[]
  const match = (staff: string | null, type: string, id: string | null | undefined) => rules.find((r) => r.staff_id === staff && r.target_type === type && (type === 'all' || r.target_id === id))
  // De lo más específico a lo más general.
  for (const staff of [staffId, null]) {
    const r =
      (t.serviceId ? match(staff, 'service', t.serviceId) : undefined) ??
      (t.productId ? match(staff, 'product', t.productId) : undefined) ??
      (t.brand ? match(staff, 'brand', t.brand) : undefined) ??
      (t.category ? match(staff, 'category', t.category) : undefined) ??
      match(staff, 'all', null)
    if (r) return r.rate_bp
  }
  return null
}

const staffOf = (l: ResolvedLine, sale: Record<string, unknown>) => ((l.input as { noCommission?: boolean }).noCommission ? null : (l.input as { staffId?: string }).staffId ?? (sale.staffId as string | undefined) ?? null)
const tipsSchema = z.array(z.object({ staffId: z.string(), amount: z.number().int().min(1), method: z.enum(['efectivo', 'transferencia', 'tarjeta']).optional() })).max(20)

// Antes de cobrar: quien atiende y quien recibe propina deben ser del negocio.
saleValidators.push(({ deps, user, input, lines }) => {
  const ids = new Set<string>()
  for (const l of lines) { const s = staffOf(l, input); if (s) ids.add(s) }
  const tips = input.tips === undefined ? [] : tipsSchema.parse(input.tips)
  for (const t of tips) ids.add(t.staffId)
  for (const id of ids) if (!deps.db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ? AND active = 1').get(id, user.business_id)) throw bad('La persona que atendió no es de este negocio.')
})

saleHooks.push(({ deps, user, saleId, shiftId, input, lines, total }) => {
  const { db, now } = deps
  const subtotal = lines.reduce((a, l) => a + l.total, 0)
  // Comisión sobre el precio final, con descuentos y promociones repartidos en proporción.
  const factor = subtotal ? total / subtotal : 0
  for (const l of lines) {
    const staff = staffOf(l, input)
    if (!staff) continue // sin quien atendió, no hay comisión
    const parts = l.serviceId ? (db.prepare('SELECT sc.service_id, sc.share, s.category FROM service_combos sc JOIN services s ON s.id = sc.service_id WHERE sc.combo_id = ?').all(l.serviceId) as { service_id: string; share: number; category: string | null }[]) : []
    const comboPrice = parts.reduce((a, p) => a + p.share, 0)
    const pieces = parts.length && comboPrice
      ? parts.map((p) => ({ target: { serviceId: p.service_id, category: p.category }, base: Math.round(((l.total * p.share) / comboPrice) * factor) }))
      : [{ target: { serviceId: l.serviceId, productId: l.productId, category: l.category, brand: l.productId ? ((JSON.parse((db.prepare('SELECT attrs FROM products WHERE id = ?').get(l.productId) as { attrs: string }).attrs) as { brand?: string }).brand ?? null) : null }, base: Math.round(l.total * factor) }]
    for (const pc of pieces) {
      const rate = rateFor(db, user.business_id, staff, pc.target)
      if (rate == null) continue
      db.prepare('INSERT INTO sale_commissions (id, business_id, sale_id, sale_item_id, staff_id, base, rate_bp, amount, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        newId(), user.business_id, saleId, l.itemId, staff, pc.base, rate, Math.round((pc.base * rate) / 10_000), iso(now()),
      )
    }
  }
  const tips = input.tips === undefined ? [] : tipsSchema.parse(input.tips)
  for (const t of tips) {
    const method = t.method ?? (input.paymentMethod === 'fiado' ? 'efectivo' : (input.paymentMethod as 'efectivo' | 'transferencia' | 'tarjeta'))
    db.prepare('INSERT INTO tips (id, business_id, sale_id, shift_id, staff_id, amount, method, created_at) VALUES (?,?,?,?,?,?,?,?)').run(newId(), user.business_id, saleId, shiftId, t.staffId, t.amount, method, iso(now()))
  }
})

cancelHooks.push(({ deps, saleId }) => {
  deps.db.prepare("UPDATE sale_commissions SET status = 'cancelada' WHERE sale_id = ?").run(saleId)
  deps.db.prepare("UPDATE tips SET status = 'cancelada' WHERE sale_id = ?").run(saleId)
})

export const commissions = new Hono<Env>()

commissions.get('/commission-rules', requirePerm('view_commissions'), (c) => {
  const rows = c.get('deps').db.prepare('SELECT id, staff_id AS staffId, target_type AS targetType, target_id AS targetId, rate_bp AS rateBp FROM commission_rules WHERE business_id = ?').all(c.get('session').user.business_id)
  return c.json({ rules: rows })
})

/** Reemplaza todas las reglas. El cambio aplica a ventas nuevas; las pasadas conservan su porcentaje. */
commissions.put('/commission-rules', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ rules: z.array(z.object({ staffId: z.string().nullable().optional(), targetType: z.enum(['service', 'product', 'category', 'brand', 'all']), targetId: z.string().nullable().optional(), rateBp: z.number().int().min(0).max(10_000) })).max(500) }), await body(c))
  for (const r of d.rules) {
    if (r.targetType !== 'all' && !r.targetId) throw bad('Cada regla necesita a qué servicio, producto, categoría o marca aplica.')
    if (r.staffId && !db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ?').get(r.staffId, u.business_id)) throw bad('Esa persona no es de este negocio.')
  }
  const old = db.prepare('SELECT staff_id, target_type, target_id, rate_bp FROM commission_rules WHERE business_id = ?').all(u.business_id)
  db.transaction(() => {
    db.prepare('DELETE FROM commission_rules WHERE business_id = ?').run(u.business_id)
    for (const r of d.rules) db.prepare('INSERT INTO commission_rules (id, business_id, staff_id, target_type, target_id, rate_bp, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), u.business_id, r.staffId ?? null, r.targetType, r.targetType === 'all' ? null : r.targetId, r.rateBp, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'comisiones.reglas', oldValue: old, newValue: d.rules })
  })()
  return c.json({ ok: true })
})

/** Combo de servicios: el dueño reparte el precio fijo entre sus servicios. */
commissions.put('/services/:id/combo', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const combo = db.prepare('SELECT id, price FROM services WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; price: number } | undefined
  if (!combo) throw bad('Ese servicio no existe.')
  const d = parse(z.object({ items: z.array(z.object({ serviceId: z.string(), share: z.number().int().min(0) })).min(2).max(20) }), await body(c))
  if (d.items.reduce((a, i) => a + i.share, 0) !== combo.price) throw bad('El reparto debe sumar exactamente el precio del combo.')
  for (const i of d.items) {
    if (i.serviceId === combo.id) throw bad('Un combo no puede contenerse a sí mismo.')
    if (!db.prepare('SELECT 1 FROM services WHERE id = ? AND business_id = ?').get(i.serviceId, u.business_id)) throw bad('Uno de los servicios no existe.')
  }
  db.transaction(() => {
    db.prepare('DELETE FROM service_combos WHERE combo_id = ?').run(combo.id)
    for (const i of d.items) db.prepare('INSERT INTO service_combos (combo_id, service_id, share) VALUES (?,?,?)').run(combo.id, i.serviceId, i.share)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'servicio.combo', entity: 'service', entityId: combo.id, newValue: d.items })
  })()
  return c.json({ ok: true })
})

/** Comisiones y propinas por persona. Cada quien ve las suyas; con "ver reportes", las de todos. */
commissions.get('/reports/commissions', requirePerm('view_commissions'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const today = localDate(now())
  const from = c.req.query('from') ?? today
  const to = c.req.query('to') ?? today
  const start = new Date(`${from}T06:00:00.000Z`).toISOString()
  const end = new Date(new Date(`${to}T06:00:00.000Z`).getTime() + 86_400_000).toISOString()
  const all = hasPerm(u, 'view_reports')
  const filter = all ? '' : 'AND x.staff_id = ?'
  const args = all ? [] : [u.id]
  const com = db.prepare(`SELECT x.staff_id AS staffId, us.name, COUNT(*) AS items, SUM(x.base) AS base, SUM(x.amount) AS commission FROM sale_commissions x JOIN users us ON us.id = x.staff_id WHERE x.business_id = ? AND x.status = 'vigente' AND x.created_at >= ? AND x.created_at < ? ${filter} GROUP BY x.staff_id`).all(u.business_id, start, end, ...args) as { staffId: string; name: string; base: number; commission: number }[]
  const tips = db.prepare(`SELECT x.staff_id AS staffId, us.name, SUM(x.amount) AS tips, SUM(CASE WHEN x.method = 'efectivo' THEN x.amount ELSE 0 END) AS tipsCash FROM tips x JOIN users us ON us.id = x.staff_id WHERE x.business_id = ? AND x.status = 'vigente' AND x.created_at >= ? AND x.created_at < ? ${filter} GROUP BY x.staff_id`).all(u.business_id, start, end, ...args) as { staffId: string; name: string; tips: number; tipsCash: number }[]
  const ids = new Set([...com.map((r) => r.staffId), ...tips.map((r) => r.staffId)])
  const rows = [...ids].map((id) => {
    const a = com.find((r) => r.staffId === id)
    const b = tips.find((r) => r.staffId === id)
    return { staffId: id, name: a?.name ?? b?.name, base: a?.base ?? 0, commission: a?.commission ?? 0, tips: b?.tips ?? 0, tipsCash: b?.tipsCash ?? 0 }
  })
  return c.json({ from, to, staff: rows })
})
