import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, ownerOnly, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { fromMilli, stockOf } from './inventory.js'
import { periodSummary, range } from './finance.js'
import { mainBranch } from './today.js'
import { localDate } from './util.js'

/**
 * Panel de Inicio: ventas de hoy contra ayer y contra la meta, el mes contra el mes anterior,
 * la ganancia real por forma de pago, lo que más deja hoy y lo que falta por surtir.
 */

const shiftDate = (date: string, d: number) => new Date(Date.parse(`${date}T12:00:00-06:00`) + d * 86_400_000).toISOString().slice(0, 10)
/** % de cambio; null cuando no hay con qué comparar (el periodo anterior fue 0). */
const pctChange = (now: number, before: number): number | null => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null)

/** Dinero que realmente entró y salió en el periodo (forma de pago), y la utilidad real (lo que entró − costo − egresos). */
export function realMoney(db: Db, businessId: string, from: string, to: string) {
  const { start, end } = range(from, to)
  const byMethod = db.prepare("SELECT p.method, COALESCE(SUM(p.amount),0) a FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? GROUP BY p.method").all(businessId, start, end) as { method: string; a: number }[]
  const m = (k: string) => byMethod.find((x) => x.method === k)?.a ?? 0
  const abonos = -(db.prepare("SELECT COALESCE(SUM(delta),0) v FROM credit_ledger WHERE business_id = ? AND ((kind = 'abono' AND method IS NOT NULL) OR (kind = 'cancelacion' AND reverses_id IS NOT NULL)) AND created_at >= ? AND created_at < ?").get(businessId, start, end) as { v: number }).v
  const layaway = (db.prepare("SELECT COALESCE(SUM(lp.amount),0) v FROM layaway_payments lp JOIN layaways l ON l.id = lp.layaway_id WHERE l.business_id = ? AND lp.created_at >= ? AND lp.created_at < ?").get(businessId, start, end) as { v: number }).v
  const s = periodSummary(db, businessId, from, to)
  const efectivo = m('efectivo'), transferencia = m('transferencia'), tarjeta = m('tarjeta')
  const ingresado = efectivo + transferencia + tarjeta + abonos + layaway
  // Egresos: gastos, comisiones, mermas y devoluciones de dinero (el costo de lo vendido va aparte).
  const egresos = s.expenses + s.commissions + s.waste + s.refunds
  return { efectivo, transferencia, tarjeta, abonos, apartados: layaway, fiado: m('fiado'), ingresado, costo: s.costOfSales, egresos, utilidad: ingresado - s.costOfSales - egresos }
}

export const dashboard = new Hono<Env>()

