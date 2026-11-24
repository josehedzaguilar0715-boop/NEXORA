import { Hono } from 'hono'
import { requireFinance, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { range } from './finance.js'
import { stockOf } from './inventory.js'
import { wholeBusinessOnly } from './scope.js'
import { bad, localDate } from './util.js'

/**
 * Automatizaciones por giro. REGLA: solo se calcula y se recomienda con lo que el negocio YA registró.
 * Cuando falta algo, la respuesta lo dice (`falta`) y NO se da recomendación sobre eso.
 * Importes en centavos. Los cálculos son del servidor; la pantalla solo los muestra.
 */
export const auto = new Hono<Env>()
auto.use('/auto/*', wholeBusinessOnly)

const DATE = /^\d{4}-\d{2}-\d{2}$/
function period(q: (k: string) => string | undefined, today: string) {
  const from = q('from') ?? `${today.slice(0, 8)}01`
  const to = q('to') ?? today
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw bad('Periodo no válido.')
  return { from, to, ...range(from, to) }
}
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

// ------------------------------------------------------------------ Servicios (barbería, uñas…)

/** Rentabilidad por servicio y por persona: ingreso − materiales/costo − comisión. */
export function rentabilidadServicios(db: Db, businessId: string, start: string, end: string) {
  const rows = db.prepare(`SELECT si.service_id id, s.name, SUM(si.quantity) sold, SUM(si.total) revenue, SUM(si.cost) cost,
      COALESCE(SUM((SELECT SUM(sc.amount) FROM sale_commissions sc WHERE sc.sale_item_id = si.id AND sc.status = 'vigente')),0) commission
    FROM sale_items si JOIN sales sa ON sa.id = si.sale_id JOIN services s ON s.id = si.service_id
    WHERE sa.business_id = ? AND sa.status = 'completada' AND sa.created_at >= ? AND sa.created_at < ? GROUP BY si.service_id`).all(businessId, start, end) as { id: string; name: string; sold: number; revenue: number; cost: number; commission: number }[]
  const services = db.prepare('SELECT id, name, cost FROM services WHERE business_id = ? AND active = 1').all(businessId) as { id: string; name: string; cost: number }[]
  const recipe = db.prepare('SELECT r.product_id id, p.name, p.unit, r.qty_micro, p.last_cost FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.owner_id = ?')
  const known = new Map<string, boolean>()
  const materials = new Map<string, { name: string; unit: string; qty: number; cost: number }[]>()
  for (const s of services) {
    const m = (recipe.all(s.id) as { name: string; unit: string; qty_micro: number; last_cost: number }[]).map((r) => ({ name: r.name, unit: r.unit, qty: r.qty_micro / 1e6, cost: Math.round((r.qty_micro * r.last_cost) / 1e6) }))
    materials.set(s.id, m)
    known.set(s.id, s.cost > 0 || m.length > 0)
  }
  const byService = rows.map((r) => {
    const profit = r.revenue - r.cost - r.commission
    return { id: r.id, name: r.name, sold: r.sold, revenue: r.revenue, cost: r.cost, commission: r.commission, profit, marginPct: pct(profit, r.revenue), costKnown: known.get(r.id) ?? false, materials: materials.get(r.id) ?? [], unitCost: r.sold ? Math.round(r.cost / r.sold) : 0 }
  }).sort((a, b) => b.profit - a.profit)
  const byStaff = (db.prepare(`SELECT COALESCE(si.staff_id, (SELECT sc.staff_id FROM sale_commissions sc WHERE sc.sale_item_id = si.id LIMIT 1)) staff_id, SUM(si.quantity) services, SUM(si.total) revenue, SUM(si.cost) cost,
      COALESCE(SUM((SELECT SUM(sc.amount) FROM sale_commissions sc WHERE sc.sale_item_id = si.id AND sc.status = 'vigente')),0) commission
    FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
    WHERE si.service_id IS NOT NULL AND sa.business_id = ? AND sa.status = 'completada' AND sa.created_at >= ? AND sa.created_at < ? GROUP BY 1`).all(businessId, start, end) as { staff_id: string | null; services: number; revenue: number; cost: number; commission: number }[])
    .map((r) => {
      const name = r.staff_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(r.staff_id) as { name: string } | undefined)?.name ?? 'Persona eliminada' : null
      const profit = r.revenue - r.cost - r.commission
      return { staffId: r.staff_id, name, services: r.services, revenue: r.revenue, cost: r.cost, commission: r.commission, profit, marginPct: pct(profit, r.revenue) }
    }).sort((a, b) => b.profit - a.profit)
  const falta: string[] = []
  const sinCosto = services.filter((s) => !known.get(s.id) && rows.some((r) => r.id === s.id)).map((s) => s.name)
  if (sinCosto.length) falta.push(`Captura el costo o los materiales de: ${sinCosto.join(', ')}. Mientras tanto su ganancia se ve más alta de lo real.`)
  if (byStaff.some((x) => !x.staffId)) falta.push('Parte de las ventas no tiene a quién atendió registrado (ventas anteriores). Desde ahora cada servicio cobrado guarda quién lo hizo.')
  const consejos: string[] = []
  // Solo se aconseja sobre servicios con costo capturado.
  for (const s of byService.filter((x) => x.costKnown && x.sold >= 3 && x.marginPct !== null)) {
    if (s.marginPct! < 30) consejos.push(`«${s.name}» deja ${s.marginPct}% de ganancia después de materiales y comisión: conviene revisar su precio o sus materiales.`)
  }
  const best = byService.find((x) => x.costKnown && x.sold >= 3)
  if (best) consejos.push(`El servicio que más ganancia deja es «${best.name}» (${best.marginPct}%).`)
  return { services: byService, staff: byStaff, falta, consejos }
}

