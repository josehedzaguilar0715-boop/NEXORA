import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { loadCustomer } from './common.js'
import { body, ownerOnly, parse, requirePerm, type Env, requireFinance, canFinance } from './context.js'
import type { Db } from './db.js'
import { fromMilli, stockOf, type ProductRow } from './inventory.js'
import { customerBalance } from './sales.js'
import { bad, conflict, iso, localDate, newId, notFound } from './util.js'
import { scopeBranch, scopeOwn, wholeBusinessOnly } from './scope.js'
import { assertCashAvailable } from './cash.js'

export const finance = new Hono<Env>()

/** Categorías de gasto (estado de resultados). */
export const EXPENSE_CATEGORIES = ['renta', 'servicios', 'nomina', 'insumos', 'transporte', 'mantenimiento', 'publicidad', 'impuestos', 'comisiones_bancarias', 'otros'] as const

// ---------- Fiado: límite, abonos y estado de cuenta ----------

finance.put('/customers/:id/credit-limit', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const cu = loadCustomer(c)
  const d = parse(z.object({ limit: z.number().int().min(0) }), await body(c))
  const old = (db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(cu.id) as { credit_limit: number }).credit_limit
  db.prepare('UPDATE customers SET credit_limit = ? WHERE id = ?').run(d.limit, cu.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fiado.limite', entity: 'customer', entityId: cu.id, oldValue: { limit: old }, newValue: { limit: d.limit } })
  return c.json({ ok: true })
})

finance.get('/customers/:id/credit', requirePerm('customers_credit'), (c) => {
  const { db } = c.get('deps')
  const cu = loadCustomer(c)
  const limit = (db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(cu.id) as { credit_limit: number }).credit_limit
  const ledger = db.prepare('SELECT l.id, l.delta, l.kind, l.method, l.sale_id AS saleId, l.note, l.reverses_id AS reversesId, l.created_by AS createdBy, COALESCE((SELECT branch_id FROM shifts WHERE id = l.shift_id), (SELECT branch_id FROM sales WHERE id = l.sale_id)) AS branchId, l.created_at AS createdAt, EXISTS (SELECT 1 FROM credit_ledger r WHERE r.reverses_id = l.id) AS voided FROM credit_ledger l WHERE l.customer_id = ? ORDER BY l.created_at DESC, l.rowid DESC LIMIT 500').all(cu.id)
  const balance = customerBalance(db, cu.id)
  return c.json({ balance, limit, available: Math.max(0, limit - balance), ledger })
})

finance.post('/customers/:id/credit-payments', requirePerm('customers_credit'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const cu = loadCustomer(c)
  const d = parse(z.object({ id: z.string().uuid().optional(), amount: z.number().int().min(1), method: z.enum(['efectivo', 'transferencia', 'tarjeta']), note: z.string().max(200).optional() }), await body(c))
  if (d.id && db.prepare('SELECT 1 FROM credit_ledger WHERE id = ?').get(d.id)) return c.json({ duplicate: true, balance: customerBalance(db, cu.id) })
  const bal = customerBalance(db, cu.id)
  if (d.amount > bal) throw bad(`El saldo es ${bal}; el abono no puede ser mayor.`)
  const shift = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined
  if (d.method === 'efectivo' && !shift) throw conflict('Abre tu caja para recibir un abono en efectivo.', 'caja_cerrada')
  db.transaction(() => {
    db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, method, shift_id, note, created_by, created_at) VALUES (?,?,?,?,'abono',?,?,?,?,?)").run(
      d.id ?? newId(), u.business_id, cu.id, -d.amount, d.method, shift?.id ?? null, d.note ?? null, u.id, iso(now()),
    )
    // El abono en efectivo entra a la caja como depósito, así cuadra el corte.
    if (d.method === 'efectivo') db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'deposito',?,?,?,?)").run(newId(), shift!.id, d.amount, `Abono de ${cu.name}`, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fiado.abono', entity: 'customer', entityId: cu.id, newValue: { amount: d.amount, method: d.method } })
  })()
  return c.json({ balance: customerBalance(db, cu.id) }, 201)
})

