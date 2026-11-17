import { Hono } from 'hono'
import { z } from 'zod'
import { businessGiros } from './billing.js'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, hasPerm, isManager, ownerOnly, parse, requirePerm, type C, type Deps, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { currentPrice, getProduct } from './inventory.js'
import { createSale, parseSale } from './sales.js'
import { getSettings } from './settings.js'
import { bad, conflict, forbidden, iso, localDate, newId, notFound } from './util.js'

/**
 * Mesas, cuentas abiertas y comandas por estación. Lo usan palapa, restaurante, comedor y taquería.
 * Los precios quedan fijos al pedir; el cobro crea ventas normales (corte, inventario, recetas, propinas).
 */
export const dining = new Hono<Env>()

interface TabRow { id: string; business_id: string; branch_id: string; kind: string; table_id: string | null; waiter_id: string | null; people: number; status: string; order_number: number | null; order_status: string | null; customer_name: string | null; phone: string | null; pickup_at: string | null; opened_at: string }
interface ItemRow { id: string; tab_id: string; product_id: string | null; service_id: string | null; description: string; quantity: number; unit_price: number; modifiers: string; notes: string | null; station: string | null; person: number | null; status: string; comanda_id: string | null; courtesy: number; sale_id: string | null; created_at: string }

const lineTotal = (i: ItemRow) => (i.courtesy || i.status === 'cancelado' ? 0 : Math.round(i.quantity * i.unit_price))
const open = (i: ItemRow) => i.status !== 'cancelado' && i.status !== 'pagado'

function loadTab(c: C, id = c.req.param('id')): TabRow {
  const t = c.get('deps').db.prepare('SELECT * FROM tabs WHERE id = ? AND business_id = ?').get(id, c.get('session').user.business_id) as TabRow | undefined
  if (!t) throw notFound('No se encontró esa cuenta.')
  return t
}
const itemsOf = (db: Db, tabId: string) => db.prepare('SELECT * FROM tab_items WHERE tab_id = ? ORDER BY created_at, rowid').all(tabId) as ItemRow[]

export function tabView(db: Db, t: TabRow) {
  const items = itemsOf(db, t.id)
  const table = t.table_id ? (db.prepare('SELECT name, min_consumption FROM dining_tables WHERE id = ?').get(t.table_id) as { name: string; min_consumption: number | null }) : null
  const byPerson: Record<string, number> = {}
  for (const i of items.filter(open)) byPerson[i.person ?? 0] = (byPerson[i.person ?? 0] ?? 0) + lineTotal(i)
  return {
    id: t.id, kind: t.kind, tableId: t.table_id, table: table?.name ?? null, waiterId: t.waiter_id, people: t.people, status: t.status,
    orderNumber: t.order_number, orderStatus: t.order_status, customerName: t.customer_name, phone: t.phone, pickupAt: t.pickup_at, openedAt: t.opened_at,
    items: items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unit_price, total: lineTotal(i), modifiers: JSON.parse(i.modifiers), notes: i.notes, station: i.station, person: i.person, status: i.status, courtesy: !!i.courtesy })),
    pending: items.filter(open).reduce((a, i) => a + lineTotal(i), 0), byPerson, minConsumption: table?.min_consumption ?? null,
  }
}

// ---------- Mesas y mapa en vivo ----------

dining.post('/tables', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(1).max(40), area: z.string().trim().min(2).max(40).default('salon'), seats: z.number().int().min(1).max(100).default(4), minConsumption: z.number().int().min(0).nullable().optional(), branchId: z.string().optional() }), await body(c))
  const branchId = d.branchId ?? u.branch_id
  if (!branchId) throw bad('Sucursal no válida.')
  const id = newId()
  db.prepare('INSERT INTO dining_tables (id, business_id, branch_id, name, area, seats, min_consumption, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, u.business_id, branchId, d.name, d.area, d.seats, d.minConsumption ?? null, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'mesa.alta', entity: 'table', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

dining.patch('/tables/:id', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const t = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as Record<string, unknown> | undefined
  if (!t) throw notFound()
  const d = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), area: z.string().trim().min(2).max(40).optional(), seats: z.number().int().min(1).max(100).optional(), minConsumption: z.number().int().min(0).nullable().optional(), active: z.boolean().optional() }), await body(c))
  db.prepare('UPDATE dining_tables SET name=?, area=?, seats=?, min_consumption=?, active=? WHERE id=?').run(d.name ?? t.name, d.area ?? t.area, d.seats ?? t.seats, d.minConsumption === undefined ? t.min_consumption : d.minConsumption, d.active === undefined ? t.active : d.active ? 1 : 0, t.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'mesa.cambio', entity: 'table', entityId: String(t.id), oldValue: t, newValue: d })
  return c.json({ ok: true })
})

