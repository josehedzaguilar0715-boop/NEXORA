import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { audit } from './audit.js'
import { moduleOn } from './common.js'
import { body, hasPerm, ownerOnly, parse, requirePerm, type C, type Deps, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { createSale, parseSale } from './sales.js'
import { notify } from './notifications.js'
import { findPublicBusiness, publicName } from './publiclinks.js'
import { getSettings } from './settings.js'
import { AppError, bad, conflict, forbidden, iso, localDate, newId, normalizePhone, notFound } from './util.js'
import { scopeBranch } from './scope.js'

// Centro de México: UTC−6 fijo (sin horario de verano desde 2022).
const OFFSET = '-06:00'
export const localToIso = (date: string, hm: string) => new Date(`${date}T${hm}:00${OFFSET}`).toISOString()
const weekdayOf = (date: string) => new Date(`${date}T12:00:00${OFFSET}`).getUTCDay()
const hmOf = (isoStr: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoStr))
const addMin = (isoStr: string, m: number) => new Date(Date.parse(isoStr) + m * 60_000).toISOString()
const ACTIVE = "('pendiente','confirmada','en_atencion')"
const SLOT_MIN = 15

interface Svc { serviceId: string; name: string; price: number; duration: number }
interface ApptRow {
  id: string; business_id: string; branch_id: string; staff_id: string | null; customer_id: string | null; customer_name: string; phone: string | null; services: string
  starts_at: string; ends_at: string; status: string; source: string; public_token: string | null; at_home: number; address: string | null; travel_min: number; notes: string | null; sale_id: string | null; completed_at: string | null
}

/** Duración que ocupa un servicio en la agenda: su tiempo más lo que bloquea (p. ej. secado). Un combo sin duración propia suma la de sus servicios. */
function serviceDuration(db: Db, id: string): number {
  const s = db.prepare('SELECT duration_min, attrs FROM services WHERE id = ?').get(id) as { duration_min: number | null; attrs: string }
  const extra = Number((JSON.parse(s.attrs) as { extraBlockMin?: number }).extraBlockMin ?? 0)
  if (s.duration_min) return s.duration_min + extra
  const parts = db.prepare('SELECT service_id FROM service_combos WHERE combo_id = ?').all(id) as { service_id: string }[]
  return parts.reduce((a, p) => a + serviceDuration(db, p.service_id), 0) + extra
}

export function buildServices(db: Db, businessId: string, ids: string[]): { list: Svc[]; duration: number } {
  if (!ids.length) throw bad('Elige al menos un servicio.')
  const list = ids.map((id) => {
    const s = db.prepare('SELECT id, name, price FROM services WHERE id = ? AND business_id = ? AND active = 1').get(id, businessId) as { id: string; name: string; price: number } | undefined
    if (!s) throw bad('Uno de los servicios no existe.')
    return { serviceId: s.id, name: s.name, price: s.price, duration: serviceDuration(db, s.id) }
  })
  const duration = list.reduce((a, s) => a + s.duration, 0)
  if (duration <= 0) throw bad('Los servicios elegidos no tienen duración. Configúrala en el catálogo.')
  return { list, duration }
}

/** ¿Está libre esta persona en [start, end)? Respeta horario, días de descanso, bloqueos y otras citas (con su traslado). */
export function isFree(db: Db, staffId: string, start: string, end: string, excludeId?: string): { ok: boolean; why?: string } {
  const date = localDate(new Date(start))
  const fromHm = hmOf(start)
  const toHm = end <= localToIso(date, '23:59') ? hmOf(end) : '24:00'
  const windows = db.prepare('SELECT start, end FROM staff_schedules WHERE user_id = ? AND weekday = ?').all(staffId, weekdayOf(date)) as { start: string; end: string }[]
  if (!windows.some((w) => w.start <= fromHm && toHm <= w.end)) return { ok: false, why: windows.length ? 'fuera de su horario' : 'es su día de descanso' }
  if (db.prepare('SELECT 1 FROM agenda_blocks WHERE user_id = ? AND starts_at < ? AND ends_at > ?').get(staffId, end, start)) return { ok: false, why: 'tiene la agenda bloqueada' }
  const appts = db.prepare(`SELECT id, starts_at, ends_at, travel_min FROM appointments WHERE staff_id = ? AND status IN ${ACTIVE} AND id != ? AND starts_at < ? AND ends_at > ?`).all(staffId, excludeId ?? '', addMin(end, 24 * 60), addMin(start, -24 * 60)) as { starts_at: string; ends_at: string; travel_min: number }[]
  // El traslado a domicilio bloquea antes y después de la cita.
  if (appts.some((a) => addMin(a.starts_at, -a.travel_min) < end && addMin(a.ends_at, a.travel_min) > start)) return { ok: false, why: 'ya tiene otra cita a esa hora' }
  return { ok: true }
}