/**
 * Anular un abono capturado por error: movimiento contrario que apunta al original (nada se borra).
 * Si fue en efectivo, el dinero sale de la caja donde entró; por eso solo mientras ese turno siga abierto.
 */
finance.post('/credit-ledger/:id/void', requirePerm('customers_credit'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const l = db.prepare('SELECT l.*, c.name FROM credit_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.id = ? AND l.business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; customer_id: string; name: string; delta: number; kind: string; method: string | null; shift_id: string | null } | undefined
  if (!l) throw notFound()
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Escribe el motivo').max(200), authCode: z.string().optional() }), await body(c))
  if (l.kind !== 'abono' || !l.method) throw bad('Solo se puede anular un abono recibido (con forma de pago).')
  if (db.prepare('SELECT 1 FROM credit_ledger WHERE reverses_id = ?').get(l.id)) throw conflict('Ese abono ya estaba anulado.', 'ya_anulado')
  const amount = -l.delta
  const shift = l.method === 'efectivo' && l.shift_id ? (db.prepare('SELECT id, status FROM shifts WHERE id = ?').get(l.shift_id) as { id: string; status: string }) : null
  if (l.method === 'efectivo' && shift?.status !== 'abierto') throw conflict('Ese abono entró a una caja que ya tiene corte; no se puede anular.', 'turno_cerrado')
  const auth = u.role === 'owner' ? null : authorize(deps, u, d.authCode, 'customers_credit', 'anular abono', { ownerOnly: true })
  db.transaction(() => {
    if (shift) assertCashAvailable(db, shift.id, amount, 'anular este abono')
    db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, method, shift_id, note, reverses_id, created_by, created_at) VALUES (?,?,?,?,'cancelacion',?,?,?,?,?,?)").run(
      newId(), u.business_id, l.customer_id, amount, l.method, l.shift_id, `Abono anulado: ${d.reason}`, l.id, u.id, iso(now()))
    if (shift) db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift.id, amount, `Abono anulado de ${l.name}`, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fiado.abono_anulado', entity: 'customer', entityId: l.customer_id, oldValue: { amount, method: l.method }, reason: d.reason, ...(auth ? { authorizedBy: auth.id } : {}) })
  })()
  return c.json({ balance: customerBalance(db, l.customer_id) })
})

/**
 * Deuda anterior: lo que el cliente ya debía antes de usar NEXORA (o un cargo que no pasó por la caja), con motivo.
 * No es una venta (no cuenta como ingreso ni sale del inventario). El dueño directo; los demás con el código del dueño.
 */
finance.post('/customers/:id/credit-charges', requirePerm('customers_credit'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const cu = loadCustomer(c)
  const d = parse(z.object({ id: z.string().uuid().optional(), amount: z.number().int().min(1).max(100_000_000), note: z.string().trim().min(3, 'Escribe el motivo').max(200), authCode: z.string().optional() }), await body(c))
  if (d.id && db.prepare('SELECT 1 FROM credit_ledger WHERE id = ?').get(d.id)) return c.json({ duplicate: true, balance: customerBalance(db, cu.id) })
  const auth = u.role === 'owner' ? null : authorize(deps, u, d.authCode, 'customers_credit', 'cargar deuda anterior', { ownerOnly: true })
  db.transaction(() => {
    db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, note, created_by, created_at) VALUES (?,?,?,?,'cargo',?,?,?)").run(d.id ?? newId(), u.business_id, cu.id, d.amount, d.note, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'fiado.deuda_anterior', entity: 'customer', entityId: cu.id, newValue: { amount: d.amount }, reason: d.note, ...(auth ? { authorizedBy: auth.id } : {}) })
  })()
  return c.json({ balance: customerBalance(db, cu.id) }, 201)
})