/** Mapa en vivo: estado de cada mesa, para cuántos y cuánto lleva. Una reservación confirmada próxima la marca reservada. */
dining.get('/tables', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const rows = db.prepare('SELECT * FROM dining_tables WHERE business_id = ? AND active = 1 ORDER BY area, name').all(u.business_id) as { id: string; name: string; area: string; seats: number; status: string; min_consumption: number | null }[]
  const soon = iso(new Date(now().getTime() + 60 * 60_000))
  return c.json({
    tables: rows.map((t) => {
      const tab = db.prepare("SELECT * FROM tabs WHERE table_id = ? AND status IN ('abierta','por_cobrar') ORDER BY opened_at DESC LIMIT 1").get(t.id) as TabRow | undefined
      const res = db.prepare("SELECT name, starts_at, people FROM table_reservations WHERE table_id = ? AND status = 'confirmada' AND starts_at <= ? AND starts_at >= ? ORDER BY starts_at LIMIT 1").get(t.id, soon, iso(new Date(now().getTime() - 30 * 60_000))) as { name: string; starts_at: string; people: number } | undefined
      const status = t.status === 'libre' && res ? 'reservada' : t.status
      return { id: t.id, name: t.name, area: t.area, seats: t.seats, status, minConsumption: t.min_consumption, tabId: tab?.id ?? null, people: tab?.people ?? null, total: tab ? tabView(db, tab).pending : 0, openedAt: tab?.opened_at ?? null, reservation: res ? { name: res.name, at: res.starts_at, people: res.people } : null }
    }),
  })
})

/** El mesero libera la mesa después de limpiarla. */
dining.post('/tables/:id/free', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const t = db.prepare('SELECT id, status FROM dining_tables WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; status: string } | undefined
  if (!t) throw notFound()
  if (t.status !== 'limpieza') throw conflict('Solo se libera una mesa que está en limpieza.', 'estado_invalido')
  db.prepare("UPDATE dining_tables SET status = 'libre' WHERE id = ?").run(t.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'mesa.liberada', entity: 'table', entityId: t.id })
  return c.json({ ok: true })
})

// ---------- Cuentas ----------

dining.post('/tabs', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ id: z.string().uuid().optional(), kind: z.enum(['mesa', 'llevar', 'recoger']), tableId: z.string().optional(), people: z.number().int().min(1).max(100).default(1), waiterId: z.string().optional(), customerName: z.string().trim().max(80).optional(), phone: z.string().trim().max(20).optional(), pickupAt: z.string().datetime().optional() }), await body(c))
  if (d.id) {
    const prev = db.prepare('SELECT * FROM tabs WHERE id = ? AND business_id = ?').get(d.id, u.business_id) as TabRow | undefined
    if (prev) return c.json({ duplicate: true, tab: tabView(db, prev) })
  }
  if (!u.branch_id) throw bad('Tu usuario no tiene sucursal.')
  const waiter = d.waiterId ?? u.id
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND business_id = ? AND active = 1').get(waiter, u.business_id)) throw bad('Ese mesero no es del negocio.')
  let orderNumber: number | null = null
  if (d.kind === 'mesa') {
    if (!d.tableId) throw bad('Elige la mesa.')
    const t = db.prepare('SELECT status FROM dining_tables WHERE id = ? AND business_id = ? AND active = 1').get(d.tableId, u.business_id) as { status: string } | undefined
    if (!t) throw bad('Esa mesa no existe.')
    if (!['libre', 'reservada'].includes(t.status)) throw conflict(`La mesa está ${t.status.replace('_', ' ')}.`, 'mesa_ocupada')
  } else {
    // Reserva de hora para recoger: opcional, con interruptor del dueño. Apagada: solo número de pedido.
    if (d.pickupAt && !(getSettings(db, u.business_id) as { pickupScheduling?: boolean }).pickupScheduling) throw bad('La reserva de hora para recoger está apagada; solo se da número de pedido.')
    const day = new Date(`${localDate(now())}T06:00:00.000Z`).toISOString()
    orderNumber = ((db.prepare('SELECT MAX(order_number) m FROM tabs WHERE business_id = ? AND opened_at >= ?').get(u.business_id, day) as { m: number | null }).m ?? 0) + 1
  }
  const id = d.id ?? newId()
  db.transaction(() => {
    db.prepare('INSERT INTO tabs (id, business_id, branch_id, kind, table_id, waiter_id, people, status, order_number, order_status, customer_name, phone, pickup_at, opened_by, opened_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, u.branch_id, d.kind, d.tableId ?? null, waiter, d.people, 'abierta', orderNumber, d.kind === 'mesa' ? null : 'recibido', d.customerName ?? null, d.phone ?? null, d.pickupAt ?? null, u.id, iso(now()),
    )
    if (d.tableId) db.prepare("UPDATE dining_tables SET status = 'ocupada' WHERE id = ?").run(d.tableId)
  })()
  return c.json({ tab: tabView(db, db.prepare('SELECT * FROM tabs WHERE id = ?').get(id) as TabRow) }, 201)
})

