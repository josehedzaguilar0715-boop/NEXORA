import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, ownerOnly, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { shiftTotals, type ShiftRow } from './cash.js'
import { periodSummary, range, restockNeeded } from './finance.js'
import { bad, localDate } from './util.js'

/**
 * Finanzas y contabilidad del negocio (contabilidad administrativa, no fiscal):
 * estado de resultados, flujo de efectivo, balance simplificado y libro de movimientos.
 * Todo sale de los registros que ya existen (ventas, compras, gastos, fiado, devoluciones y caja).
 */
export const accounting = new Hono<Env>()

const DATE = /^\d{4}-\d{2}-\d{2}$/

function period(c: { req: { query: (k: string) => string | undefined } }, today: string) {
  const from = c.req.query('from') ?? `${today.slice(0, 8)}01`
  const to = c.req.query('to') ?? today
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw bad('Periodo no válido.')
  return { from, to }
}

/** Periodo anterior del mismo largo (para comparar). */
function previous(from: string, to: string) {
  const day = 86_400_000
  const f = Date.parse(`${from}T12:00:00Z`), t = Date.parse(`${to}T12:00:00Z`)
  const len = Math.round((t - f) / day) + 1
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: iso(f - len * day), to: iso(f - day) }
}

export function incomeStatement(db: Db, businessId: string, from: string, to: string) {
  const s = periodSummary(db, businessId, from, to)
  const byCategory = db.prepare('SELECT category, COALESCE(SUM(amount),0) amount FROM expenses WHERE business_id = ? AND voided_at IS NULL AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC').all(businessId, from, to) as { category: string; amount: number }[]
  const grossSales = s.sales.total! + s.sales.discounts!
  const netSales = s.sales.total! - s.refunds
  const operatingExpenses = s.expenses + s.waste + s.commissions
  return {
    from, to,
    grossSales,
    discounts: s.sales.discounts!,
    refunds: s.refunds,
    netSales,
    costOfSales: s.costOfSales,
    grossProfit: s.grossProfit,
    expensesByCategory: byCategory,
    expenses: s.expenses,
    waste: s.waste,
    commissions: s.commissions,
    operatingExpenses,
    netProfit: s.profit,
    grossMargin: netSales ? s.grossProfit / netSales : null,
    netMargin: netSales ? s.profit / netSales : null,
    tickets: s.sales.tickets!,
    averageTicket: s.sales.tickets ? Math.round(s.sales.total! / s.sales.tickets) : 0,
  }
}

type Flow = { category: string; method: string; amount: number }