/** Estado de cuenta de un periodo (p. ej. la semana de una fonda): saldo inicial, cargos, abonos y saldo final. */
finance.get('/customers/:id/statement', requirePerm('customers_credit'), (c) => {
  const { db, now } = c.get('deps')
  const cu = loadCustomer(c)
  const today = localDate(now())
  const to = c.req.query('to') ?? today
  const from = c.req.query('from') ?? localDate(new Date(Date.parse(`${to}T12:00:00-06:00`) - 6 * 86_400_000))
  const start = new Date(`${from}T06:00:00.000Z`).toISOString()
  const end = new Date(new Date(`${to}T06:00:00.000Z`).getTime() + 86_400_000).toISOString()
  const opening = (db.prepare('SELECT COALESCE(SUM(delta),0) b FROM credit_ledger WHERE customer_id = ? AND created_at < ?').get(cu.id, start) as { b: number }).b
  const moves = db.prepare('SELECT delta, kind, method, sale_id AS saleId, created_at AS createdAt FROM credit_ledger WHERE customer_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at').all(cu.id, start, end) as { delta: number }[]
  const charges = moves.filter((m) => m.delta > 0).reduce((a, m) => a + m.delta, 0)
  const payments = -moves.filter((m) => m.delta < 0).reduce((a, m) => a + m.delta, 0)
  const limit = (db.prepare('SELECT credit_limit FROM customers WHERE id = ?').get(cu.id) as { credit_limit: number }).credit_limit
  return c.json({ customer: cu.name, from, to, opening, charges, payments, closing: opening + charges - payments, limit, moves })
})

finance.get('/receivables', requirePerm('customers_credit'), (c) => {
  const rows = c.get('deps').db
    .prepare('SELECT c.id, c.name, c.phone, c.credit_limit AS creditLimit, SUM(l.delta) AS balance FROM credit_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? GROUP BY c.id HAVING balance > 0 ORDER BY balance DESC')
    .all(c.get('session').user.business_id) as { balance: number }[]
  // El total de lo que le deben al negocio es información financiera: el empleado ve a sus clientes, no la suma.
  return c.json({ customers: rows, ...(canFinance(c.get('session').user, 'dashboard') ? { total: rows.reduce((a, r) => a + r.balance, 0) } : {}) })
})

/** Historial de compras de un cliente frecuente. */
finance.get('/customers/:id/sales', requirePerm('customers_credit'), (c) => {
  const cu = loadCustomer(c)
  // El cliente es del negocio, pero sus compras son de cada sucursal (y de quien las cobró).
  const branch = scopeBranch(c)
  const own = scopeOwn(c)
  const rows = c.get('deps').db.prepare(`SELECT id, folio, total, payment_method AS paymentMethod, status, created_at AS createdAt FROM sales WHERE customer_id = ? ${branch ? 'AND branch_id = ?' : ''} ${own ? 'AND cashier_id = ?' : ''} ORDER BY created_at DESC LIMIT 200`).all(cu.id, ...(branch ? [branch] : []), ...(own ? [own] : []))
  return c.json({ sales: rows })
})

// ---------- Gastos ----------

finance.post('/expenses', requirePerm('edit_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(
    z.object({ id: z.string().uuid().optional(), concept: z.string().trim().min(2).max(100), amount: z.number().int().min(1), kind: z.enum(['fijo', 'variable']), category: z.enum(EXPENSE_CATEGORIES).optional(), method: z.enum(['efectivo', 'transferencia', 'tarjeta']), fromCash: z.boolean().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), branchId: z.string().optional() }),
    await body(c),
  )
  if (d.id && db.prepare('SELECT 1 FROM expenses WHERE id = ?').get(d.id)) return c.json({ id: d.id, duplicate: true })
  const branchId = d.branchId ?? u.branch_id
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(branchId, u.business_id)) throw bad('Sucursal no válida.')
  const shift = d.fromCash ? (db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'abierto'").get(u.id) as { id: string } | undefined) : undefined
  if (d.fromCash && (d.method !== 'efectivo' || !shift)) throw conflict('Para pagar desde la caja debe ser en efectivo y con la caja abierta.', 'caja_cerrada')
  const id = d.id ?? newId()
  db.transaction(() => {
    db.prepare('INSERT INTO expenses (id, business_id, branch_id, concept, amount, kind, category, method, from_cash_shift, date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, branchId, d.concept, d.amount, d.kind, d.category ?? 'otros', d.method, shift?.id ?? null, d.date ?? localDate(now()), u.id, iso(now()),
    )
    if (shift) assertCashAvailable(db, shift.id, d.amount, 'este gasto')
    if (shift) db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'retiro',?,?,?,?)").run(newId(), shift.id, d.amount, `Gasto: ${d.concept}`, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'gasto.alta', entity: 'expense', entityId: id, newValue: d })
  })()
  return c.json({ id }, 201)
})