dining.get('/tabs', requirePerm('sell'), (c) => {
  const { db } = c.get('deps')
  const kind = c.req.query('kind')
  const rows = db.prepare(`SELECT * FROM tabs WHERE business_id = ? AND status IN ('abierta','por_cobrar') ${kind ? 'AND kind = ?' : ''} ORDER BY opened_at`).all(...[c.get('session').user.business_id, ...(kind ? [kind] : [])]) as TabRow[]
  return c.json({ tabs: rows.map((t) => tabView(db, t)) })
})

dining.get('/tabs/:id', requirePerm('sell'), (c) => c.json({ tab: tabView(c.get('deps').db, loadTab(c)) }))

const itemBody = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().optional(), serviceId: z.string().optional(), description: z.string().trim().min(1).max(200).optional(),
  quantity: z.number().positive().max(10_000), unitPrice: z.number().int().min(0).optional(),
  /** Variantes elegidas (definidas en attrs.modifiers del producto, con su precio extra). */
  modifiers: z.array(z.string()).max(10).optional(), notes: z.string().max(300).optional(), person: z.number().int().min(1).max(100).optional(),
})

/** Validaciones de un giro antes de agregar a la cuenta (p. ej. guisados agotados). */
export const tabItemValidators: ((ctx: { db: Db; user: UserRow; productId: string | null; quantity: number; now: Date }) => void)[] = []

