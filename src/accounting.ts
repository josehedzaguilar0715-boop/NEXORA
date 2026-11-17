import { Hono } from 'hono'
import { requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { shiftTotals, type ShiftRow } from './cash.js'
import { periodSummary, range } from './finance.js'
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
  const byCategory = db.prepare('SELECT category, COALESCE(SUM(amount),0) amount FROM expenses WHERE business_id = ? AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC').all(businessId, from, to) as { category: string; amount: number }[]
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
    ...(db.prepare("SELECT 'ventas' category, p.method method, SUM(p.amount) amount FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND p.method <> 'fiado' AND s.created_at >= ? AND s.created_at < ? GROUP BY p.method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'cobranza' category, method, -SUM(delta) amount FROM credit_ledger WHERE business_id = ? AND kind = 'abono' AND created_at >= ? AND created_at < ? GROUP BY method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'aportaciones' category, 'efectivo' method, SUM(m.amount) amount FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? AND m.origin = 'manual' AND m.type = 'deposito' AND m.created_at >= ? AND m.created_at < ?").all(businessId, start, end) as Flow[]),
  ].filter((r) => r.amount > 0)
  const outflows = [
    ...(db.prepare('SELECT \'proveedores\' category, sp.method, SUM(sp.amount) amount FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id WHERE p.business_id = ? AND sp.created_at >= ? AND sp.created_at < ? GROUP BY sp.method').all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'gastos' category, method, SUM(amount) amount FROM expenses WHERE business_id = ? AND date BETWEEN ? AND ? GROUP BY method").all(businessId, from, to) as Flow[]),
    ...(db.prepare("SELECT 'devoluciones' category, refund_method method, SUM(amount) amount FROM returns WHERE business_id = ? AND refund_method <> 'saldo' AND created_at >= ? AND created_at < ? GROUP BY refund_method").all(businessId, start, end) as Flow[]),
    ...(db.prepare("SELECT 'retiros' category, 'efectivo' method, SUM(m.amount) amount FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? AND m.origin = 'manual' AND m.type = 'retiro' AND m.created_at >= ? AND m.created_at < ?").all(businessId, start, end) as Flow[]),
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
  const cashInRegisters = shifts.reduce((a, s) => a + shiftTotals(db, s).expectedCash - shiftTotals(db, s).tipsCash, 0)
  const assets = cashInRegisters + inventory + receivables
  const liabilities = payables + customerCredit
  return { cashInRegisters, openRegisters: shifts.length, inventory, receivables, assets, payables, customerCredit, liabilities, equity: assets - liabilities }
}

type Entry = { at: string; type: string; concept: string; method: string; inflow: number; outflow: number }

/** Libro de movimientos de dinero, en orden. */
export function ledger(db: Db, businessId: string, from: string, to: string): Entry[] {
  const { start, end } = range(from, to)
  const b = businessId
  return db.prepare(`
    SELECT * FROM (
      SELECT s.created_at at, 'Venta' type, 'Ticket #' || s.folio concept, p.method method, p.amount inflow, 0 outflow FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND p.method <> 'fiado' AND p.amount > 0 AND s.created_at >= ? AND s.created_at < ?
      UNION ALL SELECT l.created_at, 'Cobro de fiado', COALESCE(c.name, 'Cliente'), l.method, -l.delta, 0 FROM credit_ledger l LEFT JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? AND l.kind = 'abono' AND l.created_at >= ? AND l.created_at < ?
      UNION ALL SELECT m.created_at, CASE m.type WHEN 'deposito' THEN 'Depósito a caja' ELSE 'Retiro de caja' END, m.reason, 'efectivo', CASE m.type WHEN 'deposito' THEN m.amount ELSE 0 END, CASE m.type WHEN 'retiro' THEN m.amount ELSE 0 END FROM cash_movements m JOIN shifts sh ON sh.id = m.shift_id WHERE sh.business_id = ? AND m.origin = 'manual' AND m.created_at >= ? AND m.created_at < ?
      UNION ALL SELECT sp.created_at, 'Pago a proveedor', COALESCE(s.name, 'Proveedor') || COALESCE(' · folio ' || p.ticket_ref, ''), sp.method, 0, sp.amount FROM supplier_payments sp JOIN purchases p ON p.id = sp.purchase_id LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.business_id = ? AND sp.created_at >= ? AND sp.created_at < ?
      UNION ALL SELECT e.date || 'T12:00:00.000Z', 'Gasto', e.concept, e.method, 0, e.amount FROM expenses e WHERE e.business_id = ? AND e.date BETWEEN ? AND ?
      UNION ALL SELECT r.created_at, 'Devolución', r.reason, r.refund_method, 0, r.amount FROM returns r WHERE r.business_id = ? AND r.refund_method <> 'saldo' AND r.created_at >= ? AND r.created_at < ?
    ) ORDER BY at, type LIMIT 20000`).all(b, start, end, b, start, end, b, start, end, b, start, end, b, from, to, b, start, end) as Entry[]
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
    const list = db.prepare('SELECT date, concept, category, kind, method, amount FROM expenses WHERE business_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(b, from, to) as { date: string; concept: string; category: string; kind: string; method: string; amount: number }[]
    for (const e of list) rows.push([e.date, e.concept, CATEGORY_LABEL[e.category] ?? e.category, e.kind, e.method, money(e.amount)])
  } else throw bad('Tipo de exportación no válido.')
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
  return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="nexora-${kind}-${from}-a-${to}.csv"` })
})