/**
 * Anular un gasto capturado por error (no se borra: queda en la bitácora con motivo y quién autorizó).
 * Si se pagó de la caja, el dinero regresa a esa caja; por eso solo mientras ese turno siga abierto.
 */
finance.post('/expenses/:id/void', requirePerm('edit_inventory'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const e = db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; concept: string; amount: number; from_cash_shift: string | null; voided_at: string | null } | undefined
  if (!e) throw notFound()
  const d = parse(z.object({ reason: z.string().trim().min(3, 'Escribe el motivo').max(200), authCode: z.string().optional() }), await body(c))
  if (e.voided_at) throw conflict('Ese gasto ya estaba anulado.', 'ya_anulado')
  const shift = e.from_cash_shift ? (db.prepare('SELECT id, status FROM shifts WHERE id = ?').get(e.from_cash_shift) as { id: string; status: string }) : null
  if (shift && shift.status !== 'abierto') throw conflict('Ese gasto salió de una caja que ya tiene corte; no se puede anular. Registra la corrección como depósito en la caja de hoy.', 'turno_cerrado')
  const auth = u.role === 'owner' ? null : authorize(deps, u, d.authCode, 'cancel_discount', 'anular gasto', { ownerOnly: true })
  db.transaction(() => {
    db.prepare('UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run(iso(now()), auth?.id ?? u.id, d.reason, e.id)
    if (shift) db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at) VALUES (?,?,'deposito',?,?,?,?)").run(newId(), shift.id, e.amount, `Gasto anulado: ${e.concept}`, u.id, iso(now()))
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'gasto.anulado', entity: 'expense', entityId: e.id, oldValue: { concept: e.concept, amount: e.amount }, reason: d.reason, ...(auth ? { authorizedBy: auth.id } : {}) })
  })()
  return c.json({ ok: true })
})

finance.get('/expenses', requireFinance('finance'), (c) => {
  const from = c.req.query('from') ?? '0000-00-00'
  const to = c.req.query('to') ?? '9999-12-31'
  const branch = scopeBranch(c) // dueño: todos (o la que pida); los demás: los de su sucursal
  const rows = c.get('deps').db.prepare(`SELECT id, concept, amount, kind, category, method, date, from_cash_shift IS NOT NULL AS fromCash, voided_at AS voidedAt, void_reason AS voidReason FROM expenses WHERE business_id = ? AND date BETWEEN ? AND ? ${branch ? 'AND branch_id = ?' : ''} ORDER BY voided_at IS NOT NULL, date DESC`).all(c.get('session').user.business_id, from, to, ...(branch ? [branch] : []))
  return c.json({ expenses: rows })
})

finance.get('/fixed-expenses', requireFinance('finance'), wholeBusinessOnly, (c) => {
  const { db } = c.get('deps')
  const b = c.get('session').user.business_id
  const rows = db.prepare('SELECT id, concept, monthly_amount AS monthlyAmount, active FROM fixed_expenses WHERE business_id = ? ORDER BY concept').all(b)
  const reserveDays = (db.prepare('SELECT reserve_days FROM businesses WHERE id = ?').get(b) as { reserve_days: number | null }).reserve_days
  return c.json({ fixedExpenses: rows, reserveDays })
})

finance.post('/fixed-expenses', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ concept: z.string().trim().min(2).max(100), monthlyAmount: z.number().int().min(1) }), await body(c))
  const id = newId()
  db.prepare('INSERT INTO fixed_expenses (id, business_id, concept, monthly_amount, created_at) VALUES (?,?,?,?,?)').run(id, u.business_id, d.concept, d.monthlyAmount, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'gasto_fijo.alta', entity: 'fixed_expense', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

finance.patch('/fixed-expenses/:id', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const old = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; concept: string; monthly_amount: number; active: number } | undefined
  if (!old) throw notFound()
  const d = parse(z.object({ concept: z.string().trim().min(2).max(100).optional(), monthlyAmount: z.number().int().min(1).optional(), active: z.boolean().optional() }), await body(c))
  db.prepare('UPDATE fixed_expenses SET concept = ?, monthly_amount = ?, active = ? WHERE id = ?').run(d.concept ?? old.concept, d.monthlyAmount ?? old.monthly_amount, d.active === undefined ? old.active : d.active ? 1 : 0, old.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'gasto_fijo.cambio', entity: 'fixed_expense', entityId: old.id, oldValue: old, newValue: d })
  return c.json({ ok: true })
})