dining.post('/tabs/:id/items', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const t = loadTab(c)
  if (!['abierta', 'por_cobrar'].includes(t.status)) throw conflict('Esa cuenta ya está cerrada.', 'cuenta_cerrada')
  const d = parse(z.object({ items: z.array(itemBody).min(1).max(100), authCode: z.string().optional() }), await body(c))
  // En giros de comida todo pasa por cocina (o la estación indicada); en los demás no hay comandas.
  const food = businessGiros(db, u.business_id).some((g) => ['palapa', 'restaurante', 'comedor', 'taqueria'].includes(g))
  const rows = d.items.map((it) => {
    if (it.id && db.prepare('SELECT 1 FROM tab_items WHERE id = ?').get(it.id)) return null // ya registrado (reenvío)
    for (const v of tabItemValidators) v({ db, user: u, productId: it.productId ?? null, quantity: it.quantity, now: now() })
    if (it.productId) {
      const p = getProduct(db, u.business_id, it.productId)
      if (!p.active || !p.sellable) throw bad(`${p.name} no está disponible.`)
      if (p.unit === 'pieza' && !Number.isInteger(it.quantity)) throw bad(`${p.name} se pide por pieza.`)
      const attrs = JSON.parse(p.attrs) as { station?: string; modifiers?: { name: string; price: number }[] }
      const mods = (it.modifiers ?? []).map((m) => {
        const opt = attrs.modifiers?.find((x) => x.name === m)
        if (!opt) throw bad(`"${m}" no es una variante de ${p.name}.`)
        return opt
      })
      const base = currentPrice(db, t.branch_id, p) + mods.reduce((a, m) => a + m.price, 0)
      // Precio distinto al del menú: cambio de precio con código.
      if (it.unitPrice !== undefined && it.unitPrice !== base) {
        if (!hasPerm(u, 'change_prices')) throw forbidden('No tienes permiso para cambiar precios.')
        authorize(deps, u, d.authCode, 'change_prices', 'precio en cuenta')
      }
      return { ...it, description: [p.name, ...mods.map((m) => m.name)].join(' · '), unitPrice: it.unitPrice ?? base, station: attrs.station ?? (food ? 'cocina' : null), mods }
    }
    if (it.serviceId) {
      const s = db.prepare('SELECT name, price FROM services WHERE id = ? AND business_id = ? AND active = 1').get(it.serviceId, u.business_id) as { name: string; price: number } | undefined
      if (!s) throw bad('Ese servicio no existe.')
      return { ...it, description: s.name, unitPrice: s.price, station: null, mods: [] }
    }
    if (!it.description || it.unitPrice === undefined) throw bad('Cada renglón libre necesita descripción y precio.')
    if (!hasPerm(u, 'change_prices')) throw forbidden('Solo quien puede cambiar precios agrega renglones libres.')
    return { ...it, description: it.description, unitPrice: it.unitPrice, station: null, mods: [] }
  }).filter(Boolean) as (z.infer<typeof itemBody> & { description: string; unitPrice: number; station: string | null; mods: unknown[] })[]
  db.transaction(() => {
    for (const r of rows) {
      db.prepare('INSERT INTO tab_items (id, tab_id, product_id, service_id, description, quantity, unit_price, modifiers, notes, station, person, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        r.id ?? newId(), t.id, r.productId ?? null, r.serviceId ?? null, r.description, r.quantity, r.unitPrice, JSON.stringify(r.mods), r.notes ?? null, r.station, r.person ?? null, r.station ? 'pendiente' : 'listo', u.id, iso(now()),
      )
    }
    if (t.status === 'por_cobrar') {
      db.prepare("UPDATE tabs SET status = 'abierta' WHERE id = ?").run(t.id)
      if (t.table_id) db.prepare("UPDATE dining_tables SET status = 'ocupada' WHERE id = ?").run(t.table_id)
    }
  })()
  return c.json({ tab: tabView(db, loadTab(c)) }, 201)
})

/** Confirmar pedido: se mandan las comandas, una por estación (cocina caliente, fría, barra, postres…). */
dining.post('/tabs/:id/send', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const t = loadTab(c)
  const pending = itemsOf(db, t.id).filter((i) => i.status === 'pendiente' || (t.kind !== 'mesa' && i.status === 'pagado' && i.station && !i.comanda_id))
  // Para llevar o recoger: se cobran al hacerlos, antes de pasar a cocina.
  if (t.kind !== 'mesa' && itemsOf(db, t.id).some(open)) throw conflict('Los pedidos para llevar se cobran antes de mandarlos a cocina.', 'pedido_sin_pagar')
  if (!pending.length) throw bad('No hay nada nuevo que mandar.')
  const byStation = new Map<string, ItemRow[]>()
  for (const i of pending) byStation.set(i.station ?? 'cocina', [...(byStation.get(i.station ?? 'cocina') ?? []), i])
  const out = db.transaction(() => [...byStation.entries()].map(([station, items]) => {
    const id = newId()
    db.prepare('INSERT INTO comandas (id, business_id, tab_id, station, created_at) VALUES (?,?,?,?,?)').run(id, u.business_id, t.id, station, iso(now()))
    for (const i of items) db.prepare("UPDATE tab_items SET comanda_id = ?, status = CASE WHEN status = 'pagado' THEN status ELSE 'enviado' END WHERE id = ?").run(id, i.id)
    if (t.kind !== 'mesa') db.prepare("UPDATE tabs SET order_status = 'en_cocina' WHERE id = ?").run(t.id)
    return { id, station, items: items.length }
  }))()
  return c.json({ comandas: out })
})

/** Pantalla de cada estación: solo lo suyo, con el tiempo que lleva. */
dining.get('/kitchen', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const station = c.req.query('station')
  const rows = db.prepare(`SELECT k.*, t.kind, t.order_number, t.table_id FROM comandas k JOIN tabs t ON t.id = k.tab_id WHERE k.business_id = ? AND k.status = 'en_preparacion' ${station ? 'AND k.station = ?' : ''} ORDER BY k.created_at`).all(...[u.business_id, ...(station ? [station] : [])]) as { id: string; station: string; created_at: string; kind: string; order_number: number | null; table_id: string | null }[]
  return c.json({
    comandas: rows.map((k) => ({
      id: k.id, station: k.station, createdAt: k.created_at, minutes: Math.floor((now().getTime() - Date.parse(k.created_at)) / 60_000),
      where: k.table_id ? `Mesa ${(db.prepare('SELECT name FROM dining_tables WHERE id = ?').get(k.table_id) as { name: string }).name}` : `Pedido #${k.order_number}`,
      items: db.prepare("SELECT description, quantity, notes FROM tab_items WHERE comanda_id = ? AND status != 'cancelado'").all(k.id),
    })),
  })
})

