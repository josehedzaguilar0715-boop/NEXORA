import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { z } from 'zod'
import { localToIso } from './agenda.js'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { moduleOn } from './common.js'
import { body, hasPerm, ownerOnly, parse, requirePerm, type C, type Deps, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { createSale, parseSale } from './sales.js'
import { AppError, bad, conflict, forbidden, iso, localDate, newId, normalizePhone, notFound } from './util.js'

/** Lugar turístico: boletos por tipo, fecha y horario con aforo; acceso con QR; taquilla; visitas guiadas; cierres. */
export const tourism = new Hono<Env>()
export const publicTourism = new Hono<Env>()

const weekdayOf = (date: string) => new Date(`${date}T12:00:00-06:00`).getUTCDay()
const ticketCode = () => 'BT' + randomBytes(10).toString('base64url').replace(/[-_]/g, 'X').toUpperCase().slice(0, 14)
const LIVE = "('por_pagar','pagado','usado')"

interface Slot { start: string; end: string; capacity: number; sold: number; available: number; closed: boolean }

export function slotsFor(db: Db, businessId: string, date: string): Slot[] {
  const tpl = db.prepare('SELECT start, end, capacity FROM slot_templates WHERE business_id = ? AND weekday = ? ORDER BY start').all(businessId, weekdayOf(date)) as { start: string; end: string; capacity: number }[]
  const closures = db.prepare('SELECT start FROM slot_closures WHERE business_id = ? AND date = ?').all(businessId, date) as { start: string | null }[]
  return tpl.map((t) => {
    const sold = (db.prepare(`SELECT COUNT(*) n FROM entry_tickets WHERE business_id = ? AND date = ? AND start = ? AND tour_id IS NULL AND status IN ${LIVE}`).get(businessId, date, t.start) as { n: number }).n
    const closed = closures.some((c) => c.start === null || c.start === t.start)
    return { ...t, sold, available: closed ? 0 : Math.max(0, t.capacity - sold), closed }
  })
}

interface Line { serviceId: string; quantity: number }
/** Reserva lugares: nunca se vende de más (aforo por horario o cupo de la visita guiada). */
function prepareTickets(db: Db, businessId: string, date: string, start: string, items: Line[], tourId: string | undefined, now: Date) {
  const n = items.reduce((a, i) => a + i.quantity, 0)
  if (tourId) {
    const t = db.prepare("SELECT * FROM tours WHERE id = ? AND business_id = ? AND status = 'abierta'").get(tourId, businessId) as { capacity: number; date: string; start: string; service_id: string } | undefined
    if (!t) throw bad('Esa visita guiada no existe o está cancelada.')
    if (t.date !== date || t.start !== start) throw bad('La visita guiada es de otra fecha u hora.')
    const sold = (db.prepare(`SELECT COUNT(*) n FROM entry_tickets WHERE tour_id = ? AND status IN ${LIVE}`).get(tourId) as { n: number }).n
    if (sold + n > t.capacity) throw conflict(`Solo quedan ${t.capacity - sold} lugares en la visita guiada.`, 'sin_cupo')
  } else {
    const slot = slotsFor(db, businessId, date).find((s) => s.start === start)
    if (!slot) throw bad('No hay ese horario ese día.')
    if (slot.closed) throw conflict('Ese horario está cerrado.', 'horario_cerrado')
    if (n > slot.available) throw conflict(`Solo quedan ${slot.available} lugares en ese horario.`, 'sin_cupo')
    if (localToIso(date, slot.end) <= iso(now)) throw bad('Ese horario ya pasó.')
  }
  return items.map((i) => {
    const s = db.prepare('SELECT id, name, price FROM services WHERE id = ? AND business_id = ? AND active = 1').get(i.serviceId, businessId) as { id: string; name: string; price: number } | undefined
    if (!s) throw bad('Ese tipo de boleto no existe.')
    return { ...i, name: s.name, price: s.price }
  })
}

function insertTickets(db: Db, businessId: string, lines: { serviceId: string; name: string; price: number; quantity: number }[], t: { date: string; start: string; tourId?: string; channel: string; status: string; saleId: string | null; orderToken: string | null; buyer?: string; phone?: string | null; now: Date }) {
  const codes: { code: string; type: string }[] = []
  for (const l of lines) for (let k = 0; k < l.quantity; k++) {
    const code = ticketCode()
    db.prepare('INSERT INTO entry_tickets (id, business_id, code, service_id, type_name, price, date, start, tour_id, channel, status, sale_id, order_token, buyer_name, phone, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      newId(), businessId, code, l.serviceId, l.name, l.price, t.date, t.start, t.tourId ?? null, t.channel, t.status, t.saleId, t.orderToken, t.buyer ?? null, t.phone ?? null, iso(t.now),
    )
    codes.push({ code, type: l.name })
  }
  return codes
}

const sellBody = z.object({
  id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), tourId: z.string().optional(),
  items: z.array(z.object({ serviceId: z.string(), quantity: z.number().int().min(1).max(500) })).min(1).max(20),
  paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), cashReceived: z.number().int().optional(),
})