/** El dueño define cuántos días de gastos fijos quiere guardar de reserva. */
finance.put('/reserve-days', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ days: z.number().int().min(0).max(365) }), await body(c))
  db.prepare('UPDATE businesses SET reserve_days = ? WHERE id = ?').run(d.days, u.business_id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'negocio.dias_reserva', newValue: d })
  return c.json({ ok: true })
})

// ---------- Reportes ----------

/** Rango de fechas locales [from, to] → instantes ISO. Centro de México: UTC−6 fijo (sin horario de verano desde 2022). */
export function range(from: string, to: string) {
  return { start: new Date(`${from}T06:00:00.000Z`).toISOString(), end: new Date(new Date(`${to}T06:00:00.000Z`).getTime() + 86_400_000).toISOString() }
}

export function periodSummary(db: Db, businessId: string, from: string, to: string, branchId?: string) {
  const { start, end } = range(from, to)
  const bf = branchId ? 'AND branch_id = ?' : ''
  const bargs = branchId ? [branchId] : []
  const s = db
    .prepare(
      `SELECT COUNT(*) tickets, COALESCE(SUM(total),0) total, COALESCE(SUM(discount + promo_discount),0) discounts
       FROM sales WHERE business_id = ? AND status = 'completada' AND created_at >= ? AND created_at < ? ${bf}`,
    )
    .get(businessId, start, end, ...bargs) as Record<string, number>
  // Por forma de pago, desde los pagos de cada venta (una venta mixta suma a varias).
  const byMethod = db.prepare(`SELECT p.method, COALESCE(SUM(p.amount),0) a FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? ${bf.replace('branch_id', 's.branch_id')} GROUP BY p.method`).all(businessId, start, end, ...bargs) as { method: string; a: number }[]
  for (const m of ['efectivo', 'transferencia', 'tarjeta', 'fiado']) s[m] = byMethod.find((x) => x.method === m)?.a ?? 0
  const cogs = (db.prepare(`SELECT COALESCE(SUM(si.cost),0) c FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? ${bf.replace('branch_id', 's.branch_id')}`).get(businessId, start, end, ...bargs) as { c: number }).c
  const waste = -(db.prepare(`SELECT COALESCE(SUM(cost),0) c FROM stock_movements WHERE business_id = ? AND type = 'merma' AND created_at >= ? AND created_at < ? ${bf}`).get(businessId, start, end, ...bargs) as { c: number }).c
  const expenses = (db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM expenses WHERE business_id = ? AND voided_at IS NULL AND date BETWEEN ? AND ? ${bf}`).get(businessId, from, to, ...bargs) as { a: number }).a
  // Devoluciones: restan lo devuelto; lo que regresó al inventario recupera su costo.
  const refunds = (db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM returns WHERE business_id = ? AND created_at >= ? AND created_at < ? ${bf}`).get(businessId, start, end, ...bargs) as { a: number }).a
  const restocked = (db.prepare(`SELECT COALESCE(SUM(cost),0) c FROM stock_movements WHERE business_id = ? AND type = 'devolucion' AND created_at >= ? AND created_at < ? ${bf}`).get(businessId, start, end, ...bargs) as { c: number }).c
  const cancelled = (db.prepare(`SELECT COUNT(*) n FROM sales WHERE business_id = ? AND status = 'cancelada' AND created_at >= ? AND created_at < ? ${bf}`).get(businessId, start, end, ...bargs) as { n: number }).n
  // Comisiones del personal: costo del negocio (se cuentan al vender; no las registres también como gasto).
  const commissions = (db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM sale_commissions sc WHERE sc.business_id = ? AND sc.status = 'vigente' AND sc.created_at >= ? AND sc.created_at < ? ${branchId ? 'AND sc.sale_id IN (SELECT id FROM sales WHERE branch_id = ?)' : ''}`).get(businessId, start, end, ...bargs) as { a: number }).a
  const grossProfit = s.total! - refunds - (cogs - restocked)
  return { from, to, sales: s, cancelled, refunds, costOfSales: cogs - restocked, grossProfit, waste, expenses, commissions, profit: grossProfit - waste - expenses - commissions }
}

finance.get('/reports/summary', requireFinance('dashboard'), (c) => {
  const { db, now } = c.get('deps')
  const today = localDate(now())
  const from = c.req.query('from') ?? today
  const to = c.req.query('to') ?? today
  const u = c.get('session').user
  const branch = scopeBranch(c)
  const summary = periodSummary(db, u.business_id, from, to, branch)
  const { start, end } = range(from, to)
  const top = db
    .prepare(`SELECT si.description, SUM(si.quantity) qty, SUM(si.total) total, SUM(si.total - si.cost) profit FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? ${branch ? 'AND s.branch_id = ?' : ''} GROUP BY COALESCE(si.product_id, si.description) ORDER BY total DESC LIMIT 20`)
    .all(u.business_id, start, end, ...(branch ? [branch] : []))
  return c.json({ ...summary, topProducts: top })
})

/** Ventas por día (para la gráfica del inicio). */
finance.get('/reports/daily', requireFinance('dashboard'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 7) || 7, 1), 92)
  const out: { date: string; total: number; tickets: number; profit: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = localDate(new Date(now().getTime() - i * 86_400_000))
    const s = periodSummary(db, u.business_id, date, date, scopeBranch(c))
    out.push({ date, total: s.sales.total!, tickets: s.sales.tickets!, profit: s.profit })
  }
  return c.json({ days: out })
})

/** Movimientos recientes: ventas, cancelaciones, retiros y depósitos de caja, compras y gastos. */
finance.get('/reports/recent', requireFinance('dashboard'), (c) => {
  const { db } = c.get('deps')
  const b = c.get('session').user.business_id
  const limit = Math.min(Number(c.req.query('limit') ?? 12) || 12, 50)
  const br = scopeBranch(c)
  const f = (col: string) => (br ? `AND ${col} = ?` : '')
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT 'venta' AS kind, s.created_at AS at, s.total AS amount, 'Venta #' || s.folio || ' · ' || s.payment_method AS label, s.status AS status FROM sales s WHERE s.business_id = ? ${f('s.branch_id')}
      UNION ALL SELECT m.type, m.created_at, m.amount, m.reason, NULL FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? ${f('sh.branch_id')}
      UNION ALL SELECT 'compra', p.created_at, p.items_total + p.freight_total, CASE WHEN p.ticket_ref IS NULL THEN 'de ' || p.payment ELSE 'folio ' || p.ticket_ref || ' · ' || p.payment END, p.payment FROM purchases p WHERE p.business_id = ? ${f('p.branch_id')}
      UNION ALL SELECT 'gasto', e.created_at, e.amount, e.concept, CASE WHEN e.voided_at IS NULL THEN e.kind ELSE 'anulado' END FROM expenses e WHERE e.business_id = ? ${f('e.branch_id')}
    ) ORDER BY at DESC LIMIT ?`).all(...[b, ...(br ? [br] : []), b, ...(br ? [br] : []), b, ...(br ? [br] : []), b, ...(br ? [br] : []), limit])
  return c.json({ movements: rows })
})

