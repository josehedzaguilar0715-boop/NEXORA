import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, parse, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { tabItemValidators } from './dining.js'
import { getProduct } from './inventory.js'
import { saleValidators } from './sales.js'
import { AppError, bad, iso, localDate, newId, notFound, type Clock } from './util.js'

/** Menú del día (comedor) o guisados del día (taquería): lo publica el encargado con código; los agotados no se venden. */
export const menus = new Hono<Env>()

const MEALS = ['dia', 'desayuno', 'comida', 'cena'] as const
interface MenuItem { productId: string; soldOut: boolean }

/** Turno de comida según la hora local (configurable después si el cliente lo pide). */
export function mealAt(d: Date): (typeof MEALS)[number] {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', hourCycle: 'h23' }).format(d))
  return h < 12 ? 'desayuno' : h < 18 ? 'comida' : 'cena'
}

/** Menús publicados hoy (del turno actual y el de todo el día). */
function todaysMenus(db: Db, businessId: string, now: Date) {
  return db.prepare("SELECT * FROM daily_menus WHERE business_id = ? AND date = ? AND meal IN ('dia', ?)").all(businessId, localDate(now), mealAt(now)) as { id: string; items: string }[]
}

export function isSoldOut(db: Db, businessId: string, productId: string, now: Date): boolean {
  return todaysMenus(db, businessId, now).some((m) => (JSON.parse(m.items) as MenuItem[]).some((i) => i.productId === productId && i.soldOut))
}

const check = (db: Db, businessId: string, productId: string | null, now: Clock) => {
  if (productId && isSoldOut(db, businessId, productId, now())) {
    const p = db.prepare('SELECT name FROM products WHERE id = ?').get(productId) as { name: string }
    throw new AppError(409, 'agotado', `${p.name} ya se agotó.`)
  }
}
saleValidators.push(({ deps, user, lines }) => { for (const l of lines) check(deps.db, user.business_id, l.productId, deps.now) })
tabItemValidators.push(({ db, user, productId, now }) => check(db, user.business_id, productId, () => now))

menus.post('/daily-menu', requirePerm('configure_catalog'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const u = c.get('session').user
  const d = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), meal: z.enum(MEALS).default('dia'), productIds: z.array(z.string()).min(1).max(100), authCode: z.string().optional() }), await body(c))
  const auth = authorize(deps, u, d.authCode, 'configure_catalog', 'publicar menú del día')
  for (const id of d.productIds) getProduct(db, u.business_id, id)
  const date = d.date ?? localDate(now())
  const items: MenuItem[] = d.productIds.map((productId) => ({ productId, soldOut: false }))
  const prev = db.prepare('SELECT id, items FROM daily_menus WHERE business_id = ? AND date = ? AND meal = ?').get(u.business_id, date, d.meal) as { id: string; items: string } | undefined
  const id = prev?.id ?? newId()
  db.prepare('INSERT INTO daily_menus (id, business_id, date, meal, items, published_by, authorized_by, published_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(business_id, date, meal) DO UPDATE SET items = excluded.items, published_by = excluded.published_by, authorized_by = excluded.authorized_by, published_at = excluded.published_at').run(
    id, u.business_id, date, d.meal, JSON.stringify(items), u.id, auth.id, iso(now()),
  )
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'menu_del_dia.publicado', entity: 'daily_menu', entityId: id, oldValue: prev ? JSON.parse(prev.items) : undefined, newValue: { date, meal: d.meal, items: d.productIds.length }, authorizedBy: auth.id })
  return c.json({ id, date, meal: d.meal }, 201)
})

menus.get('/daily-menu', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const date = c.req.query('date') ?? localDate(now())
  const rows = db.prepare('SELECT * FROM daily_menus WHERE business_id = ? AND date = ? ORDER BY meal').all(u.business_id, date) as { id: string; meal: string; items: string; published_at: string }[]
  return c.json({
    date, currentMeal: mealAt(now()),
    menus: rows.map((m) => ({
      id: m.id, meal: m.meal, publishedAt: m.published_at,
      items: (JSON.parse(m.items) as MenuItem[]).map((i) => {
        const p = db.prepare('SELECT name, price FROM products WHERE id = ?').get(i.productId) as { name: string; price: number }
        return { ...i, name: p.name, price: p.price }
      }),
    })),
  })
})

/** Marcar agotado (o volver a tener): deja de aparecer para vender. */
menus.post('/daily-menu/:id/sold-out', requirePerm('sell'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ productId: z.string(), soldOut: z.boolean() }), await body(c))
  const m = db.prepare('SELECT * FROM daily_menus WHERE id = ? AND business_id = ?').get(c.req.param('id'), u.business_id) as { id: string; items: string } | undefined
  if (!m) throw notFound()
  const items = JSON.parse(m.items) as MenuItem[]
  const it = items.find((i) => i.productId === d.productId)
  if (!it) throw bad('Ese platillo no está en el menú.')
  it.soldOut = d.soldOut
  db.prepare('UPDATE daily_menus SET items = ? WHERE id = ?').run(JSON.stringify(items), m.id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: d.soldOut ? 'menu_del_dia.agotado' : 'menu_del_dia.disponible', entity: 'daily_menu', entityId: m.id, newValue: d })
  return c.json({ ok: true })
})

/** Lo más vendido (para los botones grandes de venta rápida). */
menus.get('/products/top', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const days = Math.min(Number(c.req.query('days') ?? 30) || 30, 365)
  const since = new Date(now().getTime() - days * 86_400_000).toISOString()
  const rows = db.prepare("SELECT si.product_id AS id, p.name, p.price, SUM(si.quantity) qty FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id WHERE s.business_id = ? AND s.status = 'completada' AND s.created_at >= ? AND p.active = 1 AND p.sellable = 1 GROUP BY si.product_id ORDER BY qty DESC LIMIT ?").all(u.business_id, since, Math.min(Number(c.req.query('limit') ?? 12) || 12, 50)) as { id: string }[]
  return c.json({ products: rows.map((r) => ({ ...r, soldOut: isSoldOut(db, u.business_id, r.id, now()) })) })
})
