import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, hasPerm, parse, requirePerm, type C, type Env } from './context.js'
import { bad, clampTime, conflict, forbidden, iso, localDate, newId, notFound } from './util.js'

export const cash = new Hono<Env>()

/** Validaciones de un giro antes del corte (p. ej. taquería: contar el sobrante del trompo). */
export const shiftCloseValidators: ((ctx: { db: import('./db.js').Db; shiftId: string }) => void)[] = []

export interface ShiftRow {
  id: string
  business_id: string
  branch_id: string
  cashier_id: string
  opening_float: number
  opened_at: string
  opened_date: string
  closed_at: string | null
  expected_cash: number | null
  counted_cash: number | null
  difference: number | null
  difference_reason: string | null
  status: 'abierto' | 'cerrado'
}

const money = z.number().int('Usa centavos enteros').min(0)

/** efectivo esperado = fondo inicial + ventas en efectivo − retiros + depósitos */
export function shiftTotals(db: import('./db.js').Db, shift: ShiftRow) {
  const sales = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status='completada' AND payment_method='efectivo' THEN total END),0) AS cashSales,
         COALESCE(SUM(CASE WHEN status='completada' AND payment_method='transferencia' THEN total END),0) AS transferSales,
         COALESCE(SUM(CASE WHEN status='completada' AND payment_method='tarjeta' THEN total END),0) AS cardSales,
         COALESCE(SUM(CASE WHEN status='completada' AND payment_method='fiado' THEN total END),0) AS creditSales,
         COALESCE(SUM(CASE WHEN status='cancelada' THEN 1 END),0) AS cancelled
       FROM sales WHERE shift_id = ?`,
    )
    .get(shift.id) as { cashSales: number; transferSales: number; cardSales: number; creditSales: number; cancelled: number }
  const mv = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type='retiro' THEN amount END),0) AS withdrawals,
              COALESCE(SUM(CASE WHEN type='deposito' THEN amount END),0) AS deposits
       FROM cash_movements WHERE shift_id = ?`,
    )
    .get(shift.id) as { withdrawals: number; deposits: number }
  // Propinas en efectivo: son de quien atendió, no del negocio, pero están físicamente en la caja.
  const tipsCash = (db.prepare("SELECT COALESCE(SUM(amount),0) t FROM tips WHERE shift_id = ? AND method = 'efectivo' AND status = 'vigente'").get(shift.id) as { t: number }).t
  const expectedCash = shift.opening_float + sales.cashSales - mv.withdrawals + mv.deposits + tipsCash
  return { openingFloat: shift.opening_float, ...sales, ...mv, tipsCash, expectedCash }
}

function loadShift(c: C): ShiftRow {
  const { db } = c.get('deps')
  const s = db.prepare('SELECT * FROM shifts WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as ShiftRow | undefined
  if (!s) throw notFound('No se encontró ese turno.')
  return s
}

/** Un cajero maneja su propio turno; con permiso de caja también el de otros del negocio. */
function ensureCanManage(c: C, s: ShiftRow) {
  const u = c.get('session').user
  if (s.cashier_id !== u.id && !(u.role === 'owner' || hasPerm(u, 'open_close_cash'))) throw forbidden()
}

cash.post('/shifts/open', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ id: z.string().uuid().optional(), at: z.string().datetime().optional(), openingFloat: money, /** Comedor: turno de comida (desayuno, comida, cena). */ meal: z.enum(['desayuno', 'comida', 'cena']).optional() }), await body(c))
  if (d.id) {
    const same = db.prepare('SELECT * FROM shifts WHERE id = ?').get(d.id) as ShiftRow | undefined
    if (same) {
      if (same.business_id !== u.business_id || same.cashier_id !== u.id) throw conflict('Ese identificador ya está en uso.', 'id_repetido')
      return c.json({ shift: same, duplicate: true })
    }
  }
  if (!u.branch_id) throw bad('Tu usuario no tiene sucursal asignada.')
  if (!db.prepare('SELECT 1 FROM branches WHERE id = ? AND active = 1').get(u.branch_id)) throw conflict('Tu sucursal está desactivada.', 'sucursal_inactiva')
  const open = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id)
  if (open) throw conflict('Ya tienes un turno abierto. Ciérralo antes de abrir otro.', 'turno_abierto')
  // Caja asignada al cajero: no puede tener dos turnos abiertos a la vez.
  if (u.register_id && db.prepare("SELECT 1 FROM shifts WHERE register_id = ? AND status = 'abierto'").get(u.register_id)) throw conflict('Tu caja ya tiene un turno abierto por otra persona.', 'caja_ocupada')
  const t = clampTime(d.at, now())
  const id = d.id ?? newId()
  db.prepare('INSERT INTO shifts (id, business_id, branch_id, cashier_id, opening_float, opened_at, opened_date, register_id, meal) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, u.business_id, u.branch_id, u.id, d.openingFloat, iso(t), localDate(t), u.register_id ?? null, d.meal ?? null,
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'caja.apertura', entity: 'shift', entityId: id, newValue: { openingFloat: d.openingFloat } })
  return c.json({ shift: db.prepare('SELECT * FROM shifts WHERE id = ?').get(id) }, 201)
})