/**
 * Retiro sugerido del dueño = utilidad del periodo − reserva (días de gastos fijos) − reposición de inventario.
 * Sin porcentajes. La reposición es lo que cuesta llevar al mínimo los productos que están por debajo.
 */
/** Lo que cuesta reponer el inventario que está debajo del mínimo (en todas las sucursales). */
export function restockNeeded(db: Db, businessId: string) {
  const branches = db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1').all(businessId) as { id: string }[]
  const products = db.prepare('SELECT * FROM products WHERE business_id = ? AND active = 1 AND min_stock_milli > 0').all(businessId) as ProductRow[]
  let total = 0
  const items: { name: string; missing: number; cost: number }[] = []
  for (const br of branches)
    for (const p of products) {
      const missing = p.min_stock_milli - stockOf(db, br.id, p.id)
      if (missing > 0) {
        const cost = Math.round((missing * p.last_cost) / 1000)
        total += cost
        items.push({ name: p.name, missing: fromMilli(missing), cost })
      }
    }
  return { total, items }
}

finance.get('/reports/suggested-withdrawal', ownerOnly, (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const today = localDate(now())
  const from = c.req.query('from') ?? `${today.slice(0, 8)}01`
  const to = c.req.query('to') ?? today
  const b = db.prepare('SELECT reserve_days FROM businesses WHERE id = ?').get(u.business_id) as { reserve_days: number | null }
  const summary = periodSummary(db, u.business_id, from, to)
  const monthlyFixed = (db.prepare('SELECT COALESCE(SUM(monthly_amount),0) m FROM fixed_expenses WHERE business_id = ? AND active = 1').get(u.business_id) as { m: number }).m
  const reserve = b.reserve_days == null ? null : Math.round((monthlyFixed * 12 * b.reserve_days) / 365)
  const branches = db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1').all(u.business_id) as { id: string }[]
  const products = db.prepare('SELECT * FROM products WHERE business_id = ? AND active = 1 AND min_stock_milli > 0').all(u.business_id) as ProductRow[]
  let restock = 0
  const restockItems: { name: string; missing: number; cost: number }[] = []
  for (const br of branches)
    for (const p of products) {
      const missing = p.min_stock_milli - stockOf(db, br.id, p.id)
      if (missing > 0) {
        const cost = Math.round((missing * p.last_cost) / 1000)
        restock += cost
        restockItems.push({ name: p.name, missing: fromMilli(missing), cost })
      }
    }
  if (reserve == null) return c.json({ from, to, profit: summary.profit, monthlyFixed, reserveDays: null, reserve: null, restock, suggested: null, message: 'Define cuántos días de gastos fijos quieres de reserva.' })
  return c.json({ from, to, profit: summary.profit, monthlyFixed, reserveDays: b.reserve_days, reserve, restock, restockItems, suggested: Math.max(0, summary.profit - reserve - restock) })
})