/** Nombre que ve el público: nombre e inicial; si quien atiende es el dueño, se muestra el nombre del negocio (nunca su nombre personal). */
function publicStaffName(db: Db, userId: string, fullName: string) {
  const u = db.prepare('SELECT u.role, b.name business FROM users u JOIN businesses b ON b.id = u.business_id WHERE u.id = ?').get(userId) as { role: string; business: string } | undefined
  return u?.role === 'owner' ? u.business : publicName(fullName)
}

export function agendaStaff(db: Db, businessId: string) {
  return db.prepare("SELECT id, name FROM users WHERE business_id = ? AND active = 1 AND in_agenda = 1 ORDER BY name").all(businessId) as { id: string; name: string }[]
}

/** Horarios libres de una persona en un día para una duración dada. */
export function freeSlots(db: Db, staffId: string, date: string, duration: number, travel: number, now: Date): string[] {
  const windows = db.prepare('SELECT start, end FROM staff_schedules WHERE user_id = ? AND weekday = ? ORDER BY start').all(staffId, weekdayOf(date)) as { start: string; end: string }[]
  const out: string[] = []
  for (const w of windows) {
    for (let t = localToIso(date, w.start); addMin(t, duration) <= localToIso(date, w.end); t = addMin(t, SLOT_MIN)) {
      if (t <= iso(now)) continue
      if (isFree(db, staffId, addMin(t, -travel), addMin(t, duration + travel)).ok) out.push(hmOf(t))
    }
  }
  return out
}

/** "El primero disponible": la persona libre a esa hora con menos citas ese día. */
function firstAvailable(db: Db, businessId: string, start: string, end: string): string | null {
  const date = localDate(new Date(start))
  const free = agendaStaff(db, businessId).filter((s) => isFree(db, s.id, start, end).ok)
  const load = (id: string) => (db.prepare(`SELECT COUNT(*) n FROM appointments WHERE staff_id = ? AND status IN ${ACTIVE} AND starts_at >= ? AND starts_at < ?`).get(id, localToIso(date, '00:00'), addMin(localToIso(date, '00:00'), 1440)) as { n: number }).n
  return free.sort((a, b) => load(a.id) - load(b.id))[0]?.id ?? null
}

const apptView = (db: Db, a: ApptRow, forBusiness = true) => ({
  id: a.id, staffId: forBusiness ? a.staff_id : undefined,
  // Al público solo se le muestra nombre e inicial de quien atiende.
  staffName: a.staff_id ? ((n: string) => (forBusiness ? n : publicStaffName(db, a.staff_id!, n)))((db.prepare('SELECT name FROM users WHERE id = ?').get(a.staff_id) as { name: string }).name) : null,
  customerName: a.customer_name, services: JSON.parse(a.services) as Svc[], startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, source: a.source,
  ...(forBusiness ? { customerId: a.customer_id, phone: a.phone, atHome: !!a.at_home, address: a.address, travelMin: a.travel_min, notes: a.notes, saleId: a.sale_id, completedAt: a.completed_at, toCharge: !!a.completed_at && !a.sale_id } : {}),
})