// ---------- Configuración ----------

tourism.put('/tourism/slots', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  const d = parse(z.object({ slots: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hm, end: hm, capacity: z.number().int().min(1).max(100_000) })).max(200) }), await body(c))
  db.transaction(() => {
    db.prepare('DELETE FROM slot_templates WHERE business_id = ?').run(u.business_id)
    for (const s of d.slots) {
      if (s.start >= s.end) throw bad('Cada horario debe terminar después de empezar.')
      db.prepare('INSERT INTO slot_templates (id, business_id, weekday, start, end, capacity) VALUES (?,?,?,?,?,?)').run(newId(), u.business_id, s.weekday, s.start, s.end, s.capacity)
    }
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'turistico.horarios', newValue: d.slots })
  })()
  return c.json({ ok: true })
})

tourism.get('/tourism/slots', (c) => {
  const { db, now } = c.get('deps')
  const date = c.req.query('date') ?? localDate(now())
  return c.json({ date, slots: slotsFor(db, c.get('session').user.business_id, date) })
})

tourism.post('/tours', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), capacity: z.number().int().min(1).max(1000), guideId: z.string().optional(), serviceId: z.string() }), await body(c))
  if (d.guideId && !db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ?').get(d.guideId, u.business_id)) throw bad('Ese guía no es del negocio.')
  if (!db.prepare('SELECT 1 FROM services WHERE id = ? AND business_id = ?').get(d.serviceId, u.business_id)) throw bad('Ese tipo de boleto no existe.')
  const id = newId()
  db.prepare('INSERT INTO tours (id, business_id, name, date, start, capacity, guide_id, service_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, u.business_id, d.name, d.date, d.start, d.capacity, d.guideId ?? null, d.serviceId, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'turistico.visita_guiada', entity: 'tour', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

tourism.get('/tours', (c) => {
  const { db, now } = c.get('deps')
  const date = c.req.query('date') ?? localDate(now())
  const rows = db.prepare("SELECT t.id, t.name, t.date, t.start, t.capacity, t.status, u.name AS guide, (SELECT COUNT(*) FROM entry_tickets k WHERE k.tour_id = t.id AND k.status IN ('por_pagar','pagado','usado')) AS sold FROM tours t LEFT JOIN users u ON u.id = t.guide_id WHERE t.business_id = ? AND t.date = ? ORDER BY t.start").all(c.get('session').user.business_id, date)
  return c.json({ tours: rows })
})

// ---------- Taquilla ----------

tourism.post('/tourism/sell', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(sellBody, await body(c))
  const result = db.transaction(() => {
    const lines = prepareTickets(db, u.business_id, d.date, d.start, d.items, d.tourId, now())
    // Grupos con descuento por cantidad: vía promociones (se aplican solas en la venta).
    const sale = createSale(deps, u, parseSale({ id: d.id ?? newId(), paymentMethod: d.paymentMethod, cashReceived: d.cashReceived, items: lines.map((l) => ({ serviceId: l.serviceId, quantity: l.quantity, description: `Boleto ${l.name} ${d.date} ${d.start}` })) }))
    if (sale.duplicate) return { sale: sale.sale, tickets: db.prepare('SELECT code, type_name AS type FROM entry_tickets WHERE sale_id = ?').all(sale.sale.id) }
    const tickets = insertTickets(db, u.business_id, lines, { date: d.date, start: d.start, tourId: d.tourId, channel: 'taquilla', status: 'pagado', saleId: sale.sale.id, orderToken: null, now: now() })
    return { sale: sale.sale, tickets }
  })()
  return c.json(result, 201)
})

/** Cobrar en taquilla una compra hecha en línea (queda "por pagar" hasta entonces). */
tourism.post('/tourism/orders/:token/pay', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(z.object({ paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), cashReceived: z.number().int().optional() }), await body(c))
  const tks = db.prepare("SELECT * FROM entry_tickets WHERE order_token = ? AND business_id = ? AND status = 'por_pagar'").all(c.req.param('token'), u.business_id) as { id: string; service_id: string; type_name: string; price: number; date: string; start: string }[]
  if (!tks.length) throw notFound('No hay boletos por pagar con ese folio.')
  const result = db.transaction(() => {
    const sale = createSale(deps, u, parseSale({ id: newId(), paymentMethod: d.paymentMethod, cashReceived: d.cashReceived, items: tks.map((t) => ({ serviceId: t.service_id, quantity: 1, unitPrice: t.price, description: `Boleto ${t.type_name} ${t.date} ${t.start} (en línea)` })) }), { trustedPrices: true }).sale
    for (const t of tks) db.prepare("UPDATE entry_tickets SET status = 'pagado', sale_id = ? WHERE id = ?").run(sale.id, t.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'turistico.pago_en_linea', newValue: { tickets: tks.length, saleId: sale.id } })
    return { sale, paid: tks.length }
  })()
  return c.json(result)
})