/** Entradas y salidas de dinero real (el fiado no es dinero hasta que se cobra). */
export function cashFlow(db: Db, businessId: string, from: string, to: string) {
  const { start, end } = range(from, to)
  const inflows = [
    ...(db.prepare("SELECT 'ventas' category, p.method method, SUM(p.amount) amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND p.method NOT IN ('fiado','anticipo') AND s.created_at >= ? AND s.created_at < ? GROUP BY p.method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'apartados' category, lp.method method, SUM(lp.amount) amount FROM layaway_payments lp JOIN layaways l ON l.id = lp.layaway_id WHERE l.business_id = ? AND lp.amount > 0 AND lp.created_at >= ? AND lp.created_at < ? GROUP BY lp.method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'cobranza' category, method, -SUM(delta) amount FROM credit_ledger WHERE business_id = ? AND ((kind = 'abono' AND method IS NOT NULL) OR (kind = 'cancelacion' AND reverses_id IS NOT NULL)) AND created_at >= ? AND created_at < ? GROUP BY method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'aportaciones' category, 'efectivo' method, SUM(m.amount) amount FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? AND m.origin = 'manual' AND m.type = 'deposito' AND m.created_at >= ? AND m.created_at < ?").all(businessId, start, end) as Flow[]),
  ].filter((r) => r.amount > 0)
  const outflows = [
    ...(db.prepare('SELECT \'proveedores\' category, sp.method, SUM(sp.amount) amount FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id WHERE p.business_id = ? AND sp.created_at >= ? AND sp.created_at < ? GROUP BY sp.method').all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'gastos' category, method, SUM(amount) amount FROM expenses WHERE business_id = ? AND voided_at IS NULL AND date BETWEEN ? AND ? GROUP BY method").all(businessId, from, to) as Flow[]),
    ...(db.prepare("SELECT 'devoluciones' category, refund_method method, SUM(amount) amount FROM returns WHERE business_id = ? AND refund_method <> 'saldo' AND created_at >= ? AND created_at < ? GROUP BY refund_method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'devoluciones' category, lp.method method, -SUM(lp.amount) amount FROM layaway_payments lp JOIN layaways l ON l.id = lp.layaway_id WHERE l.business_id = ? AND lp.amount < 0 AND lp.created_at >= ? AND lp.created_at < ? GROUP BY lp.method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'retiros' category, 'efectivo' method, SUM(m.amount) amount FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? AND m.origin = 'manual' AND m.type = 'retiro' AND m.created_at >= ? AND m.created_at < ?").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'personal' category, method, SUM(amount - tips) amount FROM staff_payouts WHERE business_id = ? AND created_at >= ? AND created_at < ? GROUP BY method").all(businessId, start, end) as Flow[]),
  ].filter((r) => r.amount > 0)
  const sum = (rows: Flow[]) => rows.reduce((a, r) => a + r.amount, 0)
  const totalIn = sum(inflows), totalOut = sum(outflows)
  // Efectivo (caja) contra banco (transferencias y tarjeta).
  const net = (m: (x: string) => boolean) => sum(inflows.filter((r) => m(r.method))) - sum(outflows.filter((r) => m(r.method)))
  return { from, to, inflows, outflows, totalIn, totalOut, net: totalIn - totalOut, cashNet: net((x) => x === 'efectivo'), bankNet: net((x) => x !== 'efectivo') }
}

/** Balance simplificado a hoy: lo que tiene el negocio, lo que debe y la diferencia. */
export function balanceSheet(db: Db, businessId: string) {
  const inventory = Math.round((db.prepare('SELECT COALESCE(SUM(qty_remaining_milli * unit_cost),0) v FROM lots WHERE business_id = ?').get(businessId) as { v: number }).v / 1000)
  const balances = db.prepare('SELECT SUM(delta) b FROM credit_ledger WHERE business_id = ? GROUP BY customer_id').all(businessId) as { b: number }[]
  const receivables = balances.filter((r) => r.b > 0).reduce((a, r) => a + r.b, 0)
  const customerCredit = -balances.filter((r) => r.b < 0).reduce((a, r) => a + r.b, 0)
  const payables = (db.prepare(`SELECT COALESCE(SUM(owed),0) v FROM (
      SELECT p.items_total + p.freight_total - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE purchase_id = p.id),0) owed FROM purchases p WHERE p.business_id = ?
    ) WHERE owed > 0`).get(businessId) as { v: number }).v
  const shifts = db.prepare("SELECT * FROM shifts WHERE business_id = ? AND status = 'abierto'").all(businessId) as ShiftRow[]
  // Las propinas en efectivo que siguen en la caja son del personal, no del negocio (las ya pagadas ya salieron).
  const unpaidTips = (id: string) => (db.prepare("SELECT COALESCE(SUM(amount),0) v FROM tips WHERE shift_id = ? AND method = 'efectivo' AND status = 'vigente' AND payout_id IS NULL").get(id) as { v: number }).v
  const cashInRegisters = shifts.reduce((a, s) => a + shiftTotals(db, s).expectedCash - unpaidTips(s.id), 0)
  const assets = cashInRegisters + inventory + receivables
  // Anticipos de apartados abiertos: dinero recibido por mercancía que aún no se entrega.
  const layawayDeposits = (db.prepare("SELECT COALESCE(SUM(lp.amount),0) v FROM layaway_payments lp JOIN layaways l ON l.id = lp.layaway_id WHERE l.business_id = ? AND l.status = 'abierto'").get(businessId) as { v: number }).v
  const liabilities = payables + customerCredit + layawayDeposits
  return { cashInRegisters, openRegisters: shifts.length, inventory, receivables, assets, payables, customerCredit, layawayDeposits, liabilities, equity: assets - liabilities }
}

type Entry = { at: string; type: string; concept: string; method: string; inflow: number; outflow: number }

/** Libro de movimientos de dinero, en orden. */
export function ledger(db: Db, businessId: string, from: string, to: string): Entry[] {
  const { start, end } = range(from, to)
  const b = businessId
  // Una consulta por tipo de movimiento (la base de Cloudflare no une más de 5 en una sola) y luego se ordenan juntos.
  const parts: [string, unknown[]][] = [
    [`SELECT s.created_at at, 'Venta' type, 'Ticket #' || s.folio concept, p.method method, p.amount inflow, 0 outflow FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND p.method NOT IN ('fiado','anticipo') AND p.amount > 0 AND s.created_at >= ? AND s.created_at < ?`, [b, start, end]],
    [`SELECT lp.created_at, CASE lp.kind WHEN 'devolucion' THEN 'Devolución de apartado' ELSE 'Apartado' END, CASE lp.kind WHEN 'anticipo' THEN 'Anticipo' WHEN 'abono' THEN 'Abono' ELSE 'Devolución' END || ' apartado #' || l.folio, lp.method, CASE WHEN lp.amount > 0 THEN lp.amount ELSE 0 END, CASE WHEN lp.amount < 0 THEN -lp.amount ELSE 0 END FROM layaway_payments lp JOIN layaways l ON l.id = lp.layaway_id WHERE l.business_id = ? AND lp.created_at >= ? AND lp.created_at < ?`, [b, start, end]],
    [`SELECT l.created_at, 'Cobro de fiado', COALESCE(c.name, 'Cliente'), l.method, -l.delta, 0 FROM credit_ledger l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? AND l.kind = 'abono' AND l.method IS NOT NULL AND l.created_at >= ? AND l.created_at < ?`, [b, start, end]],
    [`SELECT l.created_at, 'Abono anulado', COALESCE(c.name, 'Cliente') || COALESCE(' · ' || l.note, ''), l.method, 0, l.delta FROM credit_ledger l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? AND l.kind = 'cancelacion' AND l.reverses_id IS NOT NULL AND l.created_at >= ? AND l.created_at < ?`, [b, start, end]],
    [`SELECT m.created_at, CASE m.type WHEN 'deposito' THEN 'Depósito a caja' ELSE 'Retiro de caja' END, m.reason, 'efectivo', CASE m.type WHEN 'deposito' THEN m.amount ELSE 0 END, CASE m.type WHEN 'retiro' THEN m.amount ELSE 0 END FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? AND m.origin = 'manual' AND m.created_at >= ? AND m.created_at < ?`, [b, start, end]],
    [`SELECT sp.created_at, 'Pago a proveedor', COALESCE(s.name, 'Proveedor') || COALESCE(' · folio ' || p.ticket_ref, ''), sp.method, 0, sp.amount FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.business_id = ? AND sp.created_at >= ? AND sp.created_at < ?`, [b, start, end]],
    [`SELECT e.date || 'T12:00:00.000Z', 'Gasto', e.concept, e.method, 0, e.amount FROM expenses e WHERE e.business_id = ? AND e.voided_at IS NULL AND e.date BETWEEN ? AND ?`, [b, from, to]],
    // Pago de comisiones al personal (las propinas no son dinero del negocio: no entran ni salen del libro).
    [`SELECT p.created_at, 'Pago a personal', 'Comisiones de ' || u.name, p.method, 0, p.amount - p.tips FROM staff_payouts p JOIN users u ON u.id = p.staff_id WHERE p.business_id = ? AND p.amount - p.tips > 0 AND p.created_at >= ? AND p.created_at < ?`, [b, start, end]],
    [`SELECT r.created_at, 'Devolución', r.reason, r.refund_method, 0, r.amount FROM returns r WHERE r.business_id = ? AND r.refund_method <> 'saldo' AND r.created_at >= ? AND r.created_at < ?`, [b, start, end]],
  ]
  // La lista de columnas del WITH les pone nombre fijo a todas, aunque cada consulta las calcule distinto.
  const rows = parts.flatMap(([sql, args]) => db.prepare(`WITH t(at, type, concept, method, inflow, outflow) AS (${sql}) SELECT * FROM t`).all(...args) as Entry[])
  return rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : 0)).slice(0, 20000)
}