function createAppointment(deps: Deps, businessId: string, branchId: string, a: { staffId: string | 'any'; serviceIds: string[]; startsAt: string; customerId?: string | null; customerName: string; phone?: string | null; status: string; source: string; atHome?: boolean; address?: string | null; travelMin?: number; notes?: string | null; createdBy: string | null }) {
  const { db, now } = deps
  const { list, duration } = buildServices(db, businessId, a.serviceIds)
  const travel = a.atHome ? a.travelMin ?? 0 : 0
  const endsAt = addMin(a.startsAt, duration)
  let staffId = a.staffId
  if (staffId === 'any') {
    const s = firstAvailable(db, businessId, addMin(a.startsAt, -travel), addMin(endsAt, travel))
    if (!s) throw conflict('Nadie está libre a esa hora. Elige otra.', 'sin_disponibilidad')
    staffId = s
  } else {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ? AND in_agenda = 1 AND active = 1').get(staffId, businessId)) throw bad('Esa persona no atiende en la agenda.')
    const f = isFree(db, staffId, addMin(a.startsAt, -travel), addMin(endsAt, travel))
    if (!f.ok) throw conflict(`No se puede a esa hora: ${f.why}.`, 'horario_ocupado')
  }
  const id = newId()
  const token = a.source === 'link' ? randomBytes(16).toString('base64url') : null
  db.prepare(
    'INSERT INTO appointments (id, business_id, branch_id, staff_id, customer_id, customer_name, phone, services, starts_at, ends_at, status, source, public_token, at_home, address, travel_min, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(id, businessId, branchId, staffId, a.customerId ?? null, a.customerName, a.phone ?? null, JSON.stringify(list), a.startsAt, endsAt, a.status, a.source, token, a.atHome ? 1 : 0, a.address ?? null, travel, a.notes ?? null, a.createdBy, iso(now()))
  audit(db, now, { businessId, userId: a.createdBy, action: 'cita.alta', entity: 'appointment', entityId: id, newValue: { staffId, startsAt: a.startsAt, source: a.source } })
  return { row: db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as ApptRow, token }
}

export const agenda = new Hono<Env>()

// ---------- Personal en agenda: horarios, descansos y bloqueos ----------

agenda.get('/agenda/staff', (c) => {
  const { db } = c.get('deps')
  const br = scopeBranch(c)
  const staff = agendaStaff(db, c.get('session').user.business_id).filter((s) => !br || (db.prepare('SELECT branch_id FROM users WHERE id = ?').get(s.id) as { branch_id: string | null }).branch_id === br).map((s) => ({ ...s, schedule: db.prepare('SELECT weekday, start, end FROM staff_schedules WHERE user_id = ? ORDER BY weekday, start').all(s.id) }))
  return c.json({ staff })
})

/** Horario semanal (un día sin renglones es de descanso). */
agenda.put('/staff/:id/agenda', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const target = db.prepare('SELECT id FROM users WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string } | undefined
  if (!target) throw notFound()
  const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/)
  const d = parse(z.object({ inAgenda: z.boolean(), schedule: z.array(z.object({ weekday: z.number().int().min(0).max(6), start: hm, end: hm })).max(30) }), await body(c))
  for (const w of d.schedule) if (w.start >= w.end) throw bad('Cada horario debe terminar después de empezar.')
  db.transaction(() => {
    db.prepare('UPDATE users SET in_agenda = ? WHERE id = ?').run(d.inAgenda ? 1 : 0, target.id)
    db.prepare('DELETE FROM staff_schedules WHERE user_id = ?').run(target.id)
    for (const w of d.schedule) db.prepare('INSERT INTO staff_schedules (user_id, weekday, start, end) VALUES (?,?,?,?)').run(target.id, w.weekday, w.start, w.end)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'agenda.horario', entity: 'user', entityId: target.id, newValue: d })
  })()
  return c.json({ ok: true })
})

agenda.post('/staff/:id/blocks', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (u.id !== c.req.param('id') && u.role !== 'owner') throw forbidden('Solo el dueño o la misma persona bloquean su agenda.')
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id)) throw notFound()
  const d = parse(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().trim().min(2).max(200) }), await body(c))
  if (d.endsAt <= d.startsAt) throw bad('El bloqueo termina antes de empezar.')
  const clash = db.prepare(`SELECT COUNT(*) n FROM appointments WHERE staff_id = ? AND status IN ${ACTIVE} AND starts_at < ? AND ends_at > ?`).get(c.req.param('id'), d.endsAt, d.startsAt) as { n: number }
  const id = newId()
  db.prepare('INSERT INTO agenda_blocks (id, business_id, user_id, starts_at, ends_at, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, u.business_id, c.req.param('id'), d.startsAt, d.endsAt, d.reason, u.id, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'agenda.bloqueo', entity: 'user', entityId: c.req.param('id'), newValue: d })
  return c.json({ id, appointmentsInside: clash.n }, 201)
})

