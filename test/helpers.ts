import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db.js'

export function setup() {
  const db = openDb(':memory:')
  const codes: Record<string, string> = {}
  const clock = { t: new Date('2026-11-17T15:00:00Z') }
  const app = createApp({ db, now: () => new Date(clock.t), notifier: { sendCode: (p, c) => void (codes[p] = c) } })
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
  return { app, db, call, codes, advance, registerOwner, createStaff, uuid: randomUUID }
}