/** Control de acceso: un boleto sirve una entrada. Rechaza repetidos, vencidos, cancelados y sin pagar. */
tourism.post('/tourism/scan', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (!hasPerm(u, 'sell') && !hasPerm(u, 'attendance')) throw forbidden()
  const d = parse(z.object({ code: z.string().trim().min(4).max(40) }), await body(c))
  const t = db.prepare('SELECT * FROM entry_tickets WHERE code = ? AND business_id = ?').get(d.code.toUpperCase(), u.business_id) as { id: string; status: string; date: string; start: string; type_name: string; used_at: string | null; tour_id: string | null } | undefined
  const reject = (code: string, msg: string) => { throw new AppError(409, code, msg) }
  if (!t) throw new AppError(404, 'boleto_invalido', 'Boleto no válido.')
  if (t.status === 'cancelado') reject('boleto_cancelado', 'Boleto cancelado.')
  if (t.status === 'usado') reject('boleto_usado', `Este boleto ya entró a las ${new Date(t.used_at!).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })}.`)
  if (t.status === 'por_pagar') reject('boleto_sin_pagar', 'Boleto sin pagar: cóbralo en taquilla.')
  const today = localDate(now())
  const end = t.tour_id ? null : slotsFor(db, u.business_id, t.date).find((s) => s.start === t.start)?.end
  if (t.date < today || (t.date === today && end && localToIso(t.date, end) <= iso(now()))) reject('boleto_vencido', `Boleto vencido (era para el ${t.date} a las ${t.start}).`)
  if (t.date > today) reject('boleto_otro_dia', `Este boleto es para el ${t.date}.`)
  db.transaction(() => {
    db.prepare("UPDATE entry_tickets SET status = 'usado', used_at = ? WHERE id = ?").run(iso(now()), t.id)
    db.prepare("INSERT INTO occupancy_events (id, business_id, type, ticket_id, at, created_by) VALUES (?,?,'entrada',?,?,?)").run(newId(), u.business_id, t.id, iso(now()), u.id)
  })()
  return c.json({ ok: true, type: t.type_name, occupancy: occupancy(db, u.business_id, today) })
})