// ---------- Agenda del día ----------

agenda.get('/agenda', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const date = c.req.query('date') ?? localDate(now())
  const from = localToIso(date, '00:00')
  const to = addMin(from, 1440)
  const staffId = c.req.query('staffId')
  const br = scopeBranch(c) // la agenda de la sucursal (dueño: todas)
  const rows = db.prepare(`SELECT * FROM appointments WHERE business_id = ? AND starts_at >= ? AND starts_at < ? ${staffId ? 'AND staff_id = ?' : ''} ${br ? 'AND branch_id = ?' : ''} ORDER BY starts_at`).all(...[u.business_id, from, to, ...(staffId ? [staffId] : []), ...(br ? [br] : [])]) as ApptRow[]
  const blocks = db.prepare(`SELECT b.id, b.user_id AS staffId, b.starts_at AS startsAt, b.ends_at AS endsAt, b.reason FROM agenda_blocks b WHERE b.business_id = ? AND b.starts_at < ? AND b.ends_at > ? ${staffId ? 'AND b.user_id = ?' : ''} ${br ? 'AND b.user_id IN (SELECT id FROM users WHERE branch_id = ?)' : ''}`).all(...[u.business_id, to, from, ...(staffId ? [staffId] : []), ...(br ? [br] : [])])
  // Horario de cada persona ese día de la semana (para ver sus horas libres).
  const weekday = new Date(`${date}T12:00:00-06:00`).getUTCDay()
  const hours = db.prepare(`SELECT s.user_id AS staffId, s.start, s.end FROM staff_schedules s JOIN users u ON u.id = s.user_id WHERE u.business_id = ? AND u.active = 1 AND u.in_agenda = 1 AND s.weekday = ? ${br ? 'AND u.branch_id = ?' : ''} ORDER BY s.start`).all(u.business_id, weekday, ...(br ? [br] : []))
  return c.json({ date, appointments: rows.map((a) => apptView(db, a)), blocks, hours })
})

agenda.get('/agenda/availability', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  return c.json(availability(db, u.business_id, c.req.query('date') ?? localDate(now()), (c.req.query('serviceIds') ?? '').split(',').filter(Boolean), c.req.query('staffId') ?? 'any', Number(c.req.query('travelMin') ?? 0), now()))
})

function availability(db: Db, businessId: string, date: string, serviceIds: string[], staffId: string, travel: number, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Fecha no válida.')
  const { duration } = buildServices(db, businessId, serviceIds)
  const staff = staffId === 'any' ? agendaStaff(db, businessId) : agendaStaff(db, businessId).filter((s) => s.id === staffId)
  const per = staff.map((s) => ({ staffId: s.id, name: s.name, slots: freeSlots(db, s.id, date, duration, travel, now) }))
  const any = [...new Set(per.flatMap((p) => p.slots))].sort()
  return { date, duration, staff: per, slots: staffId === 'any' ? any : per[0]?.slots ?? [] }
}