dining.post('/comandas/:id/ready', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const k = db.prepare('SELECT * FROM comandas WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; tab_id: string; status: string; created_at: string } | undefined
  if (!k) throw notFound()
  if (k.status !== 'en_preparacion') throw conflict('Esa comanda ya estaba lista.')
  db.transaction(() => {
    db.prepare("UPDATE comandas SET status = 'lista', ready_at = ? WHERE id = ?").run(iso(now()), k.id)
    db.prepare("UPDATE tab_items SET status = 'listo' WHERE comanda_id = ? AND status = 'enviado'").run(k.id)
    const left = (db.prepare("SELECT COUNT(*) n FROM comandas WHERE tab_id = ? AND status = 'en_preparacion'").get(k.tab_id) as { n: number }).n
    if (!left) db.prepare("UPDATE tabs SET order_status = 'listo' WHERE id = ? AND kind != 'mesa'").run(k.tab_id)
  })()
  return c.json({ minutes: Math.round((now().getTime() - Date.parse(k.created_at)) / 60_000) })
})

/** Tiempos de cocina por comanda (minutos de envío a lista). */
dining.get('/reports/kitchen-times', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const date = c.req.query('date') ?? localDate(now())
  const start = new Date(`${date}T06:00:00.000Z`).toISOString()
  const end = new Date(Date.parse(start) + 86_400_000).toISOString()
  const rows = db.prepare("SELECT station, COUNT(*) n, AVG((julianday(ready_at) - julianday(created_at)) * 1440) avg, MAX((julianday(ready_at) - julianday(created_at)) * 1440) max FROM comandas WHERE business_id = ? AND ready_at IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY station").all(c.get('session').user.business_id, start, end) as { station: string; n: number; avg: number; max: number }[]
  return c.json({ date, stations: rows.map((r) => ({ station: r.station, comandas: r.n, avgMinutes: Math.round(r.avg), maxMinutes: Math.round(r.max) })) })
})

// ---------- Cancelaciones y cortesías: siempre con código del dueño ----------

function itemAction(c: C, kind: 'cancel' | 'courtesy') {
  return async () => {
    const deps = c.get('deps')
    const { db, now } = deps
    const u = c.get('session').user
    const i = db.prepare('SELECT ti.* FROM tab_items ti JOIN tabs t ON t.id = ti.tab_id WHERE ti.id = ? AND t.business_id = ?').get(c.req.param('id'), u.business_id) as ItemRow | undefined
    if (!i) throw notFound()
    if (!open(i)) throw conflict('Ese renglón ya está pagado o cancelado.', 'estado_invalido')
    const d = parse(z.object({ reason: z.string().trim().min(3).max(200), authCode: z.string().optional() }), await body(c))
    const auth = authorize(deps, u, d.authCode, 'cancel_discount', kind === 'cancel' ? 'cancelación en cuenta' : 'cortesía', { ownerOnly: true })
    if (kind === 'cancel') db.prepare("UPDATE tab_items SET status = 'cancelado', cancel_reason = ?, authorized_by = ? WHERE id = ?").run(d.reason, auth.id, i.id)
    else db.prepare('UPDATE tab_items SET courtesy = 1, cancel_reason = ?, authorized_by = ? WHERE id = ?').run(d.reason, auth.id, i.id)
    audit(db, now, { businessId: u.business_id, userId: u.id, action: kind === 'cancel' ? 'cuenta.cancelacion' : 'cuenta.cortesia', entity: 'tab_item', entityId: i.id, newValue: { description: i.description, quantity: i.quantity, amount: lineTotal(i), sentToKitchen: !!i.comanda_id }, authorizedBy: auth.id, reason: d.reason })
    return c.json({ tab: tabView(db, loadTab(c, i.tab_id)) })
  }
}
dining.post('/tab-items/:id/cancel', requirePerm('sell'), (c) => itemAction(c, 'cancel')())
dining.post('/tab-items/:id/courtesy', requirePerm('sell'), (c) => itemAction(c, 'courtesy')())

