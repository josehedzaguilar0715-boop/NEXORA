import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, parse, requireFinance, type Env } from './context.js'
import type { Db } from './db.js'
import { balanceSheet, cashFlow, incomeStatement } from './accounting.js'
import { pendingFor } from './payouts.js'
import { restockNeeded } from './finance.js'
import { wholeBusinessOnly } from './scope.js'
import { bad, conflict, iso, localDate, newId, notFound } from './util.js'

/**
 * Finanzas inteligentes: una sola vista con lo que el dueño necesita decidir (entró, salió, ganancia real, disponible,
 * por reservar, retirable), un reparto del dinero que el DUEÑO define (nada impuesto) y el registro de cada retiro.
 * Todo sale de los registros reales que ya existen. Los estados financieros clásicos siguen en /accounting/* como reportes.
 * Importes en centavos.
 */
export const finanzas = new Hono<Env>()
// Junta todas las sucursales: dueño y administrador autorizado (o negocio de una sola sucursal).
finanzas.use('/finanzas/*', wholeBusinessOnly)

const DATE = /^\d{4}-\d{2}-\d{2}$/
const KINDS = ['operacion', 'gastos', 'nomina', 'ahorro', 'reinversion', 'inversion', 'retiro', 'otro'] as const
const BASES = { ganancia: 'ganancia real del periodo', ganancia_bruta: 'ganancia bruta (ventas menos lo que costó lo vendido)', ventas: 'ventas del periodo' } as const

export interface PlanItem { name: string; kind: (typeof KINDS)[number]; mode: 'pct' | 'monto'; value: number }
export interface PlanRow { id: string; name: string; base: keyof typeof BASES; items: PlanItem[]; active: boolean; legacy: boolean; createdAt: string; updatedAt: string }

/** Reparte `base` entre las partidas: primero los montos fijos, el resto por porcentaje. Función pura (la usa también la vista previa). */
export function applyPlan(base: number, items: PlanItem[]) {
  const pool = Math.max(0, Math.round(base))
  const fixed = items.filter((i) => i.mode === 'monto')
  const pcts = items.filter((i) => i.mode === 'pct')
  const fixedSum = fixed.reduce((a, i) => a + i.value, 0)
  const pctSum = pcts.reduce((a, i) => a + i.value, 0)
  const afterFixed = Math.max(0, pool - fixedSum)
  const lines = items.map((i) => ({ ...i, amount: i.mode === 'monto' ? Math.min(i.value, pool) : Math.floor((afterFixed * i.value) / 100) }))
  // Lo que se pierde al redondear va a la partida porcentual más grande, para que todo cuadre al centavo.
  if (pcts.length && pctSum === 100) {
    const left = afterFixed - lines.filter((l) => l.mode === 'pct').reduce((a, l) => a + l.amount, 0)
    const big = lines.filter((l) => l.mode === 'pct').sort((a, b) => b.value - a.value)[0]
    if (big && left) big.amount += left
  }
  const notes: string[] = []
  if (pcts.length && pctSum !== 100) notes.push(pctSum < 100 ? `Faltan ${100 - pctSum} % por repartir.` : `Te pasas por ${pctSum - 100} %.`)
  if (fixedSum > pool) notes.push('Los montos fijos no alcanzan con lo que hay para repartir.')
  return { base: pool, lines, assigned: lines.reduce((a, l) => a + l.amount, 0), ok: notes.length === 0, notes }
}

const itemSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(KINDS),
  mode: z.enum(['pct', 'monto']),
  value: z.number().int().min(0).max(1_000_000_000),
}).refine((i) => i.mode === 'monto' || i.value <= 100, 'Un porcentaje no puede pasar de 100.')
const planSchema = z.object({ name: z.string().trim().min(2).max(40), base: z.enum(['ganancia', 'ganancia_bruta', 'ventas']), items: z.array(itemSchema).min(1).max(12) })