/** En mostrador (confirmada) o cliente sin cita (atención inmediata, en la misma agenda). */
agenda.post('/appointments', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(
    z.object({
      staffId: z.string(), serviceIds: z.array(z.string()).min(1).max(10), startsAt: z.string().datetime().optional(), walkIn: z.boolean().optional(),
      customerId: z.string().optional(), customerName: z.string().trim().min(2).max(100).optional(), phone: z.string().trim().max(20).optional(),
      atHome: z.boolean().optional(), address: z.string().trim().max(300).optional(), travelMin: z.number().int().min(0).max(240).optional(), notes: z.string().max(1000).optional(),
    }),
    await body(c),
  )
  if (!u.branch_id) throw bad('Tu usuario no tiene sucursal.')
  const cust = d.customerId ? (db.prepare('SELECT id, name, phone FROM customers WHERE id = ? AND business_id = ?').get(d.customerId, u.business_id) as { id: string; name: string; phone: string | null } | undefined) : undefined
  if (d.customerId && !cust) throw bad('Ese cliente no existe.')
  const name = d.customerName ?? cust?.name
  // Si la clienta pidió que todos sus servicios sean a domicilio, se aplica solo.
  if (d.atHome === undefined && cust && (db.prepare('SELECT home_all FROM customers WHERE id = ?').get(cust.id) as { home_all: number }).home_all) d.atHome = true
  if (!name) throw bad('Indica el nombre del cliente.')
  // A domicilio: la dirección se guarda por cliente y solo la ve el negocio.
  const address = d.atHome ? d.address ?? (cust ? (db.prepare('SELECT address FROM customers WHERE id = ?').get(cust.id) as { address: string | null } | undefined)?.address ?? null : null) : null
  if (d.atHome && !address) throw bad('Para servicio a domicilio indica la dirección.')
  if (d.atHome && cust && d.address) db.prepare('UPDATE customers SET address = ? WHERE id = ?').run(d.address, cust.id)
  if (!d.walkIn && !d.startsAt) throw bad('Indica la hora de la cita.')
  const startsAt = d.walkIn ? iso(now()) : d.startsAt!
  if (!d.walkIn && startsAt < iso(now())) throw bad('Esa hora ya pasó.')
  const { row } = createAppointment(deps, u.business_id, u.branch_id, {
    staffId: d.staffId, serviceIds: d.serviceIds, startsAt, customerId: cust?.id, customerName: name, phone: d.phone ?? cust?.phone, status: d.walkIn ? 'en_atencion' : 'confirmada',
    source: d.walkIn ? 'sin_cita' : 'mostrador', atHome: d.atHome, address, travelMin: d.travelMin, notes: d.notes, createdBy: u.id,
  })
  return c.json({ appointment: apptView(db, row) }, 201)
})

function loadAppt(c: C): ApptRow {
  const a = c.get('deps').db.prepare('SELECT * FROM appointments WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as ApptRow | undefined
  if (!a) throw notFound('No se encontró esa cita.')
  return a
}
/** Recepción (con permiso de vender) o quien atiende la cita. */
const canHandle = (u: UserRow, a: ApptRow) => hasPerm(u, 'sell') || a.staff_id === u.id

function transition(c: C, from: string[], to: string, action: string, extra?: (a: ApptRow) => void) {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const a = loadAppt(c)
  if (!canHandle(u, a)) throw forbidden()
  if (!from.includes(a.status)) throw conflict(`La cita está ${a.status}.`, 'estado_invalido')
  extra?.(a)
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(to, a.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action, entity: 'appointment', entityId: a.id, oldValue: { status: a.status }, newValue: { status: to } })
  return c.json({ appointment: apptView(db, { ...a, status: to }) })
}

agenda.post('/appointments/:id/confirm', (c) => transition(c, ['pendiente'], 'confirmada', 'cita.confirmada'))
agenda.post('/appointments/:id/start', (c) => transition(c, ['pendiente', 'confirmada'], 'en_atencion', 'cita.inicio'))
/** Terminar la atención: la cita queda «por cobrar» y aparece en Caja. No toca dinero ni crea la venta. */
agenda.post('/appointments/:id/complete', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const a = loadAppt(c)
  if (!canHandle(u, a)) throw forbidden()
  if (a.completed_at) throw conflict('Esa cita ya está terminada y por cobrar.', 'ya_terminada')
  if (!['pendiente', 'confirmada', 'en_atencion'].includes(a.status)) throw conflict(`La cita está ${a.status}.`, 'estado_invalido')
  const t = iso(now())
  db.prepare("UPDATE appointments SET status = 'en_atencion', completed_at = ? WHERE id = ?").run(t, a.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cita.terminada', entity: 'appointment', entityId: a.id, oldValue: { status: a.status }, newValue: { status: 'en_atencion', porCobrar: true } })
  return c.json({ appointment: apptView(db, { ...a, status: 'en_atencion', completed_at: t }) })
})

