import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db-node.js'
import { createAdmin } from '../src/admin.js'

export function setup() {
  const db = openDb(':memory:')
  const codes: Record<string, string> = {}
  const clock = { t: new Date('2026-11-17T15:00:00Z') }
  const deps = { db, now: () => new Date(clock.t), notifier: { sendCode: (p: string, c: string) => void (codes[p] = c) } }
  const app = createApp(deps)
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    return { status: res.status, json: (await res.json()) as any }
  }
  const advance = (ms: number) => void (clock.t = new Date(clock.t.getTime() + ms))

  async function registerOwner(phone = '5512345678', password = 'secreto123') {
    const r = await call('POST', '/auth/register', { body: { businessName: 'Abarrotes Prueba', ownerName: 'Dueño', phone, password } })
    const v = await call('POST', '/auth/register/verify', { body: { challengeId: r.json.challengeId, code: codes[phone] } })
    return { token: v.json.token as string, business: v.json.business as { id: string; code: string }, phone, password }
  }
  async function createStaff(ownerToken: string, businessCode: string, username: string, template: string, extra: Record<string, unknown> = {}) {
    const r = await call('POST', '/users', { token: ownerToken, body: { name: username, username, password: 'inicial123', template, ...extra } })
    const l = await call('POST', '/auth/login', { body: { businessCode, username, password: 'inicial123' } })
    return { id: r.json.user?.id as string, token: l.json.token as string }
  }
  let adminCreated = false
  async function adminToken() {
    if (!adminCreated) createAdmin(deps, { name: 'Soporte', username: 'soporte', password: 'superpanel1' })
    adminCreated = true
    return (await call('POST', '/admin/login', { body: { username: 'soporte', password: 'superpanel1' } })).json.token as string
  }
  /** Para pruebas que avanzan muchos días: el negocio queda al corriente y las sesiones no vencen. */
  const longLived = () => {
    db.prepare("UPDATE businesses SET trial_ends_at = '2100-01-01T00:00:00.000Z'").run()
    db.prepare("UPDATE sessions SET expires_at = '2100-01-01T00:00:00.000Z'").run()
  }
  /** Habilita un extra de pago (lo haría el super panel) en todos los negocios de la prueba. */
  /** Cambia el giro de los negocios de la prueba (como lo haría soporte desde el super panel). */
  const setGiro = (giro: string) => void db.prepare('UPDATE businesses SET giro = ?').run(giro)
  const addon = (name: string) => void db.prepare("UPDATE businesses SET addons = json_insert(addons, '$[#]', ?)").run(name)
  return { setGiro, addon, longLived, adminToken, app, db, call, codes, advance, registerOwner, createStaff, uuid: randomUUID }
}

/** Negocio listo para vender: dueño con código 4321, sin cambio forzado de contraseña. */
export async function negocioListo() {
  const s = setup()
  const o = await s.registerOwner()
  const T = o.token
  await s.call('PATCH', '/business', { token: T, body: { forcePasswordChange: false, phone: '5511112222' } })
  const me = (await s.call('GET', '/auth/me', { token: T })).json.user
  await s.call('PUT', `/users/${me.id}/auth-code`, { token: T, body: { code: '4321' } })
  const product = async (body: object) => (await s.call('POST', '/products', { token: T, body })).json.product
  const buy = (items: any[], extra: object = {}) => s.call('POST', '/purchases', { token: T, body: { payment: 'contado', items, ...extra } })
  const open = (openingFloat = 10000) => s.call('POST', '/shifts/open', { token: T, body: { openingFloat } })
  const sell = (items: any[], extra: object = {}) => s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', items, ...extra } })
  const stock = async (id: string) => (await s.call('GET', `/products/${id}`, { token: T })).json.product.stock
  return { s, o, T, me, product, buy, open, sell, stock }
}