auto.get('/auto/servicios', requireFinance('finance'), (c) => {
  const { db, now } = c.get('deps')
  const { start, end, from, to } = period((k) => c.req.query(k), localDate(now()))
  return c.json({ from, to, ...rentabilidadServicios(db, c.get('session').user.business_id, start, end) })
})

// ------------------------------------------------------------------ Seguimiento de clientes

/** Clientes registrados que dejaron de venir (2 o más visitas) y los que vinieron una sola vez y no regresaron. */
export function seguimientoClientes(db: Db, businessId: string, nowDate: Date, days: number) {
  const since = (n: number) => new Date(nowDate.getTime() - n * 86_400_000).toISOString()
  const biz = (db.prepare('SELECT name FROM businesses WHERE id = ?').get(businessId) as { name: string }).name
  const rows = db.prepare(`SELECT c.id, c.name, c.phone, COUNT(DISTINCT sa.id) visits, MAX(sa.created_at) last, SUM(sa.total) spent
    FROM sales sa JOIN customers c ON c.id = sa.customer_id WHERE sa.business_id = ? AND sa.status = 'completada' AND c.active = 1 GROUP BY c.id`).all(businessId) as { id: string; name: string; phone: string | null; visits: number; last: string; spent: number }[]
  const upcoming = db.prepare("SELECT 1 FROM appointments WHERE business_id = ? AND customer_id = ? AND status IN ('pendiente','confirmada','en_atencion') AND starts_at > ? LIMIT 1")
  const view = (r: (typeof rows)[number], msg: string) => ({
    id: r.id, name: r.name, phone: r.phone, visits: r.visits, lastVisit: r.last, daysAgo: Math.floor((nowDate.getTime() - new Date(r.last).getTime()) / 86_400_000), spent: r.spent,
    message: msg, whatsapp: r.phone ? `https://wa.me/52${r.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(msg)}` : null,
  })
  const pend = rows.filter((r) => !upcoming.get(businessId, r.id, nowDate.toISOString()))
  const lapsed = pend.filter((r) => r.visits >= 2 && r.last < since(days)).sort((a, b) => b.spent - a.spent).map((r) => view(r, `Hola ${r.name.split(' ')[0]}, en ${biz} hace tiempo que no te vemos. ¿Te agendamos?`))
  const once = pend.filter((r) => r.visits === 1 && r.last < since(14) && r.last >= since(90)).map((r) => view(r, `Hola ${r.name.split(' ')[0]}, gracias por visitarnos en ${biz}. ¿Cómo te fue? Cuando quieras te agendamos de nuevo.`))
  return { days, registered: rows.length, lapsed, once, falta: rows.length === 0 ? ['Todavía no hay clientes registrados en ventas. Elige el nombre del cliente al cobrar para poder darle seguimiento.'] : [] }
}

auto.get('/auto/clientes', requirePerm('customers_credit'), (c) => {
  const { db, now } = c.get('deps')
  const days = Math.min(365, Math.max(14, Math.round(Number(c.req.query('days') ?? 45)) || 45))
  return c.json(seguimientoClientes(db, c.get('session').user.business_id, now(), days))
})

// ------------------------------------------------------------------ Restaurante: platillos, ingredientes, desperdicio