/** Citas terminadas que Caja todavía no cobra (de la sucursal de quien consulta). Trae el total para cobrar. */
agenda.get('/agenda/to-charge', requirePerm('sell'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const br = scopeBranch(c)
  const rows = db.prepare(`SELECT * FROM appointments WHERE business_id = ? AND completed_at IS NOT NULL AND sale_id IS NULL AND status IN ${ACTIVE} ${br ? 'AND branch_id = ?' : ''} ORDER BY completed_at`).all(...(br ? [u.business_id, br] : [u.business_id])) as ApptRow[]
  return c.json({ appointments: rows.map((a) => { const v = apptView(db, a); return { ...v, total: v.services.reduce((x, sv) => x + sv.price, 0) } }) })
})

agenda.post('/appointments/:id/no-show', (c) => transition(c, ['pendiente', 'confirmada'], 'no_asistio', 'cita.no_asistio'))
agenda.post('/appointments/:id/cancel', async (c) => {
  const d = parse(z.object({ reason: z.string().trim().min(2).max(200) }), await body(c))
  return transition(c, ['pendiente', 'confirmada', 'en_atencion'], 'cancelada', 'cita.cancelada', (a) => void c.get('deps').db.prepare('UPDATE appointments SET cancel_reason = ? WHERE id = ?').run(d.reason, a.id))
})

agenda.post('/appointments/:id/reschedule', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const a = loadAppt(c)
  if (!canHandle(u, a)) throw forbidden()
  if (!['pendiente', 'confirmada'].includes(a.status)) throw conflict(`La cita está ${a.status}.`, 'estado_invalido')
  const d = parse(z.object({ startsAt: z.string().datetime(), staffId: z.string().optional() }), await body(c))
  const staff = d.staffId ?? a.staff_id!
  // Solo personal de este mismo negocio.
  if (d.staffId && !db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ? AND active = 1').get(d.staffId, u.business_id)) throw bad('Esa persona no es de este negocio.')
  const dur = (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000
  const end = addMin(d.startsAt, dur)
  const f = isFree(db, staff, addMin(d.startsAt, -a.travel_min), addMin(end, a.travel_min), a.id)
  if (!f.ok) throw conflict(`No se puede a esa hora: ${f.why}.`, 'horario_ocupado')
  db.prepare('UPDATE appointments SET starts_at = ?, ends_at = ?, staff_id = ? WHERE id = ?').run(d.startsAt, end, staff, a.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cita.cambio_hora', entity: 'appointment', entityId: a.id, oldValue: { startsAt: a.starts_at, staffId: a.staff_id }, newValue: { startsAt: d.startsAt, staffId: staff } })
  return c.json({ appointment: apptView(db, db.prepare('SELECT * FROM appointments WHERE id = ?').get(a.id) as ApptRow) })
})

/** Cobrar la cita: servicios (con quien atendió), productos en la misma cuenta, propinas y descuentos. */
agenda.post('/appointments/:id/checkout', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const a = loadAppt(c)
  if (!['confirmada', 'en_atencion', 'pendiente'].includes(a.status)) throw conflict(`La cita está ${a.status}.`, 'estado_invalido')
  const raw = (await body(c)) as Record<string, unknown>
  const extra = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : []
  const svc = (JSON.parse(a.services) as Svc[]).map((s) => ({ serviceId: s.serviceId, quantity: 1, unitPrice: s.price, staffId: a.staff_id ?? undefined }))
  // Cargo por traslado a domicilio: opcional (apagado por defecto) y fuera de la comisión.
  const fee = a.at_home ? getSettings(db, u.business_id).travelFee : null
  const travel = fee ? [{ description: 'Cargo por traslado', quantity: 1, unitPrice: fee, noCommission: true }] : []
  const input = parseSale({ ...raw, id: (raw.id as string) ?? newId(), customerId: a.customer_id ?? raw.customerId, items: [...svc, ...extra.map((i) => ({ staffId: a.staff_id ?? undefined, ...i })), ...travel] })
  const result = db.transaction(() => {
    // Los servicios se cobran al precio con que se agendaron.
    const r = createSale(deps, u, input, { trustedPrices: !extra.some((i) => i.unitPrice !== undefined) })
    db.prepare("UPDATE appointments SET status = 'atendida', sale_id = ? WHERE id = ?").run(r.sale.id, a.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'cita.cobrada', entity: 'appointment', entityId: a.id, newValue: { saleId: r.sale.id } })
    return r
  })()
  return c.json(result, 201)
})

