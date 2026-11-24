import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, canFinance, isManager, ownerOnly, parse, type C, type Env } from './context.js'
import { range } from './finance.js'
import { scopeBranch } from './scope.js'
import { bad, forbidden, localDate } from './util.js'

/**
 * Resumen OPERATIVO de la sucursal para el encargado: ventas del día, operaciones, qué se vendió, objetivo y comparación.
 * Por diseño NO incluye costos, utilidades, márgenes, retiros ni nada financiero confidencial: solo lo que se vendió.
 */
export const resumen = new Hono<Env>()

/** Dueño, encargado, o administrador con acceso al panel general. El empleado no. */
function allowed(c: C) {
  const u = c.get('session').user
  if (!(isManager(u) || canFinance(u, 'dashboard'))) throw forbidden('Este resumen es del dueño y de los encargados.')
}

const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

resumen.get('/sucursal/resumen', (c) => {
  allowed(c)
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const today = localDate(now())
  const date = c.req.query('date') ?? today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) throw bad('Fecha no válida.')
  const branchId = scopeBranch(c) // encargado: la suya; dueño/administrador: la pedida o todas
  const bf = branchId ? 'AND s.branch_id = ?' : ''
  const args = (a: string, b: string) => (branchId ? [u.business_id, a, b, branchId] : [u.business_id, a, b])
  const day = (d: string) => {
    const { start, end } = range(d, d)
    const r = db.prepare(`SELECT COALESCE(SUM(CASE WHEN s.status = 'completada' THEN s.total END),0) sales, COUNT(CASE WHEN s.status = 'completada' THEN 1 END) tickets, COUNT(CASE WHEN s.status = 'cancelada' THEN 1 END) cancelled FROM sales s WHERE s.business_id = ? AND s.created_at >= ? AND s.created_at < ? ${bf}`).get(...args(start, end)) as { sales: number; tickets: number; cancelled: number }
    return { ...r, avgTicket: r.tickets ? Math.round(r.sales / r.tickets) : 0 }
  }
  const t = day(date)
  const { start, end } = range(date, date)
  // Qué se vendió (productos y servicios) con cantidades e importe cobrado; nunca costos.
  const sold = db.prepare(`SELECT si.description, SUM(si.quantity) qty, SUM(si.total) total FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND s.created_at < ? ${bf} GROUP BY COALESCE(si.product_id, si.service_id, si.description) ORDER BY total DESC LIMIT 12`).all(...args(start, end)) as { description: string; qty: number; total: number }[]
  // Comparaciones solo cuando hubo actividad en ese periodo (si no, no hay con qué comparar).
  const cmp = (label: string, d: string) => { const p = day(d); return p.tickets > 0 ? { label, date: d, sales: p.sales, tickets: p.tickets, salesChangePct: p.sales ? Math.round(((t.sales - p.sales) / p.sales) * 1000) / 10 : null } : null }
  const prev7 = [1, 2, 3, 4, 5, 6, 7].map((n) => day(shiftDay(date, -n))).filter((x) => x.tickets > 0)
  const avg7 = prev7.length >= 3 ? { days: prev7.length, sales: Math.round(prev7.reduce((a, x) => a + x.sales, 0) / prev7.length), tickets: Math.round(prev7.reduce((a, x) => a + x.tickets, 0) / prev7.length) } : null
  // Objetivo operativo: meta de ventas del día de la sucursal (la fija el dueño). Con una sola sucursal vale la meta diaria del negocio.
  const goals = db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'branchGoals'").get(u.business_id) as { value: string } | undefined
  const g = goals ? (JSON.parse(goals.value) as Record<string, number>) : {}
  const nBranches = (db.prepare('SELECT COUNT(*) n FROM branches WHERE business_id = ? AND active = 1').get(u.business_id) as { n: number }).n
  const daily = db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'dailyGoal'").get(u.business_id) as { value: string } | undefined
  const goalAmount = branchId ? g[branchId] ?? (nBranches === 1 && daily ? Number(JSON.parse(daily.value)) : null) : null
  const branchName = branchId ? (db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId) as { name: string } | undefined)?.name ?? null : null
  const shiftsOpen = (db.prepare(`SELECT COUNT(*) n FROM shifts WHERE business_id = ? AND status = 'abierto' ${branchId ? 'AND branch_id = ?' : ''}`).get(...(branchId ? [u.business_id, branchId] : [u.business_id])) as { n: number }).n
  return c.json({
    date, branch: branchId ? { id: branchId, name: branchName } : null, today: t, shiftsOpen,
    goal: goalAmount ? { amount: goalAmount, pct: Math.min(999, Math.round((t.sales / goalAmount) * 100)), missing: Math.max(0, goalAmount - t.sales) } : null,
    sold, comparison: { yesterday: cmp('Ayer', shiftDay(date, -1)), lastWeek: cmp('Mismo día de la semana pasada', shiftDay(date, -7)), avg7 },
    notes: [
      ...(goalAmount ? [] : branchId ? ['Todavía no hay un objetivo de ventas para esta sucursal: el dueño puede fijarlo.'] : []),
      ...(t.tickets === 0 ? ['Todavía no hay ventas en este día.'] : []),
    ],
  })
})

/** El dueño fija el objetivo de ventas diario de una sucursal. */
resumen.put('/sucursal/meta', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ branchId: z.string(), amount: z.number().int().min(0).max(1_000_000_000) }), await body(c))
  if (!db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(d.branchId, u.business_id)) throw bad('Esa sucursal no existe.')
  const cur = db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'branchGoals'").get(u.business_id) as { value: string } | undefined
  const goals = cur ? (JSON.parse(cur.value) as Record<string, number>) : {}
  const old = goals[d.branchId] ?? null
  if (d.amount > 0) goals[d.branchId] = d.amount; else delete goals[d.branchId]
  db.prepare("INSERT INTO business_settings (business_id, key, value) VALUES (?, 'branchGoals', ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value").run(u.business_id, JSON.stringify(goals))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'sucursal.meta', entity: 'branch', entityId: d.branchId, oldValue: old, newValue: d.amount })
  return c.json({ goal: d.amount || null })
})