tourism.post('/tourism/exit', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (!hasPerm(u, 'sell') && !hasPerm(u, 'attendance')) throw forbidden()
  const d = parse(z.object({ count: z.number().int().min(1).max(500).default(1) }), await body(c))
  const today = localDate(now())
  if (occupancy(db, u.business_id, today) < d.count) throw bad('No hay tantas personas adentro.')
  db.prepare("INSERT INTO occupancy_events (id, business_id, type, count, at, created_by) VALUES (?,?,'salida',?,?,?)").run(newId(), u.business_id, d.count, iso(now()), u.id)
  return c.json({ occupancy: occupancy(db, u.business_id, today) })
})

function occupancy(db: Db, businessId: string, date: string): number {
  const start = localToIso(date, '00:00')
  const r = db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'entrada' THEN count ELSE -count END),0) n FROM occupancy_events WHERE business_id = ? AND at >= ?").get(businessId, start) as { n: number }
  return r.n
}

/** Aforo en tiempo real: cuántas personas hay adentro. */
tourism.get('/tourism/occupancy', (c) => {
  const { db, now } = c.get('deps')
  return c.json({ inside: occupancy(db, c.get('session').user.business_id, localDate(now())) })
})

// ---------- Cancelaciones, reembolsos y cierres (siempre con código del dueño) ----------

function cancelTickets(deps: Deps, u: UserRow, ids: string[], reason: string, refund: { method: 'efectivo' | 'transferencia' | 'tarjeta' } | null, authId: string) {
  const { db, now } = deps
  const tks = ids.map((id) => db.prepare('SELECT * FROM entry_tickets WHERE id = ? AND business_id = ?').get(id, u.business_id) as { id: string; status: string; price: number; sale_id: string | null; type_name: string })
  const shift = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined
  let refunded = 0
  for (const t of tks) {
    if (!t || t.status === 'cancelado' || t.status === 'usado') continue
    db.prepare("UPDATE entry_tickets SET status = 'cancelado', cancel_reason = ?, cancelled_by = ?, refunded = ? WHERE id = ?").run(reason, u.id, refund && t.status === 'pagado' ? 1 : 0, t.id)
    if (refund && t.status === 'pagado') refunded += t.price
  }
  if (refunded) {
    if (refund!.method === 'efectivo' && !shift) throw conflict('Abre tu caja para devolver en efectivo.', 'caja_cerrada')
    const rid = newId()
    db.prepare('INSERT INTO returns (id, business_id, branch_id, sale_id, shift_id, amount, refund_method, reason, authorized_by, created_by, created_at) VALUES (?,?,?,NULL,?,?,?,?,?,?,?)').run(rid, u.business_id, u.branch_id, shift?.id ?? null, refunded, refund!.method, `Boletos: ${reason}`, authId, u.id, iso(now()))
    if (refund!.method === 'efectivo') db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift!.id, refunded, `Reembolso de boletos: ${reason}`, u.id, iso(now()))
  }
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'turistico.cancelacion', newValue: { tickets: ids.length, refunded }, authorizedBy: authId, reason })
  return refunded
}

/** Sin reembolso automático: cancelar y devolver lo decide el dueño con su código. */
tourism.post('/tickets/cancel', requirePerm('cancel_discount'), async (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ codes: z.array(z.string()).min(1).max(500), reason: z.string().trim().min(3).max(300), refund: z.boolean(), refundMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('efectivo'), authCode: z.string().optional() }), await body(c))
  const auth = authorize(deps, u, d.authCode, 'cancel_discount', 'cancelación de boletos', { ownerOnly: true })
  const ids = d.codes.map((code) => (deps.db.prepare('SELECT id FROM entry_tickets WHERE code = ? AND business_id = ?').get(code.toUpperCase(), u.business_id) as { id: string } | undefined)?.id).filter(Boolean) as string[]
  const refunded = deps.db.transaction(() => cancelTickets(deps, u, ids, d.reason, d.refund ? { method: d.refundMethod } : null, auth.id))()
  return c.json({ cancelled: ids.length, refunded })
})