// ---------- Reserva pública por link ----------

export const publicAgenda = new Hono<Env>()

function publicBusiness(c: C) {
  const { db } = c.get('deps')
  const b = findPublicBusiness(db, c.req.param('code') ?? '')
  if (!b || !moduleOn(db, b.id, 'reservas') || b.status === 'vencido' || b.status === 'suspendido') throw notFound('Este link de reservas no está disponible.')
  return b
}

publicAgenda.get('/public/book/:code', (c) => {
  const { db } = c.get('deps')
  const b = publicBusiness(c)
  const services = (db.prepare('SELECT id, name, price, category FROM services WHERE business_id = ? AND active = 1 ORDER BY category, name').all(b.id) as { id: string }[]).map((s) => ({ ...s, duration: serviceDuration(db, s.id) })).filter((s) => s.duration > 0)
  const staff = agendaStaff(db, b.id)
  // Horario del negocio: el más amplio de quienes atienden, por día de la semana.
  const rows = db.prepare(`SELECT weekday, MIN(start) start, MAX(end) end FROM staff_schedules WHERE user_id IN (${staff.map(() => '?').join(',') || "''"}) GROUP BY weekday ORDER BY weekday`).all(...staff.map((x) => x.id)) as { weekday: number; start: string; end: string }[]
  const logo = (db.prepare('SELECT logo_url FROM businesses WHERE id = ?').get(b.id) as { logo_url: string | null }).logo_url
  // Solo identidad del negocio, servicios, horario y nombre público de quien atiende: nada interno ni personal.
  return c.json({ business: { name: b.name, phone: b.phone, giro: b.giro, logoUrl: logo }, hours: rows, services, staff: staff.map((s) => ({ id: s.id, name: publicStaffName(db, s.id, s.name) })) })
})

publicAgenda.get('/public/book/:code/availability', (c) => {
  const { db, now } = c.get('deps')
  const b = publicBusiness(c)
  const r = availability(db, b.id, c.req.query('date') ?? localDate(now()), (c.req.query('serviceIds') ?? '').split(',').filter(Boolean), c.req.query('staffId') ?? 'any', 0, now())
  // Solo horas libres; no se exponen las agendas de cada quien con "el primero disponible".
  return c.json({ date: r.date, duration: r.duration, slots: r.slots })
})

publicAgenda.post('/public/book/:code', async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const b = publicBusiness(c)
  const d = parse(z.object({ serviceIds: z.array(z.string()).min(1).max(5), staffId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), name: z.string().trim().min(2).max(80), phone: z.string() }), await body(c))
  const phone = normalizePhone(d.phone)
  const open = (db.prepare(`SELECT COUNT(*) n FROM appointments WHERE business_id = ? AND phone = ? AND status = 'pendiente'`).get(b.id, phone) as { n: number }).n
  if (open >= 3) throw new AppError(429, 'demasiadas_reservas', 'Ya tienes varias reservas pendientes. Espera a que te confirmen.')
  const startsAt = localToIso(d.date, d.time)
  if (startsAt <= iso(now())) throw bad('Esa hora ya pasó.')
  const branch = db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1 ORDER BY created_at LIMIT 1').get(b.id) as { id: string }
  // Solo horas libres: se vuelve a validar al guardar.
  const { row, token } = createAppointment(deps, b.id, branch.id, { staffId: d.staffId, serviceIds: d.serviceIds, startsAt, customerName: d.name, phone, status: 'pendiente', source: 'link', createdBy: null })
  const when = new Date(startsAt).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })
  notify(deps, b.id, { kind: 'cita', title: `Nueva cita por confirmar · ${d.name}`, body: when, link: '#/agenda', audience: ['owner', `user:${(row as { staff_id: string }).staff_id}`] })
  return c.json({ token, appointment: apptView(db, row, false) }, 201)
})