export function rentabilidadPlatillos(db: Db, businessId: string, start: string, end: string, nowDate: Date) {
  const dishes = db.prepare("SELECT p.id, p.name, p.price FROM products p WHERE p.business_id = ? AND p.active = 1 AND p.sellable = 1 AND EXISTS (SELECT 1 FROM recipes r WHERE r.owner_id = p.id)").all(businessId) as { id: string; name: string; price: number }[]
  const ing = db.prepare('SELECT r.product_id id, p.name, p.unit, r.qty_micro, p.last_cost FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.owner_id = ?')
  const sold = db.prepare(`SELECT COALESCE(SUM(si.quantity),0) qty, COALESCE(SUM(si.total),0) revenue, COALESCE(SUM(si.cost),0) cost FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
    WHERE si.product_id = ? AND sa.status = 'completada' AND sa.created_at >= ? AND sa.created_at < ?`)
  const falta: string[] = []
  const platillos = dishes.map((d) => {
    const parts = (ing.all(d.id) as { id: string; name: string; unit: string; qty_micro: number; last_cost: number }[]).map((r) => ({ id: r.id, name: r.name, unit: r.unit, qty: r.qty_micro / 1e6, cost: Math.round((r.qty_micro * r.last_cost) / 1e6), costKnown: r.last_cost > 0 }))
    const complete = parts.length > 0 && parts.every((x) => x.costKnown)
    const recipeCost = parts.reduce((a, x) => a + x.cost, 0)
    const s = sold.get(d.id, start, end) as { qty: number; revenue: number; cost: number }
    if (!complete) falta.push(`«${d.name}»: ${parts.filter((x) => !x.costKnown).map((x) => x.name).join(', ')} no tiene costo capturado.`)
    return {
      id: d.id, name: d.name, price: d.price, ingredients: parts, complete,
      recipeCost: complete ? recipeCost : null, marginPct: complete ? pct(d.price - recipeCost, d.price) : null, gain: complete ? d.price - recipeCost : null,
      sold: s.qty, revenue: s.revenue, realCost: s.cost, profit: s.revenue - s.cost,
    }
  }).sort((a, b) => b.profit - a.profit)
  const sinReceta = (db.prepare("SELECT name FROM products WHERE business_id = ? AND active = 1 AND sellable = 1 AND track_stock = 0 AND NOT EXISTS (SELECT 1 FROM recipes r WHERE r.owner_id = products.id) ORDER BY name").all(businessId) as { name: string }[]).map((x) => x.name)
  if (sinReceta.length) falta.push(`Sin receta (no se puede calcular su costo): ${sinReceta.slice(0, 8).join(', ')}${sinReceta.length > 8 ? '…' : ''}. Captura sus ingredientes en el platillo.`)
  // Ingredientes: consumo del periodo, existencias y cambio de costo (compras de los últimos 30 días contra los 30 anteriores).
  const used = db.prepare(`SELECT sm.product_id id, p.name, p.unit, SUM(-sm.qty_milli) qty, SUM(ABS(sm.cost)) cost FROM stock_movements sm JOIN products p ON p.id = sm.product_id
    WHERE sm.business_id = ? AND sm.type = 'consumo' AND sm.created_at >= ? AND sm.created_at < ? GROUP BY sm.product_id ORDER BY cost DESC`).all(businessId, start, end) as { id: string; name: string; unit: string; qty: number; cost: number }[]
  const avgCost = db.prepare('SELECT AVG(pi.unit_cost) a FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id WHERE pi.product_id = ? AND pu.created_at >= ? AND pu.created_at <= ? AND pi.unit_cost > 0')
  const d30 = new Date(nowDate.getTime() - 30 * 86_400_000).toISOString(), d60 = new Date(nowDate.getTime() - 60 * 86_400_000).toISOString()
  const branch = (db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1 ORDER BY created_at LIMIT 1').get(businessId) as { id: string } | undefined)?.id
  const mins = db.prepare('SELECT min_stock_milli m FROM products WHERE id = ?')
  const alertas: string[] = []
  const ingredientes = used.map((u) => {
    const now30 = (avgCost.get(u.id, d30, nowDate.toISOString()) as { a: number | null }).a
    const prev30 = (avgCost.get(u.id, d60, d30) as { a: number | null }).a
    const change = now30 && prev30 ? Math.round(((now30 - prev30) / prev30) * 1000) / 10 : null
    const stock = branch ? stockOf(db, branch, u.id) : 0
    const min = (mins.get(u.id) as { m: number }).m
    if (change !== null && change >= 10) alertas.push(`El costo de ${u.name} subió ${change}% frente al mes anterior: revisa el precio de los platillos que lo usan.`)
    if (min > 0 && stock < min) alertas.push(`${u.name} está por debajo de su mínimo: conviene reponerlo.`)
    return { id: u.id, name: u.name, unit: u.unit, used: u.qty / 1000, cost: u.cost, stock: stock / 1000, belowMin: min > 0 && stock < min, costChangePct: change }
  })
  for (const p of platillos.filter((x) => x.complete && x.marginPct !== null && x.marginPct < 30)) alertas.push(`«${p.name}» deja solo ${p.marginPct}% sobre su precio según su receta: conviene revisar precio o porciones.`)
  const waste = db.prepare(`SELECT sm.product_id id, p.name, p.unit, SUM(-sm.qty_milli) qty, SUM(ABS(sm.cost)) cost FROM stock_movements sm JOIN products p ON p.id = sm.product_id
    WHERE sm.business_id = ? AND sm.type = 'merma' AND sm.created_at >= ? AND sm.created_at < ? GROUP BY sm.product_id ORDER BY cost DESC`).all(businessId, start, end) as { id: string; name: string; unit: string; qty: number; cost: number }[]
  const wasteTotal = waste.reduce((a, w) => a + w.cost, 0)
  const revenue = platillos.reduce((a, p) => a + p.revenue, 0)
  return {
    platillos, ingredientes, alertas, falta,
    desperdicio: { total: wasteTotal, pctOfSales: revenue > 0 ? pct(wasteTotal, revenue) : null, items: waste.map((w) => ({ id: w.id, name: w.name, unit: w.unit, qty: w.qty / 1000, cost: w.cost })), nota: waste.length === 0 ? 'No hay mermas registradas en este periodo. Si tiras o regalas producto, regístralo como merma para ver el desperdicio.' : null },
  }
}

auto.get('/auto/platillos', requireFinance('finance'), (c) => {
  const { db, now } = c.get('deps')
  const { start, end, from, to } = period((k) => c.req.query(k), localDate(now()))
  return c.json({ from, to, ...rentabilidadPlatillos(db, c.get('session').user.business_id, start, end, now()) })
})

// ------------------------------------------------------------------ Tiendas (abarrotes, ferretería, perfumería, papelería…)

/** Margen real por producto y alertas de precio, con el costo que el negocio capturó. */
export function rentabilidadProductos(db: Db, businessId: string, start: string, end: string) {
  const rows = db.prepare(`SELECT p.id, p.name, p.price, p.last_cost, p.margin_bp, c.margin_bp cat_margin, SUM(si.quantity) sold, SUM(si.total) revenue, SUM(si.cost) cost
    FROM sale_items si JOIN sales sa ON sa.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
    WHERE sa.business_id = ? AND sa.status = 'completada' AND sa.created_at >= ? AND sa.created_at < ? AND p.track_stock = 1 GROUP BY p.id`).all(businessId, start, end) as { id: string; name: string; price: number; last_cost: number; margin_bp: number | null; cat_margin: number | null; sold: number; revenue: number; cost: number }[]
  const withCost = rows.filter((r) => r.last_cost > 0 || r.cost > 0)
  const items = withCost.map((r) => ({ id: r.id, name: r.name, sold: r.sold, revenue: r.revenue, profit: r.revenue - r.cost, marginPct: pct(r.revenue - r.cost, r.revenue), target: (r.margin_bp ?? r.cat_margin) ?? null }))
  const belowCost = withCost.filter((r) => r.last_cost > 0 && r.price <= r.last_cost).map((r) => ({ id: r.id, name: r.name, price: r.price, cost: r.last_cost }))
  const belowTarget = withCost.filter((r) => r.last_cost > 0 && r.price > r.last_cost && (r.margin_bp ?? r.cat_margin) != null && ((r.price - r.last_cost) / r.last_cost) * 10_000 < (r.margin_bp ?? r.cat_margin)!).map((r) => ({ id: r.id, name: r.name, price: r.price, cost: r.last_cost, target: (r.margin_bp ?? r.cat_margin)! }))
  const sinCosto = rows.filter((r) => !(r.last_cost > 0) && !(r.cost > 0)).map((r) => r.name)
  return {
    top: items.sort((a, b) => b.profit - a.profit).slice(0, 8), belowCost, belowTarget,
    falta: sinCosto.length ? [`Sin costo capturado (no se puede saber su ganancia): ${sinCosto.slice(0, 8).join(', ')}${sinCosto.length > 8 ? '…' : ''}. Captura el costo al comprar o en el producto.`] : [],
    consejos: [
      ...belowCost.map((x) => `«${x.name}» se vende a ${(x.price / 100).toFixed(2)} y te costó ${(x.cost / 100).toFixed(2)}: estás perdiendo en cada venta.`),
      ...belowTarget.slice(0, 5).map((x) => `«${x.name}» está por debajo de la ganancia que quieres (${x.target / 100}% sobre el costo): conviene subir su precio.`),
    ],
  }
}

auto.get('/auto/productos', requireFinance('finance'), (c) => {
  const { db, now } = c.get('deps')
  const { start, end, from, to } = period((k) => c.req.query(k), localDate(now()))
  return c.json({ from, to, ...rentabilidadProductos(db, c.get('session').user.business_id, start, end) })
})