dashboard.get('/dashboard/panel', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const b = u.business_id
  const today = localDate(now())
  const yesterday = shiftDate(today, -1)
  const monthStart = `${today.slice(0, 8)}01`
  // Mes anterior hasta el mismo día, para comparar parejo.
  const prevStart = `${shiftDate(monthStart, -1).slice(0, 8)}01`
  const dayOfMonth = Number(today.slice(8, 10))
  const prevEndDay = Math.min(dayOfMonth, Number(shiftDate(monthStart, -1).slice(8, 10)))
  const prevEnd = `${prevStart.slice(0, 8)}${String(prevEndDay).padStart(2, '0')}`

  const t = periodSummary(db, b, today, today)
  const y = periodSummary(db, b, yesterday, yesterday)
  const mo = periodSummary(db, b, monthStart, today)
  const pm = periodSummary(db, b, prevStart, prevEnd)
  const egresos = (s: ReturnType<typeof periodSummary>) => s.expenses + s.commissions + s.waste + s.refunds

  // Serie diaria del mes (ventas, egresos y utilidad) para las minigráficas y la tendencia.
  const series: { date: string; sales: number; out: number; profit: number }[] = []
  for (let d = monthStart; d <= today; d = shiftDate(d, 1)) {
    const s = periodSummary(db, b, d, d)
    series.push({ date: d, sales: s.sales.total ?? 0, out: egresos(s), profit: s.profit })
  }

  // Granel de hoy: lo vendido por kilo, litro o metro.
  const { start, end } = range(today, today)
  const bulk = db.prepare("SELECT COALESCE(SUM(si.total),0) v, COUNT(*) n FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? AND p.unit != 'pieza'").get(b, start, end) as { v: number; n: number }
  const sellsBulk = !!db.prepare("SELECT 1 FROM products WHERE business_id = ? AND active = 1 AND unit != 'pieza' AND sellable = 1 LIMIT 1").get(b)

  // Lo que más ganancia dejó hoy.
  const topProfit = db.prepare("SELECT si.description name, SUM(si.quantity) qty, SUM(si.total) sales, SUM(si.total - si.cost) profit FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? GROUP BY si.description ORDER BY profit DESC LIMIT 6").all(b, start, end)

  // Stock bajo (lo que está debajo del mínimo).
  const branch = mainBranch(db, u)
  const low = branch ? (db.prepare('SELECT id, name, unit, min_stock_milli FROM products WHERE business_id = ? AND active = 1 AND min_stock_milli > 0').all(b) as { id: string; name: string; unit: string; min_stock_milli: number }[])
    .map((p) => ({ name: p.name, unit: p.unit, stock: fromMilli(stockOf(db, branch, p.id)), min: fromMilli(p.min_stock_milli) }))
    .filter((p) => p.stock < p.min).sort((a, z) => a.stock / a.min - z.stock / z.min) : []

  const goal = (db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'dailyGoal'").get(b) as { value: string } | undefined)
  return c.json({
    today: { date: today, sales: t.sales.total ?? 0, tickets: t.sales.tickets ?? 0, vsYesterday: pctChange(t.sales.total ?? 0, y.sales.total ?? 0), goal: goal ? Number(JSON.parse(goal.value)) : null, bulk: sellsBulk ? bulk.v : null },
    month: {
      from: monthStart, sales: mo.sales.total ?? 0, out: egresos(mo), profit: mo.profit, tickets: mo.sales.tickets ?? 0,
      vsPrev: { sales: pctChange(mo.sales.total ?? 0, pm.sales.total ?? 0), out: pctChange(egresos(mo), egresos(pm)), profit: pctChange(mo.profit, pm.profit) },
      avgTicket: mo.sales.tickets ? Math.round((mo.sales.total ?? 0) / mo.sales.tickets) : 0,
    },
    real: realMoney(db, b, monthStart, today),
    series, topProfit, lowStock: low.slice(0, 12), lowStockCount: low.length,
  })
})

/** Meta de ventas del día (la pone el dueño). */
dashboard.put('/dashboard/goal', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ amount: z.number().int().min(0).max(1_000_000_000) }), await body(c))
  db.prepare("INSERT INTO business_settings (business_id, key, value) VALUES (?, 'dailyGoal', ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value").run(u.business_id, JSON.stringify(d.amount))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'negocio.meta_diaria', newValue: d })
  return c.json({ goal: d.amount })
})

/** Ventas por día y por periodo, con filtro por cajero: tarjetas, tickets del día y cajeros. */
dashboard.get('/reports/board', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const b = c.get('session').user.business_id
  const today = localDate(now())
  const from = c.req.query('from') ?? `${today.slice(0, 8)}01`
  const to = c.req.query('to') ?? today
  const day = c.req.query('day') ?? (today >= from && today <= to ? today : to)
  const cashier = c.req.query('cashierId') || null
  const cf = cashier ? 'AND s.cashier_id = ?' : ''
  const ca = cashier ? [cashier] : []
  const kpis = (f: string, t: string) => {
    const { start, end } = range(f, t)
    const s = db.prepare(`SELECT COALESCE(SUM(s.total),0) total, COUNT(*) n FROM sales s WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? ${cf}`).get(b, start, end, ...ca) as { total: number; n: number }
    const it = db.prepare(`SELECT COALESCE(SUM(si.cost),0) cost, COALESCE(SUM(CASE WHEN p.unit IS NOT NULL AND p.unit != 'pieza' THEN si.total ELSE 0 END),0) bulk FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? ${cf}`).get(b, start, end, ...ca) as { cost: number; bulk: number }
    return { sales: s.total, tickets: s.n, cost: it.cost, profit: s.total - it.cost, avgTicket: s.n ? Math.round(s.total / s.n) : 0, bulk: it.bulk }
  }
  const { start, end } = range(day, day)
  const tickets = (db.prepare(`SELECT s.id, s.folio, s.created_at at, s.payment_method method, s.total, s.status, u.name cashier, cu.name customer, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) items FROM sales s JOIN users u ON u.id = s.cashier_id LEFT JOIN customers cu ON cu.id = s.customer_id WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? ${cf} ORDER BY s.created_at DESC LIMIT 500`).all(b, start, end, ...ca) as { id: string; method: string }[])
    .map((t) => {
      const parts = db.prepare('SELECT method, amount FROM sale_payments WHERE sale_id = ?').all(t.id) as { method: string; amount: number }[]
      return { ...t, method: parts.length > 1 ? parts.map((p) => p.method).join(' + ') : t.method }
    })
  const cashiers = db.prepare("SELECT DISTINCT u.id, u.name FROM sales s JOIN users u ON u.id = s.cashier_id WHERE s.business_id = ? ORDER BY u.name").all(b)
  const sellsBulk = !!db.prepare("SELECT 1 FROM products WHERE business_id = ? AND unit != 'pieza' AND sellable = 1 LIMIT 1").get(b)
  return c.json({ from, to, day, cashierId: cashier, cashiers, sellsBulk, dayKpis: kpis(day, day), period: kpis(from, to), tickets })
})