/** El cliente ve el estado de su reserva en el mismo link. */
publicAgenda.get('/public/appointments/:token', (c) => {
  const { db } = c.get('deps')
  const a = db.prepare('SELECT * FROM appointments WHERE public_token = ?').get(c.req.param('token')) as ApptRow | undefined
  if (!a) throw notFound('No se encontró esa reserva.')
  const biz = db.prepare('SELECT name, phone, giro FROM businesses WHERE id = ?').get(a.business_id)
  return c.json({ business: biz, appointment: apptView(db, a, false) })
})

publicAgenda.post('/public/appointments/:token/cancel', (c) => {
  const { db, now } = c.get('deps')
  const a = db.prepare('SELECT * FROM appointments WHERE public_token = ?').get(c.req.param('token')) as ApptRow | undefined
  if (!a) throw notFound('No se encontró esa reserva.')
  if (!['pendiente', 'confirmada'].includes(a.status)) throw conflict(`La reserva está ${a.status}.`)
  db.prepare("UPDATE appointments SET status = 'cancelada', cancel_reason = 'Cancelada por el cliente' WHERE id = ?").run(a.id)
  audit(db, now, { businessId: a.business_id, userId: null, action: 'cita.cancelada_cliente', entity: 'appointment', entityId: a.id })
  return c.json({ ok: true })
})

// ---------- Recordatorio de retoque (opcional, apagado por defecto) ----------

/**
 * Lista de clientes a quienes ya les toca retoque según `attrs.retouchDays` del servicio.
 * Nada se envía solo: se prepara el mensaje para mandarlo a mano.
 */
agenda.get('/reminders/retouch', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (!moduleOn(db, u.business_id, 'recordatorios')) throw new AppError(409, 'modulo_inactivo', 'Los recordatorios están apagados.')
  const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(u.business_id) as { name: string }
  const svcs = (db.prepare('SELECT id, name, attrs FROM services WHERE business_id = ? AND active = 1').all(u.business_id) as { id: string; name: string; attrs: string }[])
    .map((s) => ({ ...s, days: Number((JSON.parse(s.attrs) as { retouchDays?: number }).retouchDays ?? 0) }))
    .filter((s) => s.days > 0)
  const br = scopeBranch(c)
  const appts = db.prepare(`SELECT * FROM appointments WHERE business_id = ? AND status = 'atendida' ${br ? 'AND branch_id = ?' : ''} ORDER BY starts_at DESC`).all(u.business_id, ...(br ? [br] : [])) as ApptRow[]
  const out: { customerName: string; phone: string | null; service: string; lastVisit: string; dueSince: string; message: string; whatsapp: string | null }[] = []
  const seen = new Set<string>()
  for (const a of appts) {
    const who = a.customer_id ?? a.phone ?? a.customer_name
    for (const s of (JSON.parse(a.services) as Svc[])) {
      const rule = svcs.find((x) => x.id === s.serviceId)
      const key = `${who}|${s.serviceId}`
      if (!rule || seen.has(key)) continue
      seen.add(key) // solo la visita más reciente cuenta
      const due = addMin(a.starts_at, rule.days * 1440)
      if (due > iso(now())) continue
      const upcoming = db.prepare(`SELECT 1 FROM appointments WHERE business_id = ? AND status IN ${ACTIVE} AND starts_at > ? AND (customer_id = ? OR phone = ?)`).get(u.business_id, iso(now()), a.customer_id, a.phone)
      if (upcoming) continue
      const message = `Hola ${a.customer_name}, en ${biz.name} te recordamos que ya te toca tu retoque de ${s.name}. ¿Te agendamos?`
      out.push({ customerName: a.customer_name, phone: a.phone, service: s.name, lastVisit: a.starts_at, dueSince: due, message, whatsapp: a.phone ? `https://wa.me/52${a.phone}?text=${encodeURIComponent(message)}` : null })
    }
  }
  return c.json({ reminders: out })
})