// ---------- Cajas ----------

finance.get('/registers', (c) => {
  const branch = c.get('session').user.role === 'owner' ? undefined : scopeBranch(c)
  return c.json({ registers: c.get('deps').db.prepare(`SELECT id, branch_id AS branchId, name, active FROM registers WHERE business_id = ? ${branch ? 'AND branch_id = ?' : ''} ORDER BY name`).all(c.get('session').user.business_id, ...(branch ? [branch] : [])) })
})

finance.post('/registers', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(1).max(50), branchId: z.string().optional() }), await body(c))
  const branchId = d.branchId ?? u.branch_id
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ? AND active = 1').get(branchId, u.business_id)) throw bad('Sucursal no válida.')
  const id = newId()
  db.prepare('INSERT INTO registers (id, business_id, branch_id, name, created_at) VALUES (?,?,?,?,?)').run(id, u.business_id, branchId, d.name, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'caja.alta', entity: 'register', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

/** Asignar caja a un cajero (o quitarla con null). */
finance.put('/users/:id/register', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ registerId: z.string().nullable() }), await body(c))
  const target = db.prepare('SELECT id, register_id FROM users WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; register_id: string | null } | undefined
  if (!target) throw notFound()
  const reg = d.registerId ? (db.prepare('SELECT branch_id FROM registers WHERE id = ? AND business_id = ? AND active = 1').get(d.registerId, u.business_id) as { branch_id: string } | undefined) : null
  if (d.registerId && !reg) throw bad('Esa caja no existe.')
  db.prepare('UPDATE users SET register_id = ?, branch_id = COALESCE(?, branch_id) WHERE id = ?').run(d.registerId, reg?.branch_id ?? null, target.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'usuario.caja_asignada', entity: 'user', entityId: target.id, oldValue: { registerId: target.register_id }, newValue: d })
  return c.json({ ok: true })
})