dining.post('/tabs/:id/request-bill', requirePerm('sell'), (c) => {
  const { db } = c.get('deps')
  const t = loadTab(c)
  if (t.status !== 'abierta') throw conflict('Esa cuenta no está abierta.')
  db.prepare("UPDATE tabs SET status = 'por_cobrar' WHERE id = ?").run(t.id)
  if (t.table_id) db.prepare("UPDATE dining_tables SET status = 'por_cobrar' WHERE id = ?").run(t.table_id)
  return c.json({ tab: tabView(db, loadTab(c)) })
})

// ---------- Cobro: completo, por persona o por producto ----------

const partBody = z.object({
  id: z.string().uuid().optional(),
  /** Qué se cobra en esta parte: ciertos renglones, lo de una persona, o todo lo pendiente. */
  itemIds: z.array(z.string()).optional(), person: z.number().int().min(0).optional(),
  paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta', 'fiado']), cashReceived: z.number().int().optional(), customerId: z.string().optional(),
  /** Propina para el mesero: aparte del ingreso del negocio. */
  tip: z.number().int().min(0).optional(), tipMethod: z.enum(['efectivo', 'transferencia', 'tarjeta']).optional(),
  authCode: z.string().optional(), discount: z.number().int().min(0).optional(),
})

export function checkoutPart(deps: Deps, u: UserRow, t: TabRow, p: z.infer<typeof partBody>) {
  const { db, now } = deps
  const all = itemsOf(db, t.id).filter(open)
  const items = p.itemIds ? all.filter((i) => p.itemIds!.includes(i.id)) : p.person !== undefined ? all.filter((i) => (i.person ?? 0) === p.person) : all
  if (p.itemIds && items.length !== p.itemIds.length) throw bad('Algunos renglones ya están pagados o no son de esta cuenta.')
  if (!items.length) throw bad('No hay nada pendiente que cobrar en esta parte.')
  const rest = all.filter((i) => !items.includes(i))
  // Consumo mínimo por mesa: si al cerrar no se alcanza, se cobra la diferencia.
  const table = t.table_id ? (db.prepare('SELECT min_consumption FROM dining_tables WHERE id = ?').get(t.table_id) as { min_consumption: number | null }) : null
  const consumed = itemsOf(db, t.id).filter((i) => i.status !== 'cancelado').reduce((a, i) => a + lineTotal(i), 0)
  const extra = !rest.length && table?.min_consumption && consumed < table.min_consumption ? table.min_consumption - consumed : 0
  const saleItems = [
    ...items.map((i) => (i.product_id ? { productId: i.product_id, quantity: i.quantity, unitPrice: i.courtesy ? 0 : i.unit_price, description: i.description } : i.service_id ? { serviceId: i.service_id, quantity: i.quantity, unitPrice: i.courtesy ? 0 : i.unit_price } : { description: i.description, quantity: i.quantity, unitPrice: i.courtesy ? 0 : i.unit_price })),
    ...(extra ? [{ description: 'Diferencia de consumo mínimo', quantity: 1, unitPrice: extra }] : []),
  ]
  const tips = p.tip && t.waiter_id ? [{ staffId: t.waiter_id, amount: p.tip, method: p.tipMethod }] : undefined
  // Los precios quedaron fijos al pedir (los cambios ya se autorizaron entonces).
  const sale = createSale(deps, u, parseSale({ id: p.id ?? newId(), paymentMethod: p.paymentMethod, cashReceived: p.cashReceived, customerId: p.customerId, authCode: p.authCode, discount: p.discount, tips, items: saleItems }), { trustedPrices: true }).sale
  for (const i of items) db.prepare("UPDATE tab_items SET status = 'pagado', sale_id = ? WHERE id = ?").run(sale.id, i.id)
  if (!rest.length) {
    db.prepare("UPDATE asset_rentals SET returned_at = ? WHERE tab_id = ? AND returned_at IS NULL").run(iso(now()), t.id)
    if (t.kind === 'mesa') {
      db.prepare("UPDATE tabs SET status = 'cerrada', closed_at = ? WHERE id = ?").run(iso(now()), t.id)
      // La mesa pasa a limpieza al cobrar; el mesero la libera.
      if (t.table_id) db.prepare("UPDATE dining_tables SET status = 'limpieza' WHERE id = ?").run(t.table_id)
    }
  }
  return { sale, remaining: rest.reduce((a, i) => a + lineTotal(i), 0) }
}

