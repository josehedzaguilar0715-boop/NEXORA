import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { cashDifferenceNotice } from './notifications.js'
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
      // Por forma de pago (una venta mixta suma a varias).
      `SELECT
         COALESCE((SELECT SUM(p.amount) FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND s.status = 'completada' AND p.method = 'efectivo'),0) AS cashSales,
         COALESCE((SELECT SUM(p.amount) FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND s.status = 'completada' AND p.method = 'transferencia'),0) AS transferSales,
         COALESCE((SELECT SUM(p.amount) FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND s.status = 'completada' AND p.method = 'tarjeta'),0) AS cardSales,
         COALESCE((SELECT SUM(p.amount) FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? AND s.status = 'completada' AND p.method = 'fiado'),0) AS creditSales,
         (SELECT COUNT(*) FROM sales WHERE shift_id = ? AND status = 'cancelada') AS cancelled`,
    )
    .get(shift.id, shift.id, shift.id, shift.id, shift.id) as { cashSales: number; transferSales: number; cardSales: number; creditSales: number; cancelled: number }
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

// ---------- Corte X (parcial) y corte Z (final) ----------

const pesos = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Reporte del turno. X: lectura parcial con la caja abierta (se puede sacar las veces que sea).
 * Z: el corte final, con lo contado y la diferencia; lleva un número consecutivo por sucursal.
 */
export function shiftReport(db: import('./db.js').Db, s: ShiftRow, kind: 'X' | 'Z') {
  const t = shiftTotals(db, s)
  const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(s.business_id) as { name: string }
  const cashier = (db.prepare('SELECT name FROM users WHERE id = ?').get(s.cashier_id) as { name: string }).name
  const sales = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(discount + promo_discount),0) disc FROM sales WHERE shift_id = ? AND status = 'completada'").get(s.id) as { n: number; total: number; disc: number }
  // Ventas entregadas que ya se habían pagado con anticipos de apartado (el dinero entró antes).
  const prepaid = (db.prepare("SELECT COALESCE(SUM(p.amount),0) v FROM sale_payments p JOIN sales x ON x.id = p.sale_id WHERE x.shift_id = ? AND x.status = 'completada' AND p.method = 'anticipo'").get(s.id) as { v: number }).v
  const number = kind === 'Z'
    ? (db.prepare("SELECT COUNT(*) n FROM shifts WHERE branch_id = ? AND status = 'cerrado' AND closed_at <= ?").get(s.branch_id, s.closed_at ?? '9999') as { n: number }).n
    : (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'caja.corte_x' AND entity_id = ?").get(s.id) as { n: number }).n
  const fmt = (d: string) => new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short', hour12: true }).format(new Date(d))
  const W = 32
  const row = (l: string, r: string) => l.slice(0, W - r.length - 1).padEnd(W - r.length) + r
  const line = '='.repeat(W)
  const text = [
    biz.name,
    kind === 'X' ? `CORTE X #${number} (parcial)` : `CORTE Z #${number} (final)`,
    `Cajero: ${cashier}`,
    `Abrió: ${fmt(s.opened_at)}`,
    kind === 'Z' && s.closed_at ? `Cerró: ${fmt(s.closed_at)}` : `Hora: ${fmt(new Date().toISOString())}`,
    line,
    row(`Ventas (${sales.n})`, pesos(sales.total)),
    ...(sales.disc ? [row('  Descuentos dados', pesos(sales.disc))] : []),
    row('  Efectivo', pesos(t.cashSales)),
    row('  Tarjeta', pesos(t.cardSales)),
    row('  Transferencia', pesos(t.transferSales)),
    ...(t.creditSales ? [row('  Fiado', pesos(t.creditSales))] : []),
    ...(prepaid ? [row('  Pagado en apartados', pesos(prepaid))] : []),
    ...(t.cancelled ? [row('Ventas canceladas', String(t.cancelled))] : []),
    line,
    row('Fondo inicial', pesos(t.openingFloat)),
    row('Ventas en efectivo', pesos(t.cashSales)),
    row('Entradas (abonos y otros)', pesos(t.deposits)),
    row('Salidas (pagos y retiros)', pesos(t.withdrawals ? -t.withdrawals : 0)),
    ...(t.tipsCash ? [row('Propinas en efectivo', pesos(t.tipsCash))] : []),
    row('DEBE HABER EN CAJA', pesos(t.expectedCash)),
    ...(kind === 'Z' && s.counted_cash != null ? [row('Contado', pesos(s.counted_cash)), row('Diferencia', pesos(s.difference ?? 0)), ...(s.difference_reason ? [`Motivo: ${s.difference_reason}`] : [])] : []),
    line,
    kind === 'X' ? 'La caja sigue abierta.' : 'Turno cerrado.',
  ].join('\n')
  return { kind, number, totals: t, tickets: sales.n, salesTotal: sales.total, text }
}

