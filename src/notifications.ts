import { Hono } from 'hono'
import { z } from 'zod'
import { body, parse, type Deps, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { iso, newId } from './util.js'

/**
 * Avisos para el dueño y el personal: se guardan en la base (campana dentro de la app) y,
 * si la persona lo activó, llegan al celular por Web Push.
 *
 * Push sin servicios de pago: llaves VAPID propias (se generan una vez y viven en la base) y
 * avisos sin contenido cifrado: el celular solo recibe "hay algo nuevo" y el service worker
 * pide el aviso a la API con la sesión guardada.
 *
 * Audiencia: 'owner' (dueños), 'perm:<permiso>' (empleados que tengan ese permiso) o 'user:<id>'.
 */

export interface NewNotice {
  kind: string
  title: string
  body?: string
  link?: string
  audience: string[]
  /** Evita repetir el mismo aviso (p. ej. stock bajo del mismo producto el mismo día). */
  dedupe?: string
}

interface NoticeRow { id: string; business_id: string; kind: string; title: string; body: string | null; link: string | null; audience: string; created_at: string }

export function sees(u: Pick<UserRow, 'id' | 'role' | 'permissions'>, audience: string[]): boolean {
  if (u.role === 'owner' && audience.includes('owner')) return true
  if (audience.includes(`user:${u.id}`)) return true
  if (u.role === 'owner') return false
  const perms = JSON.parse(u.permissions) as string[]
  return audience.some((a) => a.startsWith('perm:') && perms.includes(a.slice(5)))
}

/** Guarda el aviso y lo manda a los celulares suscritos de quienes deben verlo. */
export function notify(deps: Deps, businessId: string, n: NewNotice) {
  const { db, now } = deps
  if (n.dedupe && db.prepare('SELECT 1 FROM notifications WHERE business_id = ? AND dedupe = ?').get(businessId, n.dedupe)) return null
  const id = newId()
  db.prepare('INSERT INTO notifications (id, business_id, kind, title, body, link, audience, dedupe, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, businessId, n.kind, n.title.slice(0, 120), n.body?.slice(0, 300) ?? null, n.link ?? null, JSON.stringify(n.audience), n.dedupe ?? null, iso(now()),
  )
  const users = (db.prepare('SELECT id, role, permissions FROM users WHERE business_id = ? AND active = 1').all(businessId) as Pick<UserRow, 'id' | 'role' | 'permissions'>[]).filter((u) => sees(u, n.audience))
  if (users.length) {
    const subs = db.prepare(`SELECT id, endpoint FROM push_subscriptions WHERE user_id IN (${users.map(() => '?').join(',')})`).all(...users.map((u) => u.id)) as { id: string; endpoint: string }[]
    if (subs.length) {
      const job = sendPushes(deps, subs).catch((e) => console.error('[push]', (e as Error).message))
      if (deps.defer) deps.defer(job)
    }
  }
  return id
}

// ---------- Web Push (VAPID, sin contenido) ----------

const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Llaves VAPID del servidor: se crean la primera vez y se guardan en la base. */
export async function vapidKeys(db: Db): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const row = db.prepare("SELECT value FROM app_keys WHERE key = 'vapid'").get() as { value: string } | undefined
  if (row) return JSON.parse(row.value)
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const value = { publicKey, privateJwk }
  db.prepare("INSERT OR IGNORE INTO app_keys (key, value) VALUES ('vapid', ?)").run(JSON.stringify(value))
  return JSON.parse((db.prepare("SELECT value FROM app_keys WHERE key = 'vapid'").get() as { value: string }).value)
}

async function vapidAuth(db: Db, endpoint: string, nowMs: number) {
  const { publicKey, privateJwk } = await vapidKeys(db)
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const enc = (o: object) => b64u(new TextEncoder().encode(JSON.stringify(o)))
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: 'mailto:avisos@nexora.mx' })}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned))
  return `vapid t=${unsigned}.${b64u(sig)}, k=${publicKey}`
}