dining.post('/tabs/:id/checkout', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  const t = loadTab(c)
  if (!['abierta', 'por_cobrar'].includes(t.status)) throw conflict('Esa cuenta ya está cerrada.', 'cuenta_cerrada')
  const d = parse(z.object({ parts: z.array(partBody).min(1).max(30) }), await body(c))
  const result = deps.db.transaction(() => d.parts.map((p) => checkoutPart(deps, u, t, p)))()
  return c.json({ parts: result.map((r) => ({ sale: r.sale, remaining: r.remaining })), tab: tabView(deps.db, loadTab(c)) })
})

/** Pedidos para llevar o recoger: entrega final. */
/**
 * Pedidos para llevar, recoger o por teléfono: entrega final. Si aún debe, se cobra al entregar
 * (verdulería), salvo que el dueño exija cobrar antes (`phoneOrdersPrepaid`).
 */
dining.post('/tabs/:id/deliver', requirePerm('sell'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const t = loadTab(c)
  if (t.kind === 'mesa') throw bad('Solo para pedidos para llevar o recoger.')
  if (t.status === 'cerrada') throw conflict('Ese pedido ya se entregó.', 'cuenta_cerrada')
  const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const unpaid = itemsOf(db, t.id).some(open)
  const result = db.transaction(() => {
    let sale = null
    if (unpaid) {
      if ((getSettings(db, u.business_id) as { phoneOrdersPrepaid?: boolean }).phoneOrdersPrepaid || !raw.paymentMethod) throw conflict('El pedido no está pagado.', 'pedido_sin_pagar')
      sale = checkoutPart(deps, u, t, parse(partBody, raw)).sale
    }
    db.prepare("UPDATE tabs SET order_status = 'entregado', status = 'cerrada', closed_at = ? WHERE id = ?").run(iso(now()), t.id)
    return { ok: true, sale }
  })()
  return c.json(result)
})

/** Aviso de pedido listo: solo prepara el mensaje; nada se envía solo. */
dining.get('/tabs/:id/notice', requirePerm('sell'), (c) => {
  const { db } = c.get('deps')
  const t = loadTab(c)
  const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(t.business_id) as { name: string }
  const message = `Hola${t.customer_name ? ` ${t.customer_name}` : ''}, tu pedido #${t.order_number} en ${biz.name} ya está listo.`
  return c.json({ message, whatsapp: t.phone ? `https://wa.me/52${t.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}` : null })
})

// ---------- Reservas de mesa ----------

dining.post('/table-reservations', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ tableId: z.string().optional(), startsAt: z.string().datetime(), people: z.number().int().min(1).max(200), name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).optional(), notes: z.string().max(300).optional() }), await body(c))
  if (d.tableId && !db.prepare('SELECT 1 FROM dining_tables WHERE id = ? AND business_id = ?').get(d.tableId, u.business_id)) throw bad('Esa mesa no existe.')
  if (d.startsAt < iso(now())) throw bad('Esa hora ya pasó.')
  const id = newId()
  db.prepare("INSERT INTO table_reservations (id, business_id, table_id, starts_at, people, name, phone, notes, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,'pendiente',?,?)").run(id, u.business_id, d.tableId ?? null, d.startsAt, d.people, d.name, d.phone ?? null, d.notes ?? null, u.id, iso(now()))
  return c.json({ id, status: 'pendiente' }, 201)
})

dining.get('/table-reservations', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const date = c.req.query('date') ?? localDate(now())
  const start = new Date(`${date}T06:00:00.000Z`).toISOString()
  const rows = db.prepare('SELECT r.*, t.name AS table_name FROM table_reservations r LEFT JOIN dining_tables t ON t.id = r.table_id WHERE r.business_id = ? AND r.starts_at >= ? AND r.starts_at < ? ORDER BY r.starts_at').all(c.get('session').user.business_id, start, new Date(Date.parse(start) + 86_400_000).toISOString())
  return c.json({ reservations: rows })
})