/**
 * Cierre temporal de un día u horario (clima, mantenimiento). Con código. Devuelve los boletos afectados
 * con un mensaje listo para avisar; cancelarlos (y reembolsar o no) también pide código.
 */
tourism.post('/tourism/closures', requirePerm('cancel_discount'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/).optional(), reason: z.string().trim().min(3).max(200), cancelTickets: z.boolean().default(true), refund: z.boolean().default(false), refundMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).default('transferencia'), authCode: z.string().optional() }), await body(c))
  const auth = authorize(deps, u, d.authCode, 'cancel_discount', 'cierre temporal', { ownerOnly: true })
  const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(u.business_id) as { name: string }
  const result = db.transaction(() => {
    db.prepare('INSERT INTO slot_closures (id, business_id, date, start, reason, authorized_by, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), u.business_id, d.date, d.start ?? null, d.reason, auth.id, iso(now()))
    const affected = db.prepare(`SELECT id, code, buyer_name, phone, start, status FROM entry_tickets WHERE business_id = ? AND date = ? ${d.start ? 'AND start = ?' : ''} AND status IN ('por_pagar','pagado')`).all(...[u.business_id, d.date, ...(d.start ? [d.start] : [])]) as { id: string; code: string; buyer_name: string | null; phone: string | null; start: string }[]
    const refunded = d.cancelTickets ? cancelTickets(deps, u, affected.map((a) => a.id), `Cierre: ${d.reason}`, d.refund ? { method: d.refundMethod } : null, auth.id) : 0
    // Aviso manual: se prepara el mensaje por comprador.
    const byPhone = new Map<string, { name: string | null; phone: string; codes: string[] }>()
    for (const a of affected) if (a.phone) { const k = byPhone.get(a.phone) ?? { name: a.buyer_name, phone: a.phone, codes: [] }; k.codes.push(a.code); byPhone.set(a.phone, k) }
    const notices = [...byPhone.values()].map((p) => {
      const message = `Hola ${p.name ?? ''}, ${biz.name} estará cerrado el ${d.date}${d.start ? ` a las ${d.start}` : ''} por ${d.reason}. Tus boletos (${p.codes.length}) quedaron cancelados. Escríbenos para reprogramar o reembolsar.`
      return { phone: p.phone, message, whatsapp: `https://wa.me/52${p.phone}?text=${encodeURIComponent(message)}` }
    })
    return { affected: affected.length, refunded, notices }
  })()
  return c.json(result, 201)
})

// ---------- Reportes ----------

tourism.get('/reports/tickets', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const today = localDate(now())
  const from = c.req.query('from') ?? today
  const to = c.req.query('to') ?? today
  const q = (group: string) => db.prepare(`SELECT ${group} AS k, COUNT(*) AS tickets, SUM(price) AS amount, SUM(CASE WHEN status = 'usado' THEN 1 ELSE 0 END) AS visits FROM entry_tickets WHERE business_id = ? AND date BETWEEN ? AND ? AND status IN ('pagado','usado') GROUP BY ${group} ORDER BY k`).all(u.business_id, from, to)
  return c.json({ from, to, byDay: q('date'), bySlot: q('start'), byType: q('type_name'), byChannel: q('channel') })
})