function checkPlan(items: PlanItem[]) {
  const pcts = items.filter((i) => i.mode === 'pct')
  const sum = pcts.reduce((a, i) => a + i.value, 0)
  if (pcts.length && sum !== 100) throw bad(sum < 100 ? `Los porcentajes suman ${sum} %: faltan ${100 - sum} % para llegar a 100 %.` : `Los porcentajes suman ${sum} %: te pasas por ${sum - 100} %.`, 'suma_invalida')
  const names = items.map((i) => i.name.toLowerCase())
  if (new Set(names).size !== names.length) throw bad('Dos partidas tienen el mismo nombre.')
}

const planOf = (r: { id: string; name: string; base: string; items: string; active: number; legacy: number; created_at: string; updated_at: string }): PlanRow => ({
  id: r.id, name: r.name, base: r.base as PlanRow['base'], items: JSON.parse(r.items), active: !!r.active, legacy: !!r.legacy, createdAt: r.created_at, updatedAt: r.updated_at,
})
export const listPlans = (db: Db, businessId: string) => (db.prepare('SELECT * FROM distribution_plans WHERE business_id = ? ORDER BY legacy, created_at').all(businessId) as Parameters<typeof planOf>[0][]).map(planOf)

/** Retiros del dueño que no pasaron por una caja (los de caja ya están en el flujo como «retiros»). */
const looseWithdrawals = (db: Db, businessId: string, from?: string, to?: string) =>
  (db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM owner_withdrawals WHERE business_id = ? AND cash_movement_id IS NULL ${from ? 'AND date BETWEEN ? AND ?' : ''}`).get(...(from ? [businessId, from, to] : [businessId])) as { v: number }).v

function period(q: (k: string) => string | undefined, today: string) {
  const from = q('from') ?? `${today.slice(0, 8)}01`
  const to = q('to') ?? today
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw bad('Periodo no válido.')
  return { from, to }
}

/** Todo lo que el dueño necesita ver, calculado de los registros reales. */
export function resumenInteligente(db: Db, businessId: string, from: string, to: string, today: string) {
  const is = incomeStatement(db, businessId, from, to)
  const flow = cashFlow(db, businessId, from, to)
  const bal = balanceSheet(db, businessId)
  const loosePeriod = looseWithdrawals(db, businessId, from, to)
  const entro = flow.totalIn
  const salio = flow.totalOut + loosePeriod
  const retiradoPeriodo = (db.prepare('SELECT COALESCE(SUM(amount),0) v FROM owner_withdrawals WHERE business_id = ? AND date BETWEEN ? AND ?').get(businessId, from, to) as { v: number }).v
  // Dinero disponible según los registros de NEXORA: todo lo que ha entrado menos todo lo que ha salido (efectivo y banco).
  const all = cashFlow(db, businessId, '2000-01-01', today)
  const disponible = all.net - looseWithdrawals(db, businessId)
  // Lo que hay que apartar antes de retirar.
  const staff = db.prepare('SELECT id FROM users WHERE business_id = ?').all(businessId) as { id: string }[]
  const nomina = Math.max(0, staff.reduce((a, s) => { const p = pendingFor(db, businessId, s.id); return a + p.commission + p.adjustments }, 0))
  const biz = db.prepare('SELECT reserve_days FROM businesses WHERE id = ?').get(businessId) as { reserve_days: number | null }
  const reserveDays = biz.reserve_days ?? 30
  const monthlyFixed = (db.prepare('SELECT COALESCE(SUM(monthly_amount),0) m FROM fixed_expenses WHERE business_id = ? AND active = 1').get(businessId) as { m: number }).m
  const reservaFijos = Math.round((monthlyFixed * reserveDays) / 30)
  const reponer = restockNeeded(db, businessId).total
  const partes = [
    { key: 'proveedores', label: 'Por pagar a proveedores', amount: bal.payables, why: 'Compras que todavía debes.' },
    { key: 'personal', label: 'Comisiones y pagos pendientes al personal', amount: nomina, why: 'Ya lo ganaron y aún no se les paga.' },
    { key: 'clientes', label: 'Anticipos y saldos a favor de clientes', amount: bal.customerCredit + bal.layawayDeposits, why: 'Dinero que recibiste y todavía no es tuyo.' },
    { key: 'fijos', label: `Gastos fijos de ${reserveDays} días`, amount: reservaFijos, why: 'Para que el negocio no se quede sin pagar renta, luz y demás.' },
    { key: 'inventario', label: 'Reponer lo que se está acabando', amount: reponer, why: 'Productos por debajo de su mínimo.' },
  ]
  const porReservar = partes.reduce((a, p) => a + p.amount, 0)
  const libre = Math.max(0, disponible - porReservar)
  // Nunca se sugiere sacar más que la ganancia que todavía no se ha retirado en el periodo.
  const gananciaSinRetirar = Math.max(0, is.netProfit - retiradoPeriodo)
  const retirable = Math.min(libre, gananciaSinRetirar)
  const motivos: string[] = []
  if (is.netProfit <= 0) motivos.push('En este periodo el negocio todavía no deja ganancia: lo más sano es no retirar.')
  else if (disponible <= porReservar) motivos.push('Todo el dinero disponible ya está comprometido (pagos, personal, gastos fijos o inventario).')
  else if (libre > gananciaSinRetirar) motivos.push('Hay dinero en caja, pero parte es capital del negocio: solo se sugiere retirar la ganancia de este periodo.')
  else motivos.push('Es lo que queda después de apartar lo que el negocio necesita.')
  if (retiradoPeriodo > 0) motivos.push('Ya descuenta lo que retiraste en este periodo.')
  const active = listPlans(db, businessId).find((p) => p.active) ?? null
  let plan: (ReturnType<typeof applyPlan> & { id: string; name: string; baseLabel: string }) | null = null
  if (active) {
    const base = active.base === 'ganancia' ? is.netProfit : active.base === 'ganancia_bruta' ? is.grossProfit : is.netSales
    plan = { id: active.id, name: active.name, baseLabel: BASES[active.base], ...applyPlan(base, active.items) }
  }
  // El retiro sugerido es opcional; si el reparto tiene una partida de «retiro», se sugiere lo menor entre esa partida y lo retirable.
  const retiroPlan = plan?.lines.filter((l) => l.kind === 'retiro').reduce((a, l) => a + l.amount, 0)
  const sugerido = Math.max(0, plan && retiroPlan !== undefined && plan.lines.some((l) => l.kind === 'retiro') ? Math.min(retirable, retiroPlan) : retirable)
  return {
    from, to,
    vendido: is.netSales, entro, salio, gananciaReal: is.netProfit,
    retiradoPeriodo, disponible, porReservar: { total: porReservar, partes }, libre, retirable,
    sugerido: { monto: sugerido, motivos, opcional: true },
    plan,
    avisos: [
      ...(disponible < 0 ? ['Según tus registros salió más dinero del que entró: revisa si falta capturar ventas o depósitos.'] : []),
      ...(is.netProfit > 0 && entro < is.netProfit ? ['Tienes ganancia en papel, pero buena parte sigue por cobrar (fiado) o en inventario: ganancia no es lo mismo que dinero en mano.'] : []),
    ],
  }
}

finanzas.get('/finanzas/resumen', requireFinance('finance'), (c) => {
  const { db, now } = c.get('deps')
  const today = localDate(now())
  const { from, to } = period((k) => c.req.query(k), today)
  return c.json(resumenInteligente(db, c.get('session').user.business_id, from, to, today))
})

// ---------- Reparto del dinero (lo define el dueño) ----------

finanzas.get('/finanzas/planes', requireFinance('finance'), (c) => c.json({ plans: listPlans(c.get('deps').db, c.get('session').user.business_id), kinds: KINDS, bases: BASES }))

/** Vista previa en vivo: reparte `base` (o lo de un periodo) sin guardar nada. */
finanzas.post('/finanzas/planes/vista', requireFinance('finance'), async (c) => {
  const { db, now } = c.get('deps')
  const d = parse(z.object({ base: z.enum(['ganancia', 'ganancia_bruta', 'ventas']), items: z.array(itemSchema).min(1).max(12), from: z.string().regex(DATE).optional(), to: z.string().regex(DATE).optional() }), await body(c))
  const today = localDate(now())
  const { from, to } = { from: d.from ?? `${today.slice(0, 8)}01`, to: d.to ?? today }
  const is = incomeStatement(db, c.get('session').user.business_id, from, to)
  const base = d.base === 'ganancia' ? is.netProfit : d.base === 'ganancia_bruta' ? is.grossProfit : is.netSales
  return c.json({ from, to, baseLabel: BASES[d.base], ...applyPlan(base, d.items) })
})

finanzas.post('/finanzas/planes', requireFinance('manage'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(planSchema, await body(c))
  checkPlan(d.items)
  if ((db.prepare('SELECT COUNT(*) n FROM distribution_plans WHERE business_id = ?').get(u.business_id) as { n: number }).n >= 20) throw bad('Ya tienes 20 configuraciones guardadas. Borra alguna que no uses.')
  const id = newId()
  const t = iso(now())
  db.prepare('INSERT INTO distribution_plans (id, business_id, name, base, items, active, legacy, created_by, created_at, updated_at) VALUES (?,?,?,?,?,0,0,?,?,?)').run(id, u.business_id, d.name, d.base, JSON.stringify(d.items), u.id, t, t)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'finanzas.reparto_creado', entity: 'distribution_plan', entityId: id, newValue: d })
  return c.json({ plan: listPlans(db, u.business_id).find((p) => p.id === id) }, 201)
})

function loadPlan(c: { get: (k: 'deps') => { db: Db }; req: { param: (k: string) => string } }, businessId: string) {
  const r = c.get('deps').db.prepare('SELECT * FROM distribution_plans WHERE id = ? AND business_id = ?').get(c.req.param('id'), businessId) as Parameters<typeof planOf>[0] | undefined
  if (!r) throw notFound('Esa configuración no existe.')
  return planOf(r)
}

finanzas.put('/finanzas/planes/:id', requireFinance('manage'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const old = loadPlan(c, u.business_id)
  if (old.legacy) throw conflict('El «Plan anterior» se conserva tal cual como historia. Duplícalo para crear uno propio.', 'plan_historico')
  const d = parse(planSchema, await body(c))
  checkPlan(d.items)
  db.prepare('UPDATE distribution_plans SET name = ?, base = ?, items = ?, updated_at = ? WHERE id = ?').run(d.name, d.base, JSON.stringify(d.items), iso(now()), old.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'finanzas.reparto_cambiado', entity: 'distribution_plan', entityId: old.id, oldValue: { name: old.name, base: old.base, items: old.items }, newValue: d })
  return c.json({ plan: loadPlan(c, u.business_id) })
})

finanzas.post('/finanzas/planes/:id/activar', requireFinance('manage'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = loadPlan(c, u.business_id)
  const { active } = parse(z.object({ active: z.boolean().default(true) }), await body(c).catch(() => ({})))
  db.transaction(() => {
    db.prepare('UPDATE distribution_plans SET active = 0 WHERE business_id = ?').run(u.business_id)
    if (active) db.prepare('UPDATE distribution_plans SET active = 1, updated_at = ? WHERE id = ?').run(iso(now()), p.id)
  })()
  audit(db, now, { businessId: u.business_id, userId: u.id, action: active ? 'finanzas.reparto_activado' : 'finanzas.reparto_desactivado', entity: 'distribution_plan', entityId: p.id, newValue: { name: p.name } })
  return c.json({ plans: listPlans(db, u.business_id) })
})

finanzas.delete('/finanzas/planes/:id', requireFinance('manage'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const p = loadPlan(c, u.business_id)
  if (p.legacy) throw conflict('El «Plan anterior» se conserva como historia y no se borra.', 'plan_historico')
  db.prepare('DELETE FROM distribution_plans WHERE id = ?').run(p.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'finanzas.reparto_borrado', entity: 'distribution_plan', entityId: p.id, oldValue: { name: p.name, items: p.items } })
  return c.json({ ok: true })
})

// ---------- Retiros del dueño ----------

finanzas.get('/finanzas/retiros', requireFinance('finance'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const { from, to } = period((k) => c.req.query(k), localDate(now()))
  const rows = db.prepare('SELECT w.id, w.amount, w.category, w.reason, w.method, w.suggested_amount AS suggestedAmount, w.decision, w.exceeded, w.date, w.created_at AS createdAt, us.name AS responsible FROM owner_withdrawals w JOIN users us ON us.id = w.responsible_id WHERE w.business_id = ? AND w.date BETWEEN ? AND ? ORDER BY w.date DESC, w.created_at DESC').all(u.business_id, from, to)
  return c.json({ withdrawals: rows, total: (rows as { amount: number }[]).reduce((a, r) => a + r.amount, 0) })
})

finanzas.post('/finanzas/retiros', requireFinance('manage'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({
    amount: z.number().int().positive().max(1_000_000_000),
    category: z.string().trim().min(2).max(40),
    reason: z.string().trim().min(3).max(200),
    method: z.enum(['efectivo', 'transferencia']),
    date: z.string().regex(DATE).optional(),
    shiftId: z.string().optional(),
    force: z.boolean().optional(),
  }), await body(c))
  const today = localDate(now())
  const date = d.date ?? today
  if (date > today) throw bad('La fecha no puede ser futura.')
  const r = resumenInteligente(db, u.business_id, `${date.slice(0, 8)}01`, date, today)
  const exceeded = d.amount > r.retirable
  // Es dinero del dueño: puede sacar más, pero debe confirmarlo sabiendo que descapitaliza el negocio.
  if (exceeded && !d.force) throw conflict(`Esto es más de lo que conviene retirar (${(r.retirable / 100).toFixed(2)}). Si aun así lo necesitas, confírmalo.`, 'excede_retirable')
  const suggested = r.sugerido.monto
  const decision = d.amount === suggested && suggested > 0 ? 'aceptado' : suggested > 0 ? 'modificado' : 'propio'
  const id = newId()
  const t = iso(now())
  db.transaction(() => {
    let movementId: string | null = null
    // Si sale de una caja abierta, también baja en esa caja para que el corte no marque faltante.
    if (d.method === 'efectivo') {
      const open = db.prepare("SELECT id FROM shifts WHERE business_id = ? AND status = 'abierto'").all(u.business_id) as { id: string }[]
      const shift = d.shiftId ? open.find((s) => s.id === d.shiftId) : open.length === 1 ? open[0] : undefined
      if (d.shiftId && !shift) throw bad('Esa caja no está abierta.')
      if (open.length > 1 && !shift) throw bad('Hay varias cajas abiertas: elige de cuál sale el efectivo.', 'elige_caja')
      if (shift) {
        movementId = newId()
        db.prepare("INSERT INTO cash_movements (id, shift_id, type, amount, reason, created_by, created_at, origin) VALUES (?,?,'retiro',?,?,?,?,'manual')").run(movementId, shift.id, d.amount, `Retiro del dueño: ${d.reason}`, u.id, t)
      }
    }
    db.prepare('INSERT INTO owner_withdrawals (id, business_id, amount, category, reason, method, responsible_id, cash_movement_id, suggested_amount, decision, exceeded, date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, u.business_id, d.amount, d.category, d.reason, d.method, u.id, movementId, suggested || null, decision, exceeded ? 1 : 0, date, t)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: 'finanzas.retiro', entity: 'owner_withdrawal', entityId: id, newValue: { amount: d.amount, category: d.category, method: d.method, decision, suggested, exceeded }, reason: d.reason })
  })()
  return c.json({ withdrawal: { id, amount: d.amount, decision, exceeded } }, 201)
})

/** El dueño rechazó la sugerencia: queda anotado (no se registra ningún retiro). */
finanzas.post('/finanzas/sugerencia/rechazar', requireFinance('manage'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ amount: z.number().int().min(0), reason: z.string().trim().max(200).optional() }), await body(c))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'finanzas.sugerencia_rechazada', newValue: { amount: d.amount }, reason: d.reason })
  return c.json({ ok: true })
})