cash.get('/shifts/current', (c) => {
  const { db } = c.get('deps')
  const s = db.prepare("SELECT * FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(c.get('session').user.id) as ShiftRow | undefined
  return c.json({ shift: s ?? null, totals: s ? shiftTotals(db, s) : null })
})

cash.post('/shifts/:id/movements', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const s = loadShift(c)
  ensureCanManage(c, s)
  if (s.status !== 'abierto') throw conflict('Ese turno ya está cerrado.', 'turno_cerrado')
  const d = parse(z.object({ id: z.string().uuid().optional(), at: z.string().datetime().optional(), type: z.enum(['retiro', 'deposito']), amount: money.min(1), reason: z.string().trim().min(2).max(200) }), await body(c))
  if (d.id) {
    const dup = db.prepare('SELECT id FROM cash_movements WHERE id = ? AND shift_id = ?').get(d.id, s.id)
    if (dup) return c.json({ id: d.id, totals: shiftTotals(db, s), duplicate: true })
  }
  if (d.type === 'retiro' && d.amount > shiftTotals(db, s).expectedCash) throw bad('El retiro es mayor al efectivo que debe haber en caja.')
  const id = d.id ?? newId()
  db.prepare('INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(id, s.id, d.type, d.amount, d.reason, u.id, iso(clampTime(d.at, now())))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: `caja.${d.type}`, entity: 'shift', entityId: s.id, newValue: { amount: d.amount }, reason: d.reason })
  return c.json({ id, totals: shiftTotals(db, s) }, 201)
})

cash.get('/shifts/:id', (c) => {
  const { db } = c.get('deps')
  const s = loadShift(c)
  ensureCanManage(c, s)
  return c.json({ shift: s, totals: shiftTotals(db, s) })
})

cash.post('/shifts/:id/close', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const s = loadShift(c)
  ensureCanManage(c, s)
  if (s.status !== 'abierto') throw conflict('Ese turno ya está cerrado.', 'turno_cerrado')
  for (const v of shiftCloseValidators) v({ db, shiftId: s.id })
  const d = parse(z.object({ at: z.string().datetime().optional(), countedCash: money, reason: z.string().trim().max(300).optional() }), await body(c))
  const totals = shiftTotals(db, s)
  const difference = d.countedCash - totals.expectedCash
  if (difference !== 0 && !d.reason) throw bad('Hay diferencia en el conteo. Escribe el motivo.', 'motivo_requerido')
  db.prepare(
    "UPDATE shifts SET status='cerrado', closed_at=?, closed_by=?, expected_cash=?, counted_cash=?, difference=?, difference_reason=? WHERE id=?",
  ).run(iso(clampTime(d.at, now())), u.id, totals.expectedCash, d.countedCash, difference, difference === 0 ? null : d.reason!, s.id)
  audit(db, now, {
    businessId: u.business_id, userId: u.id, action: 'caja.corte', entity: 'shift', entityId: s.id,
    newValue: { expected: totals.expectedCash, counted: d.countedCash, difference }, reason: d.reason ?? null,
  })
  return c.json({ shift: db.prepare('SELECT * FROM shifts WHERE id = ?').get(s.id), totals, difference })
})

// Cierre del día: consolida los turnos de una sucursal.
cash.post('/day-close', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), branchId: z.string().optional() }), await body(c))
  const branchId = d.branchId ?? u.branch_id
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(branchId, u.business_id)) throw bad('Sucursal no válida.')
  if (db.prepare('SELECT 1 FROM day_closes WHERE branch_id = ? AND date = ?').get(branchId, d.date)) throw conflict('Ese día ya está cerrado.', 'dia_cerrado')
  const shifts = db.prepare('SELECT * FROM shifts WHERE branch_id = ? AND opened_date = ?').all(branchId, d.date) as ShiftRow[]
  if (!shifts.length) throw bad('No hay turnos ese día.')
  if (shifts.some((s) => s.status === 'abierto')) throw conflict('Hay turnos abiertos. Ciérralos antes de cerrar el día.', 'turnos_abiertos')
  const summary = shifts.reduce(
    (a, s) => {
      const t = shiftTotals(db, s)
      a.openingFloat += t.openingFloat; a.cashSales += t.cashSales; a.transferSales += t.transferSales; a.cardSales += t.cardSales
      a.withdrawals += t.withdrawals; a.deposits += t.deposits; a.expectedCash += s.expected_cash ?? 0
      a.countedCash += s.counted_cash ?? 0; a.difference += s.difference ?? 0; a.cancelled += t.cancelled
      return a
    },
    { shifts: shifts.length, openingFloat: 0, cashSales: 0, transferSales: 0, cardSales: 0, withdrawals: 0, deposits: 0, expectedCash: 0, countedCash: 0, difference: 0, cancelled: 0 },
  )
  const id = newId()
  db.prepare('INSERT INTO day_closes (id, business_id, branch_id, date, summary, closed_by, closed_at) VALUES (?,?,?,?,?,?,?)').run(id, u.business_id, branchId, d.date, JSON.stringify(summary), u.id, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'caja.cierre_dia', entity: 'day_close', entityId: id, newValue: summary })
  return c.json({ id, date: d.date, summary }, 201)
})