/** Corte de la taquilla por tipo de boleto. */
tourism.get('/shifts/:id/tickets', requirePerm('open_close_cash'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const rows = db.prepare("SELECT t.type_name AS type, COUNT(*) AS tickets, SUM(t.price) AS amount FROM entry_tickets t JOIN sales s ON s.id = t.sale_id WHERE s.shift_id = ? AND s.business_id = ? AND t.status != 'cancelado' GROUP BY t.type_name").all(c.req.param('id'), u.business_id)
  return c.json({ byType: rows })
})

// ---------- Venta anticipada en línea (mismo tipo de link que las reservas) ----------

function publicBiz(c: C) {
  const { db } = c.get('deps')
  const b = db.prepare('SELECT id, name, phone, status FROM businesses WHERE code = ?').get((c.req.param('code') ?? '').toUpperCase()) as { id: string; name: string; phone: string | null; status: string } | undefined
  if (!b || !moduleOn(db, b.id, 'reservas') || ['vencido', 'suspendido'].includes(b.status)) throw notFound('Este link no está disponible.')
  return b
}

publicTourism.get('/public/tickets-shop/:code', (c) => {
  const { db, now } = c.get('deps')
  const b = publicBiz(c)
  const date = c.req.query('date') ?? localDate(now())
  const types = db.prepare("SELECT id, name, price FROM services WHERE business_id = ? AND active = 1 AND category = 'boleto' ORDER BY price DESC").all(b.id)
  const slots = slotsFor(db, b.id, date).filter((s) => !s.closed && localToIso(date, s.end) > iso(now())).map(({ start, end, available }) => ({ start, end, available }))
  return c.json({ business: { name: b.name, phone: b.phone }, date, types, slots })
})

publicTourism.post('/public/tickets-shop/:code', async (c) => {
  const { db, now } = c.get('deps')
  const b = publicBiz(c)
  const d = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), items: z.array(z.object({ serviceId: z.string(), quantity: z.number().int().min(1).max(20) })).min(1).max(10), name: z.string().trim().min(2).max(80), phone: z.string() }), await body(c))
  const phone = normalizePhone(d.phone)
  const pending = (db.prepare("SELECT COUNT(DISTINCT order_token) n FROM entry_tickets WHERE business_id = ? AND phone = ? AND status = 'por_pagar'").get(b.id, phone) as { n: number }).n
  if (pending >= 3) throw new AppError(429, 'demasiadas_compras', 'Ya tienes varias compras por pagar.')
  const token = randomBytes(16).toString('base64url')
  const codes = db.transaction(() => {
    const lines = prepareTickets(db, b.id, d.date, d.start, d.items, undefined, now())
    const codes = insertTickets(db, b.id, lines, { date: d.date, start: d.start, channel: 'en_linea', status: 'por_pagar', saleId: null, orderToken: token, buyer: d.name, phone, now: now() })
    audit(db, now, { businessId: b.id, userId: null, action: 'turistico.venta_en_linea', newValue: { tickets: codes.length, date: d.date, start: d.start } })
    return codes
  })()
  return c.json({ token, tickets: codes }, 201)
})

publicTourism.get('/public/tickets/:token', (c) => {
  const { db } = c.get('deps')
  const rows = db.prepare('SELECT t.code, t.type_name AS type, t.date, t.start, t.status, b.name AS business FROM entry_tickets t JOIN businesses b ON b.id = t.business_id WHERE t.order_token = ?').all(c.req.param('token')) as { business: string }[]
  if (!rows.length) throw notFound('No se encontró esa compra.')
  return c.json({ business: rows[0]!.business, tickets: rows.map(({ business: _, ...r }) => r) })
})

/** QR de entrada de cada boleto. */
publicTourism.get('/public/ticket-qr/:code', async (c) => {
  const code = (c.req.param('code') ?? '').replace(/\.svg$/, '').toUpperCase()
  if (!c.get('deps').db.prepare('SELECT 1 FROM entry_tickets WHERE code = ?').get(code)) throw notFound()
  return c.body(await QRCode.toString(code, { type: 'svg', margin: 2, width: 320 }), 200, { 'content-type': 'image/svg+xml' })
})
