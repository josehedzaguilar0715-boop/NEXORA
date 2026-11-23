import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { assertCashAvailable } from './cash.js'
import { body, isManager, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, conflict, forbidden, iso, newId } from './util.js'

/**
 * Pago de comisiones y propinas al personal (barberos, técnicas, asesoras, meseros).
 * Se paga lo pendiente hasta hoy; cada renglón se paga una sola vez. Si una venta ya pagada se cancela,
 * lo pagado de más se descuenta en el siguiente pago. Nada se borra.
 */
export const payouts = new Hono<Env>()

export function pendingFor(db: Db, businessId: string, staffId: string) {
  const one = (sql: string) => (db.prepare(sql).get(businessId, staffId) as { v: number }).v
  const commission = one("SELECT COALESCE(SUM(amount),0) v FROM sale_commissions WHERE business_id = ? AND staff_id = ? AND status = 'vigente' AND payout_id IS NULL")
  const tips = one("SELECT COALESCE(SUM(amount),0) v FROM tips WHERE business_id = ? AND staff_id = ? AND status = 'vigente' AND payout_id IS NULL")
  // Pagado y luego cancelado: se descuenta.
  const adjustments = -(one("SELECT COALESCE(SUM(amount),0) v FROM sale_commissions WHERE business_id = ? AND staff_id = ? AND status <> 'vigente' AND payout_id IS NOT NULL AND clawback_id IS NULL")
    + one("SELECT COALESCE(SUM(amount),0) v FROM tips WHERE business_id = ? AND staff_id = ? AND status <> 'vigente' AND payout_id IS NOT NULL AND clawback_id IS NULL"))
  return { commission, tips, adjustments, amount: commission + tips + adjustments }
}

payouts.get('/staff-payouts/pending', requirePerm('view_commissions', 'cancel_discount'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const staff = (isManager(u)
    ? db.prepare('SELECT id, name FROM users WHERE business_id = ? ORDER BY name').all(u.business_id)
    : db.prepare('SELECT id, name FROM users WHERE id = ?').all(u.id)) as { id: string; name: string }[]
  const rows = staff.map((s) => ({ staffId: s.id, name: s.name, ...pendingFor(db, u.business_id, s.id) })).filter((r) => r.commission || r.tips || r.adjustments)
  return c.json({ staff: rows })
})

payouts.get('/staff-payouts', requirePerm('view_commissions', 'cancel_discount'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const filter = isManager(u) ? '' : 'AND p.staff_id = ?'
  const rows = db.prepare(`SELECT p.id, p.staff_id AS staffId, us.name, p.commission, p.tips, p.adjustments, p.amount, p.method, p.note, p.created_at AS createdAt FROM staff_payouts p JOIN users us ON us.id = p.staff_id WHERE p.business_id = ? ${filter} ORDER BY p.created_at DESC LIMIT 200`).all(u.business_id, ...(isManager(u) ? [] : [u.id]))
  return c.json({ payouts: rows })
})

payouts.post('/staff-payouts', requirePerm('view_commissions', 'cancel_discount'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  if (!isManager(u)) throw forbidden('Solo el dueño o el encargado registran pagos al personal.')
  const d = parse(z.object({ id: z.string().uuid().optional(), staffId: z.string(), method: z.enum(['efectivo', 'transferencia']), note: z.string().trim().max(200).optional(), authCode: z.string().optional() }), await body(c))
  if (d.id) {
    const prev = db.prepare('SELECT * FROM staff_payouts WHERE id = ? AND business_id = ?').get(d.id, u.business_id)
    if (prev) return c.json({ payout: prev, duplicate: true })
  }
  const who = db.prepare('SELECT id, name FROM users WHERE id = ? AND business_id = ?').get(d.staffId, u.business_id) as { id: string; name: string } | undefined
  if (!who) throw bad('Esa persona no es de este negocio.')
  const auth = u.role === 'owner' ? null : authorize(deps, u, d.authCode, 'cancel_discount', 'pagar comisiones', { ownerOnly: true })
  const shift = d.method === 'efectivo' ? (db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined) : undefined
  if (d.method === 'efectivo' && !shift) throw conflict('Abre tu caja para pagar en efectivo, o paga por transferencia.', 'caja_cerrada')
  const id = d.id ?? newId()
  const at = iso(now())
  const p = db.transaction(() => {
    const p = pendingFor(db, u.business_id, who.id)
    if (p.amount <= 0) throw bad(p.amount < 0 ? `No hay nada que pagar: se le pagaron de más ${(-p.amount / 100).toFixed(2)} pesos por ventas canceladas; se descontará cuando tenga más comisiones.` : 'No hay comisiones ni propinas pendientes de pagar.', 'nada_pendiente')
    if (shift) assertCashAvailable(db, shift.id, p.amount, `pagarle a ${who.name}`)
    db.prepare('INSERT INTO staff_payouts (id, business_id, staff_id, commission, tips, adjustments, amount, method, shift_id, note, authorized_by, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, who.id, p.commission, p.tips, p.adjustments, p.amount, d.method, shift?.id ?? null, d.note ?? null, auth?.id ?? null, u.id, at)
    for (const t of ['sale_commissions', 'tips']) {
      db.prepare(`UPDATE ${t} SET payout_id = ? WHERE business_id = ? AND staff_id = ? AND status = 'vigente' AND payout_id IS NULL`).run(id, u.business_id, who.id)
      db.prepare(`UPDATE ${t} SET clawback_id = ? WHERE business_id = ? AND staff_id = ? AND status <> 'vigente' AND payout_id IS NOT NULL AND clawback_id IS NULL`).run(id, u.business_id, who.id)
    }
    if (shift) db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift.id, p.amount, `Pago a ${who.name}: comisiones y propinas`, u.id, at)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'personal.pago', entity: 'user', entityId: who.id, newValue: { ...p, method: d.method }, ...(auth ? { authorizedBy: auth.id } : {}) })
    return p
  })()
  return c.json({ payout: { id, staffId: who.id, name: who.name, ...p, method: d.method, createdAt: at } }, 201)
})
