import { Hono } from 'hono'
import { businessGiros } from './billing.js'
import { moduleOn } from './common.js'
import { hasPerm, requirePerm, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { fromMilli, stockOf } from './inventory.js'
import { iso, localDate } from './util.js'

/**
 * «Pendientes de hoy»: el sistema revisa el negocio y dice qué toca hacer, para no tener que buscarlo.
 * Cada pendiente trae a dónde ir y, cuando aplica, el mensaje de WhatsApp listo (nada se envía solo).
 */

export interface TaskItem { label: string; sub?: string; phone?: string | null; message?: string }
export interface Task { key: string; tone: 'urgente' | 'aviso' | 'info'; title: string; detail: string; screen: string; action?: string; items?: TaskItem[] }

const MX = 'America/Mexico_City'
const hora = (d: string) => new Date(d).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MX })
const pesos = (c: number) => `$${(c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dayStart = (date: string) => new Date(`${date}T06:00:00.000Z`).toISOString()
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** Nombre para saludar: «Doña Mari», «Don Beto», o solo el primer nombre. */
const first = (name: string) => { const w = name.trim().split(/\s+/); return /^(don|doña|dona|sr\.?|sra\.?|srta\.?|lic\.?|ing\.?|profe?\.?)$/i.test(w[0] ?? '') && w[1] ? `${w[0]} ${w[1]}` : w[0] ?? name }

export const mainBranch = (db: Db, u: UserRow) => u.branch_id ?? (db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1 ORDER BY created_at LIMIT 1').get(u.business_id) as { id: string } | undefined)?.id ?? null

/** Lo que falta para surtir: debajo del mínimo, con una cantidad sugerida y su proveedor de siempre. */
export function reorderList(db: Db, businessId: string, branchId: string) {
  const rows = db.prepare('SELECT id, name, unit, min_stock_milli, last_cost FROM products WHERE business_id = ? AND active = 1 AND min_stock_milli > 0').all(businessId) as { id: string; name: string; unit: string; min_stock_milli: number; last_cost: number }[]
  return rows
    .map((p) => ({ p, stock: stockOf(db, branchId, p.id) }))
    .filter((x) => x.stock < x.p.min_stock_milli)
    .map(({ p, stock }) => {
      // Se sugiere llegar al doble del mínimo (para no estar surtiendo diario); por pieza, en números enteros.
      let qty = fromMilli(p.min_stock_milli * 2 - Math.max(0, stock))
      qty = p.unit === 'pieza' ? Math.ceil(qty) : Math.round(qty * 10) / 10
      const sup = (db.prepare('SELECT s.id, s.name, s.phone FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE ps.product_id = ? AND s.active = 1 LIMIT 1').get(p.id)
        ?? db.prepare('SELECT s.id, s.name, s.phone FROM purchase_items i JOIN purchases pu ON pu.id = i.purchase_id JOIN suppliers s ON s.id = pu.supplier_id WHERE i.product_id = ? ORDER BY pu.created_at DESC LIMIT 1').get(p.id)) as { id: string; name: string; phone: string | null } | undefined
      return { productId: p.id, name: p.name, unit: p.unit, stock: fromMilli(stock), minStock: fromMilli(p.min_stock_milli), suggested: qty, lastCost: p.last_cost, supplier: sup ?? null }
    })
    .sort((a, b) => (a.supplier?.name ?? 'zzz').localeCompare(b.supplier?.name ?? 'zzz') || a.name.localeCompare(b.name))
}

export function todayTasks(db: Db, u: UserRow, now: Date): Task[] {
  const b = u.business_id
  const giros = businessGiros(db, b)
  const has = (...g: string[]) => giros.some((x) => g.includes(x))
  const biz = (db.prepare('SELECT name FROM businesses WHERE id = ?').get(b) as { name: string }).name
  const today = localDate(now)
  const tomorrow = localDate(new Date(now.getTime() + 86_400_000))
  const tasks: Task[] = []
  const branch = mainBranch(db, u)

  // Caja abierta desde otro día: falta el corte.
  if (hasPerm(u, 'open_close_cash')) {
    const old = db.prepare("SELECT s.opened_at, us.name FROM shifts s JOIN users us ON us.id = s.cashier_id WHERE s.business_id = ? AND s.status = 'abierto' AND s.opened_at < ? ORDER BY s.opened_at").all(b, dayStart(today)) as { opened_at: string; name: string }[]
    if (old.length) tasks.push({ key: 'corte', tone: 'urgente', title: 'Hay caja sin corte de otro día', detail: `Abierta desde ${new Date(old[0]!.opened_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: MX })}. Haz el corte para que cuadre el dinero.`, screen: 'caja', action: 'Hacer corte', items: old.map((s) => ({ label: s.name, sub: `desde ${new Date(s.opened_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: MX })} ${hora(s.opened_at)}` })) })
  }

  // Agenda: citas por confirmar y recordatorios de mañana (barbería, uñas).
  if (has('barberia', 'unas') && hasPerm(u, 'sell')) {
    const pend = db.prepare("SELECT customer_name, phone, starts_at FROM appointments WHERE business_id = ? AND status = 'pendiente' AND starts_at >= ? AND starts_at < ? ORDER BY starts_at").all(b, iso(now), dayStart(localDate(new Date(now.getTime() + 2 * 86_400_000)))) as { customer_name: string; phone: string | null; starts_at: string }[]
    if (pend.length) tasks.push({ key: 'citas_confirmar', tone: 'aviso', title: `${plural(pend.length, 'cita', 'citas')} por confirmar`, detail: 'Confírmalas para que el cliente vea su cita segura.', screen: 'agenda', action: 'Ir a la agenda',
      items: pend.slice(0, 8).map((a) => ({ label: a.customer_name, sub: `${localDate(new Date(a.starts_at)) === today ? 'hoy' : 'mañana'} ${hora(a.starts_at)}`, phone: a.phone, message: `Hola ${first(a.customer_name)}, te confirmamos tu cita en ${biz} ${localDate(new Date(a.starts_at)) === today ? 'hoy' : 'mañana'} a las ${hora(a.starts_at)}. ¡Te esperamos!` })) })
    const tom = db.prepare("SELECT customer_name, phone, starts_at FROM appointments WHERE business_id = ? AND status IN ('pendiente','confirmada') AND starts_at >= ? AND starts_at < ? AND phone IS NOT NULL ORDER BY starts_at").all(b, dayStart(tomorrow), dayStart(localDate(new Date(now.getTime() + 2 * 86_400_000)))) as { customer_name: string; phone: string; starts_at: string }[]
    if (tom.length) tasks.push({ key: 'citas_manana', tone: 'info', title: `Recordar ${plural(tom.length, 'cita', 'citas')} de mañana`, detail: 'El mensaje ya está escrito: solo toca «WhatsApp» en cada uno.', screen: 'agenda',
      items: tom.slice(0, 12).map((a) => ({ label: a.customer_name, sub: `mañana ${hora(a.starts_at)}`, phone: a.phone, message: `Hola ${first(a.customer_name)}, te recordamos tu cita en ${biz} mañana a las ${hora(a.starts_at)}. Si no puedes venir, avísanos por aquí.` })) })
  }

  // Reservas de mesa por confirmar (palapa, restaurante).
  if (has('palapa', 'restaurante') && hasPerm(u, 'sell')) {
    const r = db.prepare("SELECT name, phone, people, starts_at FROM table_reservations WHERE business_id = ? AND status = 'pendiente' AND starts_at >= ? AND starts_at < ? ORDER BY starts_at").all(b, iso(now), dayStart(localDate(new Date(now.getTime() + 2 * 86_400_000)))) as { name: string; phone: string | null; people: number; starts_at: string }[]
    if (r.length) tasks.push({ key: 'reservas', tone: 'aviso', title: `${plural(r.length, 'reserva', 'reservas')} de mesa por confirmar`, detail: 'Hoy y mañana.', screen: 'mesas', action: 'Ver reservas',
      items: r.map((x) => ({ label: `${x.name} · ${x.people} personas`, sub: `${localDate(new Date(x.starts_at)) === today ? 'hoy' : 'mañana'} ${hora(x.starts_at)}`, phone: x.phone, message: `Hola ${first(x.name)}, te confirmamos tu reserva en ${biz} para ${x.people} personas ${localDate(new Date(x.starts_at)) === today ? 'hoy' : 'mañana'} a las ${hora(x.starts_at)}.` })) })
  }

  // Inventario: por surtir y por caducar.
  if (branch && hasPerm(u, 'view_inventory')) {
    const low = reorderList(db, b, branch)
    if (low.length) tasks.push({ key: 'surtir', tone: 'aviso', title: `${plural(low.length, 'producto', 'productos')} por surtir`, detail: 'Ya está armado el pedido sugerido para tu proveedor.', screen: 'productos', action: 'Armar pedido',
      items: low.slice(0, 6).map((x) => ({ label: x.name, sub: `quedan ${x.stock} · pedir ${x.suggested}${x.supplier ? ` · ${x.supplier.name}` : ''}` })) })
    const exp = db.prepare('SELECT p.name, l.expires_at, l.qty_remaining_milli FROM lots l JOIN products p ON p.id = l.product_id WHERE p.business_id = ? AND l.branch_id = ? AND l.qty_remaining_milli > 0 AND l.expires_at IS NOT NULL AND l.expires_at <= ? ORDER BY l.expires_at LIMIT 8').all(b, branch, iso(new Date(now.getTime() + 7 * 86_400_000))) as { name: string; expires_at: string; qty_remaining_milli: number }[]
    if (exp.length) tasks.push({ key: 'caducar', tone: exp.some((x) => x.expires_at <= iso(now)) ? 'urgente' : 'aviso', title: `${plural(exp.length, 'lote', 'lotes')} por caducar`, detail: 'Véndelos primero o regístralos como merma.', screen: 'productos',
      items: exp.map((x) => ({ label: x.name, sub: `${fromMilli(x.qty_remaining_milli)} · ${x.expires_at <= iso(now) ? 'ya caducó' : `caduca ${new Date(x.expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: MX })}`}` })) })
  }

  // Fiado: los que más deben, con el mensaje de cobro listo.
  if (has('abarrotes', 'ferreteria', 'papeleria', 'comedor', 'verduleria') && hasPerm(u, 'customers_credit')) {
    const debt = db.prepare('SELECT c.name, c.phone, c.credit_limit, SUM(l.delta) AS balance FROM credit_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? GROUP BY c.id HAVING balance > 0 ORDER BY balance DESC').all(b) as { name: string; phone: string | null; credit_limit: number; balance: number }[]
    if (debt.length) {
      const total = debt.reduce((a, x) => a + x.balance, 0)
      const over = debt.filter((x) => x.credit_limit > 0 && x.balance > x.credit_limit).length
      tasks.push({ key: 'fiado', tone: over ? 'aviso' : 'info', title: `Te deben ${pesos(total)} de fiado`, detail: `${plural(debt.length, 'cliente', 'clientes')}${over ? ` · ${over} pasados de su límite` : ''}. El mensaje para cobrar ya está escrito.`, screen: 'clientes',
        items: debt.slice(0, 6).map((x) => ({ label: x.name, sub: `debe ${pesos(x.balance)}${x.credit_limit > 0 && x.balance > x.credit_limit ? ' · pasado del límite' : ''}`, phone: x.phone, message: `Hola ${first(x.name)}, te saludamos de ${biz}. Te recordamos que tu saldo pendiente es de ${pesos(x.balance)}. ¡Gracias!` })) })
    }
  }

  // Apartados que vencen pronto (abarrotes).
  if (has('abarrotes') && hasPerm(u, 'sell')) {
    const due = db.prepare("SELECT l.folio, l.due_date, l.total, c.name, c.phone, (SELECT COALESCE(SUM(CASE WHEN kind = 'devolucion' THEN -amount ELSE amount END),0) FROM layaway_payments WHERE layaway_id = l.id) AS paid FROM layaways l JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? AND l.status = 'abierto' AND l.due_date IS NOT NULL AND l.due_date <= ? ORDER BY l.due_date").all(b, localDate(new Date(now.getTime() + 3 * 86_400_000))) as { folio: number; due_date: string; total: number; name: string; phone: string | null; paid: number }[]
    if (due.length) tasks.push({ key: 'apartados', tone: due.some((x) => x.due_date < today) ? 'urgente' : 'aviso', title: `${plural(due.length, 'apartado vence', 'apartados vencen')} pronto`, detail: 'Avísale al cliente para que liquide.', screen: 'apartados',
      items: due.map((x) => ({ label: `#${x.folio} · ${x.name}`, sub: `${x.due_date < today ? 'venció' : 'vence'} ${x.due_date} · resta ${pesos(x.total - x.paid)}`, phone: x.phone, message: `Hola ${first(x.name)}, tu apartado #${x.folio} en ${biz} ${x.due_date < today ? 'ya venció' : `vence el ${x.due_date}`}. Te falta ${pesos(x.total - x.paid)} para llevártelo.` })) })
  }

  // Tarjeta de sellos: clientes que ya pueden canjear un premio.
  if (moduleOn(db, b, 'fidelidad') && hasPerm(u, 'sell')) {
    const min = db.prepare('SELECT name, cost FROM loyalty_rewards WHERE business_id = ? AND active = 1 ORDER BY cost LIMIT 1').get(b) as { name: string; cost: number } | undefined
    if (min) {
      const ready = db.prepare('SELECT c.name, c.phone, SUM(l.delta) AS bal FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id WHERE l.business_id = ? AND c.active = 1 GROUP BY c.id HAVING bal >= ? ORDER BY bal DESC').all(b, min.cost) as { name: string; phone: string | null; bal: number }[]
      if (ready.length) tasks.push({ key: 'premios', tone: 'info', title: `${plural(ready.length, 'cliente ya puede', 'clientes ya pueden')} canjear su premio`, detail: `Desde «${min.name}». Avísales para que regresen.`, screen: 'clientes',
        items: ready.slice(0, 8).map((x) => ({ label: x.name, sub: `${x.bal} sellos`, phone: x.phone, message: `Hola ${first(x.name)}, ¡ya juntaste ${x.bal} sellos en ${biz}! Ya puedes canjear tu premio en tu próxima visita.` })) })
    }
  }
  // Primeros pasos (solo el dueño, los primeros 60 días): lo que falta para empezar a vender, según su giro.
  if (u.role === 'owner') {
    const created = (db.prepare('SELECT created_at FROM businesses WHERE id = ?').get(b) as { created_at: string }).created_at
    if (now.getTime() - Date.parse(created) < 60 * 86_400_000) {
      const count = (sql: string) => (db.prepare(sql).get(b) as { n: number }).n
      const steps: (TaskItem & { screen: string; done: boolean })[] = []
      const agenda = has('barberia', 'unas')
      steps.push({ label: 'Pon tu código de autorización', sub: 'Lo pide el sistema para cancelar, descontar o cambiar precios.', screen: 'usuarios', done: !!(db.prepare('SELECT auth_code_hash FROM users WHERE id = ?').get(u.id) as { auth_code_hash: string | null }).auth_code_hash })
      if (agenda) {
        steps.push({ label: 'Da de alta tus servicios', sub: 'Con su precio y duración.', screen: 'configurar', done: count('SELECT COUNT(*) n FROM services WHERE business_id = ? AND active = 1') > 0 })
        steps.push({ label: `Marca quién atiende citas y su horario`, sub: 'Sin horario no aparecen horas libres.', screen: 'usuarios', done: count('SELECT COUNT(*) n FROM users WHERE business_id = ? AND active = 1 AND in_agenda = 1') > 0 })
      } else {
        steps.push({ label: 'Agrega tus productos', sub: 'Uno por uno, con el lector o importando tu lista.', screen: 'productos', done: count('SELECT COUNT(*) n FROM products WHERE business_id = ? AND active = 1') > 0 })
      }
      if (has('palapa', 'restaurante')) steps.push({ label: 'Arma tus mesas', sub: 'Para abrir cuentas por mesa.', screen: 'configurar', done: count('SELECT COUNT(*) n FROM dining_tables WHERE business_id = ?') > 0 })
      steps.push({ label: 'Haz tu primera venta', sub: 'Abre la caja con tu fondo y cobra.', screen: 'caja', done: count("SELECT COUNT(*) n FROM sales WHERE business_id = ? AND status = 'completada'") > 0 })
      steps.push({ label: 'Da de alta a tu personal (opcional)', sub: 'Cada quien con su usuario y sus permisos.', screen: 'usuarios', done: count('SELECT COUNT(*) n FROM users WHERE business_id = ? AND active = 1') > 1 })
      const left = steps.filter((s) => !s.done)
      if (left.length && left.some((s) => !s.label.includes('opcional'))) {
        tasks.push({ key: 'primeros_pasos', tone: 'info', title: `Primeros pasos: te ${left.length === 1 ? 'falta 1' : `faltan ${left.length}`} de ${steps.length}`, detail: 'Para dejar tu sistema listo. Esto desaparece cuando terminas.', screen: left[0]!.screen,
          items: left.map(({ label, sub }) => ({ label, sub })) })
      }
    }
  }
  const order = { urgente: 0, aviso: 1, info: 2 }
  return tasks.sort((a, b) => order[a.tone] - order[b.tone])
}

export const today = new Hono<Env>()

today.get('/today', (c) => {
  const { db, now } = c.get('deps')
  return c.json({ tasks: todayTasks(db, c.get('session').user, now()) })
})

/** Pedido sugerido para surtir, agrupado por proveedor. */
today.get('/inventory/reorder', requirePerm('view_inventory'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const branch = mainBranch(db, u)
  return c.json({ items: branch ? reorderList(db, u.business_id, branch) : [] })
})