const CATEGORY_LABEL: Record<string, string> = { renta: 'Renta', servicios: 'Luz, agua, gas, internet y teléfono', nomina: 'Sueldos', insumos: 'Insumos y limpieza', transporte: 'Transporte y gasolina', mantenimiento: 'Mantenimiento', publicidad: 'Publicidad', impuestos: 'Impuestos y permisos', comisiones_bancarias: 'Comisiones bancarias', otros: 'Otros' }

accounting.get('/accounting/income-statement', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const b = c.get('session').user.business_id
  const { from, to } = period(c, localDate(now()))
  const prev = previous(from, to)
  return c.json({ current: incomeStatement(db, b, from, to), previous: incomeStatement(db, b, prev.from, prev.to) })
})

accounting.get('/accounting/cash-flow', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const { from, to } = period(c, localDate(now()))
  return c.json(cashFlow(db, c.get('session').user.business_id, from, to))
})

accounting.get('/accounting/balance', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  return c.json({ date: localDate(now()), ...balanceSheet(db, c.get('session').user.business_id) })
})

accounting.get('/accounting/ledger', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const { from, to } = period(c, localDate(now()))
  const rows = ledger(db, c.get('session').user.business_id, from, to)
  return c.json({ from, to, entries: rows, totalIn: rows.reduce((a, r) => a + r.inflow, 0), totalOut: rows.reduce((a, r) => a + r.outflow, 0) })
})