/** Las confirma el dueño o el encargado. */
dining.post('/table-reservations/:id/:action', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const map: Record<string, { from: string[]; to: string }> = { confirm: { from: ['pendiente'], to: 'confirmada' }, arrived: { from: ['confirmada', 'pendiente'], to: 'llego' }, 'no-show': { from: ['confirmada', 'pendiente'], to: 'no_llego' }, cancel: { from: ['pendiente', 'confirmada'], to: 'cancelada' } }
  const act = map[c.req.param('action')]
  if (!act) throw notFound()
  if (c.req.param('action') === 'confirm' && !isManager(u)) throw forbidden('Las reservas las confirma el dueño o el encargado.')
  const r = db.prepare('SELECT * FROM table_reservations WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; status: string } | undefined
  if (!r) throw notFound()
  if (!act.from.includes(r.status)) throw conflict(`La reserva está ${r.status}.`, 'estado_invalido')
  db.prepare('UPDATE table_reservations SET status = ?, confirmed_by = COALESCE(confirmed_by, ?) WHERE id = ?').run(act.to, act.to === 'confirmada' ? u.id : null, r.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: `reserva_mesa.${act.to}`, entity: 'table_reservation', entityId: r.id })
  return c.json({ status: act.to })
})

// ---------- Renta de activos (sillas, camastros, sombrillas) ----------

dining.post('/rental-assets', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(60), quantity: z.number().int().min(0).max(10_000), price: z.number().int().min(0) }), await body(c))
  const id = newId()
  db.prepare('INSERT INTO rental_assets (id, business_id, name, quantity, price, created_at) VALUES (?,?,?,?,?,?)').run(id, u.business_id, d.name, d.quantity, d.price, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'renta.activo_alta', entity: 'rental_asset', entityId: id, newValue: d })
  return c.json({ id }, 201)
})

const outOf = (db: Db, assetId: string) => (db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM asset_rentals WHERE asset_id = ? AND returned_at IS NULL').get(assetId) as { n: number }).n

dining.get('/rental-assets', (c) => {
  const { db } = c.get('deps')
  const rows = db.prepare('SELECT id, name, quantity, price FROM rental_assets WHERE business_id = ? AND active = 1 ORDER BY name').all(c.get('session').user.business_id) as { id: string; quantity: number }[]
  return c.json({ assets: rows.map((a) => ({ ...a, out: outOf(db, a.id), available: a.quantity - outOf(db, a.id) })) })
})

dining.post('/tabs/:id/rentals', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const t = loadTab(c)
  if (!['abierta', 'por_cobrar'].includes(t.status)) throw conflict('Esa cuenta ya está cerrada.', 'cuenta_cerrada')
  const d = parse(z.object({ assetId: z.string(), quantity: z.number().int().min(1).max(500) }), await body(c))
  const a = db.prepare('SELECT * FROM rental_assets WHERE id = ? AND business_id = ? AND active = 1').get(d.assetId, u.business_id) as { id: string; name: string; quantity: number; price: number } | undefined
  if (!a) throw bad('Ese activo no existe.')
  const id = db.transaction(() => {
    const available = a.quantity - outOf(db, a.id)
    if (d.quantity > available) throw conflict(`Solo hay ${available} ${a.name} disponibles.`, 'sin_disponibles')
    const itemId = newId()
    db.prepare("INSERT INTO tab_items (id, tab_id, description, quantity, unit_price, status, created_by, created_at) VALUES (?,?,?,?,?,'entregado',?,?)").run(itemId, t.id, `Renta: ${a.name}`, d.quantity, a.price, u.id, iso(now()))
    const rid = newId()
    db.prepare('INSERT INTO asset_rentals (id, asset_id, tab_id, tab_item_id, quantity, out_at) VALUES (?,?,?,?,?,?)').run(rid, a.id, t.id, itemId, d.quantity, iso(now()))
    return rid
  })()
  return c.json({ rentalId: id, tab: tabView(db, loadTab(c)) }, 201)
})

dining.post('/rentals/:id/return', requirePerm('sell'), (c) => {
  const { db, now } = c.get('deps')
  const r = db.prepare('SELECT ar.id, ar.returned_at FROM asset_rentals ar JOIN rental_assets a ON a.id = ar.asset_id WHERE ar.id = ? AND a.business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as { id: string; returned_at: string | null } | undefined
  if (!r) throw notFound()
  if (r.returned_at) throw conflict('Ya se había regresado.')
  db.prepare('UPDATE asset_rentals SET returned_at = ? WHERE id = ?').run(iso(now()), r.id)
  return c.json({ ok: true })
})