const MOVE_LABEL: Record<string, string> = {
  compra: 'Entrada por compra', venta: 'Salida por venta', cancelacion: 'Regresa por cancelación', merma: 'Merma', traspaso_salida: 'Traspaso (sale)', traspaso_entrada: 'Traspaso (entra)',
  ajuste: 'Ajuste de inventario', consumo: 'Consumo (receta)', devolucion: 'Devolución', fraccion_salida: 'Fraccionado (sale)', fraccion_entrada: 'Fraccionado (entra)',
}

/** Bitácora de movimientos de inventario del periodo, con quién lo hizo. Sin ventas por default (ya salen en tickets). */
dashboard.get('/reports/stock-log', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const b = c.get('session').user.business_id
  const today = localDate(now())
  const { start, end } = range(c.req.query('from') ?? `${today.slice(0, 8)}01`, c.req.query('to') ?? today)
  const withSales = c.req.query('sales') === '1'
  const rows = db.prepare(`SELECT m.created_at at, m.type, m.qty_milli, m.cost, m.reason, p.name product, p.unit, u.name user FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id WHERE m.business_id = ? AND m.created_at >= ? AND m.created_at < ? ${withSales ? '' : "AND m.type NOT IN ('venta','consumo')"} ORDER BY m.created_at DESC LIMIT 500`).all(b, start, end) as { at: string; type: string; qty_milli: number; cost: number; reason: string | null; product: string; unit: string; user: string | null }[]
  return c.json({ movements: rows.map((r) => ({ at: r.at, type: r.type, label: MOVE_LABEL[r.type] ?? r.type, product: r.product, unit: r.unit, qty: fromMilli(r.qty_milli), cost: r.cost, reason: r.reason, user: r.user ?? '—' })) })
})

/** Tendencia diaria de ingresos contra egresos y la ganancia real por forma de cobro (máximo 62 días por día; más largo, por mes). */
dashboard.get('/finance/trend', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const b = c.get('session').user.business_id
  const today = localDate(now())
  const from = c.req.query('from') ?? `${today.slice(0, 8)}01`
  const to = c.req.query('to') ?? today
  const end = to > today ? today : to
  const days = (Date.parse(end) - Date.parse(from)) / 86_400_000 + 1
  const byMonth = days > 62
  const points: { label: string; from: string; to: string; income: number; out: number; profit: number }[] = []
  for (let d = from; d <= end;) {
    const last = byMonth ? (() => { const x = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10); return x > end ? end : x })() : d
    const s = periodSummary(db, b, d, last)
    points.push({ label: byMonth ? d.slice(0, 7) : d, from: d, to: last, income: s.sales.total ?? 0, out: s.expenses + s.commissions + s.waste + s.refunds, profit: s.profit })
    d = shiftDate(last, 1)
  }
  return c.json({ from, to: end, by: byMonth ? 'mes' : 'dia', points, real: realMoney(db, b, from, end) })
})