/** Solo se aceptan servicios de push conocidos (evita que la API haga peticiones a cualquier lado). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.services\.mozilla\.com$/]
export const allowedEndpoint = (e: string) => {
  try { const u = new URL(e); return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname)) } catch { return false }
}

async function sendPushes(deps: Deps, subs: { id: string; endpoint: string }[]) {
  const { db, now } = deps
  // Uno que falle (red, servicio caído) no detiene a los demás.
  const results = await Promise.allSettled(subs.map(async (s) => {
    const res = await fetch(s.endpoint, { method: 'POST', headers: { authorization: await vapidAuth(db, s.endpoint, now().getTime()), ttl: '86400', urgency: 'high', 'content-length': '0' } })
    // 404/410: el celular ya no tiene esa suscripción.
    if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id)
    else if (!res.ok) throw new Error(`${new URL(s.endpoint).hostname} respondió ${res.status}`)
  }))
  for (const r of results) if (r.status === 'rejected') console.error('[push]', (r.reason as Error).message)
}

// ---------- Rutas ----------

export const notifications = new Hono<Env>()

const visible = (db: Db, u: UserRow, limit: number) =>
  (db.prepare('SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT 300').all(u.business_id) as NoticeRow[])
    .filter((n) => sees(u, JSON.parse(n.audience)))
    .slice(0, limit)

notifications.get('/notifications', (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const seen = (db.prepare('SELECT seen_at FROM notification_seen WHERE user_id = ?').get(u.id) as { seen_at: string } | undefined)?.seen_at ?? ''
  const items = visible(db, u, 40).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.created_at, unread: n.created_at > seen }))
  const push = !!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1').get(u.id)
  return c.json({ items, unread: items.filter((i) => i.unread).length, push })
})

notifications.post('/notifications/seen', (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  db.prepare('INSERT INTO notification_seen (user_id, seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at').run(u.id, iso(now()))
  return c.json({ ok: true })
})

/** Para el service worker: el aviso más reciente que esta persona puede ver. */
notifications.get('/notifications/latest', (c) => {
  const { db } = c.get('deps')
  const n = visible(db, c.get('session').user, 1)[0]
  return c.json({ notice: n ? { id: n.id, title: n.title, body: n.body, link: n.link } : null })
})

notifications.get('/push/key', async (c) => c.json({ publicKey: (await vapidKeys(c.get('deps').db)).publicKey }))

notifications.post('/push/subscribe', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ endpoint: z.string().url().max(1000) }), await body(c))
  if (!allowedEndpoint(d.endpoint)) return c.json({ error: { code: 'push_no_valido', message: 'Ese servicio de avisos no es compatible.' } }, 400)
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(d.endpoint)
  db.prepare('INSERT INTO push_subscriptions (id, business_id, user_id, endpoint, created_at) VALUES (?,?,?,?,?)').run(newId(), u.business_id, u.id, d.endpoint, iso(now()))
  return c.json({ ok: true }, 201)
})

notifications.post('/push/unsubscribe', async (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ endpoint: z.string().max(1000).optional() }), await body(c))
  if (d.endpoint) db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(u.id, d.endpoint)
  else db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(u.id)
  return c.json({ ok: true })
})

/** Prueba: manda un aviso solo a quien lo pide. */
notifications.post('/notifications/test', (c) => {
  const u = c.get('session').user
  notify(c.get('deps'), u.business_id, { kind: 'prueba', title: 'Avisos activados', body: 'Así te llegarán los pedidos, citas y alertas de tu negocio.', audience: [`user:${u.id}`] })
  return c.json({ ok: true })
})

// ---------- Avisos de cada evento ----------

const money = (c: number) => `$${(c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Después de vender: avisa una vez al día por producto si quedó debajo de su mínimo. */
export function stockAlerts(deps: Deps, businessId: string, branchId: string, productIds: string[], stockOf: (db: Db, branchId: string, productId: string) => number) {
  const { db, now } = deps
  const day = iso(now()).slice(0, 10)
  for (const id of [...new Set(productIds)]) {
    const p = db.prepare('SELECT name, unit, min_stock_milli FROM products WHERE id = ? AND active = 1').get(id) as { name: string; unit: string; min_stock_milli: number } | undefined
    if (!p || p.min_stock_milli <= 0) continue
    const st = stockOf(db, branchId, id)
    if (st >= p.min_stock_milli) continue
    const unit = p.unit === 'pieza' ? 'pzas' : p.unit
    notify(deps, businessId, { kind: 'stock', title: `Stock bajo: ${p.name}`, body: `Quedan ${Math.max(0, st) / 1000} ${unit} (mínimo ${p.min_stock_milli / 1000}). Ya está en tu pedido sugerido.`, link: '#/productos', audience: ['owner', 'perm:edit_inventory'], dedupe: `stock:${id}:${day}` })
  }
}

export function saleCancelledNotice(deps: Deps, businessId: string, by: { name: string; role: string }, folio: number, total: number, reason: string) {
  if (by.role === 'owner') return
  notify(deps, businessId, { kind: 'cancelacion', title: `Venta #${folio} cancelada (${money(total)})`, body: `${by.name}: ${reason}`, link: '#/reportes', audience: ['owner'] })
}

export function cashDifferenceNotice(deps: Deps, businessId: string, by: { name: string; role: string }, difference: number, reason: string | null) {
  if (!difference || by.role === 'owner') return
  notify(deps, businessId, { kind: 'corte', title: `Corte de ${by.name} con ${difference < 0 ? 'faltante' : 'sobrante'} de ${money(Math.abs(difference))}`, body: reason ?? undefined, link: '#/caja', audience: ['owner'] })
}