/** Exportar para el contador (CSV que abre Excel). */
accounting.get('/accounting/export', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const b = c.get('session').user.business_id
  const { from, to } = period(c, localDate(now()))
  const kind = c.req.query('kind') ?? 'movimientos'
  const money = (n: number) => (n / 100).toFixed(2)
  const cell = (v: string | number) => (typeof v === 'number' ? String(v) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  let rows: (string | number)[][]
  if (kind === 'movimientos') {
    rows = [['Fecha', 'Hora', 'Tipo', 'Concepto', 'Forma de pago', 'Entrada', 'Salida']]
    for (const e of ledger(db, b, from, to)) {
      const d = new Date(Date.parse(e.at) - 6 * 3600_000).toISOString()
      rows.push([d.slice(0, 10), e.type === 'Gasto' ? '' : d.slice(11, 16), e.type, e.concept, e.method, e.inflow ? money(e.inflow) : '', e.outflow ? money(e.outflow) : ''])
    }
  } else if (kind === 'resultados') {
    const r = incomeStatement(db, b, from, to)
    rows = [['Estado de resultados', `${from} a ${to}`], ['Ventas', money(r.grossSales)], ['Descuentos', money(-r.discounts)], ['Devoluciones', money(-r.refunds)], ['Ventas netas', money(r.netSales)], ['Costo de ventas', money(-r.costOfSales)], ['Utilidad bruta', money(r.grossProfit)]]
    for (const e of r.expensesByCategory) rows.push([`Gasto: ${CATEGORY_LABEL[e.category] ?? e.category}`, money(-e.amount)])
    rows.push(['Mermas', money(-r.waste)], ['Comisiones del personal', money(-r.commissions)], ['Utilidad neta', money(r.netProfit)])
  } else if (kind === 'gastos') {
    rows = [['Fecha', 'Concepto', 'Categoría', 'Tipo', 'Forma de pago', 'Importe']]
    const list = db.prepare('SELECT date, concept, category, kind, method, amount FROM expenses WHERE business_id = ? AND voided_at IS NULL AND date BETWEEN ? AND ? ORDER BY date').all(b, from, to) as { date: string; concept: string; category: string; kind: string; method: string; amount: number }[]
    for (const e of list) rows.push([e.date, e.concept, CATEGORY_LABEL[e.category] ?? e.category, e.kind, e.method, money(e.amount)])
  } else throw bad('Tipo de exportación no válido.')
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
  return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="nexora-${kind}-${from}-a-${to}.csv"` })
})

// ---------- Plan 50/30/20 y retiro sugerido ----------

export const DEFAULT_RULE = { ops: 50, owner: 30, savings: 20 }
export function budgetRule(db: Db, businessId: string): typeof DEFAULT_RULE {
  const r = db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'budgetRule'").get(businessId) as { value: string } | undefined
  return r ? { ...DEFAULT_RULE, ...JSON.parse(r.value) } : DEFAULT_RULE
}

/**
 * Reparto de la utilidad bruta (ventas − lo que costó lo vendido) con la regla 50/30/20 (editable):
 * 50% para operar (gastos fijos y variables, comisiones, mermas), 30% para el dueño y 20% de ahorro e imprevistos.
 * El retiro sugerido nunca pasa del 30% ni deja al negocio sin su reserva de gastos fijos y sin para reponer inventario.
 */
export function financialPlan(db: Db, businessId: string, from: string, to: string) {
  const rule = budgetRule(db, businessId)
  const s = periodSummary(db, businessId, from, to)
  const gross = Math.max(0, s.grossProfit)
  const opsActual = s.expenses + s.commissions + s.waste
  const pct = (p: number) => Math.round((gross * p) / 100)
  const biz = db.prepare('SELECT reserve_days FROM businesses WHERE id = ?').get(businessId) as { reserve_days: number | null }
  const reserveDays = biz.reserve_days ?? 30
  const monthlyFixed = (db.prepare('SELECT COALESCE(SUM(monthly_amount),0) m FROM fixed_expenses WHERE business_id = ? AND active = 1').get(businessId) as { m: number }).m
  const reserve = Math.round((monthlyFixed * reserveDays) / 30)
  const restock = restockNeeded(db, businessId)
  const cash = balanceSheet(db, businessId).cashInRegisters
  const ownerTarget = pct(rule.owner)
  // Lo más que se puede sacar sin descapitalizar: la utilidad menos la reserva y lo que falta para reponer inventario.
  const safeMax = Math.max(0, s.profit - reserve - restock.total)
  const suggested = Math.max(0, Math.min(ownerTarget, safeMax))
  const reasons: string[] = []
  if (s.profit <= 0) reasons.push('En este periodo el negocio todavía no deja ganancia: mejor no retirar.')
  else if (suggested < ownerTarget) reasons.push(`Se sugiere menos que tu ${rule.owner}% para que el negocio conserve ${reserve > 0 ? `su reserva de ${reserveDays} días de gastos fijos` : 'su dinero para operar'}${restock.total > 0 ? ' y pueda reponer el inventario' : ''}.`)
  if (opsActual > pct(rule.ops) && gross > 0) reasons.push(`Los gastos de operación ya pasan del ${rule.ops}% (llevas ${Math.round((opsActual / gross) * 100)}%). Revisa gastos fijos y mermas.`)
  if (suggested > cash) reasons.push('Parte de este dinero no está en la caja: puede estar en transferencias o tarjeta.')
  return {
    from, to, rule,
    sales: (s.sales.total ?? 0) - s.refunds, costOfSales: s.costOfSales, grossProfit: s.grossProfit, profit: s.profit,
    buckets: {
      ops: { pct: rule.ops, target: pct(rule.ops), actual: opsActual, detail: { expenses: s.expenses, commissions: s.commissions, waste: s.waste } },
      owner: { pct: rule.owner, target: ownerTarget },
      savings: { pct: rule.savings, target: pct(rule.savings) },
    },
    reserveDays, reserveDaysSet: biz.reserve_days != null, monthlyFixed, reserve, restock: restock.total, restockItems: restock.items.slice(0, 10), cash,
    safeMax, suggested, reasons,
    keeps: Math.max(0, s.profit - suggested),
  }
}

accounting.get('/finance/plan', ownerOnly, (c) => {
  const { db, now } = c.get('deps')
  const t = localDate(now())
  const from = c.req.query('from') ?? `${t.slice(0, 8)}01`
  const to = c.req.query('to') ?? t
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw bad('Periodo no válido.')
  return c.json(financialPlan(db, c.get('session').user.business_id, from, to))
})

accounting.put('/finance/plan/rule', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ ops: z.number().int().min(0).max(100), owner: z.number().int().min(0).max(100), savings: z.number().int().min(0).max(100) }).refine((r) => r.ops + r.owner + r.savings === 100, 'Los tres porcentajes deben sumar 100.'), await body(c))
  const old = budgetRule(db, u.business_id)
  db.prepare("INSERT INTO business_settings (business_id, key, value) VALUES (?, 'budgetRule', ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value").run(u.business_id, JSON.stringify(d))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'finanzas.regla_reparto', oldValue: old, newValue: d })
  return c.json({ rule: d })
})