/** Corte X: cómo va la caja, sin cerrarla. Queda en la bitácora. */
cash.post('/shifts/:id/x-report', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const s = loadShift(c)
  ensureCanManage(c, s)
  if (s.status !== 'abierto') throw conflict('Ese turno ya tiene corte Z.', 'turno_cerrado')
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'caja.corte_x', entity: 'shift', entityId: s.id, newValue: { expected: shiftTotals(db, s).expectedCash } })
  return c.json({ report: shiftReport(db, s, 'X') })
})

/** Volver a imprimir el corte Z de un turno cerrado. */
cash.get('/shifts/:id/z-report', requirePerm('open_close_cash'), (c) => {
  const { db } = c.get('deps')
  const s = loadShift(c)
  ensureCanManage(c, s)
  if (s.status !== 'cerrado') throw conflict('Ese turno sigue abierto: saca un corte X.', 'turno_abierto')
  return c.json({ report: shiftReport(db, s, 'Z') })
})

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
  db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at, origin) VALUES (?,?,?,?,?,?,?,'manual')").run(id, s.id, d.type, d.amount, d.reason, u.id, iso(clampTime(d.at, now())))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: `caja.${d.type}`, entity: 'shift', entityId: s.id, newValue: { amount: d.amount }, reason: d.reason })
  return c.json({ id, totals: shiftTotals(db, s) }, 201)
})

cash.get('/shifts/:id', (c) => {
  const { db } = c.get('deps')
  const s = loadShift(c)
  ensureCanManage(c, s)
  return c.json({ shift: s, totals: shiftTotals(db, s) })
})

/** Billetes y monedas de México, en centavos (para contar la caja por denominación). */
export const DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50] as const

/**
 * Arqueo: antes del corte (o cuando se quiera) se cuenta el efectivo y el sistema lo compara contra lo
 * registrado. No cierra la caja; queda en la bitácora con el conteo por billete y moneda.
 */
cash.post('/shifts/:id/verify', requirePerm('open_close_cash'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const s = loadShift(c)
  ensureCanManage(c, s)
  if (s.status !== 'abierto') throw conflict('Ese turno ya está cerrado.', 'turno_cerrado')
  const d = parse(z.object({
    countedCash: money.optional(),
    denominations: z.record(z.string(), z.number().int().min(0).max(100_000)).optional(),
  }), await body(c))
  let counted = d.countedCash
  if (d.denominations) {
    const bad_ = Object.keys(d.denominations).find((k) => !DENOMINATIONS.includes(Number(k) as (typeof DENOMINATIONS)[number]))
    if (bad_) throw bad(`Denominación no válida: ${bad_}.`)
    const sum = Object.entries(d.denominations).reduce((a, [k, n]) => a + Number(k) * n, 0)
    if (counted != null && counted !== sum) throw bad('El total no coincide con los billetes y monedas.')
    counted = sum
  }
  if (counted == null) throw bad('Cuenta el efectivo de la caja.')
  const totals = shiftTotals(db, s)
  const difference = counted - totals.expectedCash
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'caja.arqueo', entity: 'shift', entityId: s.id, newValue: { expected: totals.expectedCash, counted, difference, denominations: d.denominations ?? null } })
  return c.json({ counted, expectedCash: totals.expectedCash, difference, matches: difference === 0, totals })
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
  cashDifferenceNotice(c.get('deps'), u.business_id, u, difference, d.reason ?? null)
  const closed = db.prepare('SELECT * FROM shifts WHERE id = ?').get(s.id) as ShiftRow
  return c.json({ shift: closed, totals, difference, report: shiftReport(db, closed, 'Z') })
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
