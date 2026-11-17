import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db-node.js'
import { createAdmin } from '../src/admin.js'

// Sin proveedor de SMS: todo se maneja con usuario y contraseña; soporte da contraseñas temporales.
describe('sin SMS configurado', () => {
  const deps = { db: openDb(':memory:'), now: () => new Date('2026-11-17T15:00:00Z'), notifier: { smsEnabled: false, mailEnabled: false, sendCode: () => false } }
  const app = createApp(deps)
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: (await r.json()) as any }
  }

  it('registro, entrada, recuperación con soporte y contraseña temporal', async () => {
    const reg = await call('POST', '/auth/register', { businessName: 'Tienda', ownerName: 'Ana', phone: '5511112222', password: 'secreto123' })
    expect(reg.status).toBe(201)
    expect(reg.json.token).toBeTruthy()
    const login = await call('POST', '/auth/owner/login', { phone: '5511112222', password: 'secreto123' })
    expect(login.json.token).toBeTruthy()
    const rec = await call('POST', '/auth/owner/recover', { phone: '5511112222' })
    expect(rec.json.error.code).toBe('recuperar_con_soporte')

    createAdmin(deps, { name: 'S', username: 'soporte', password: 'superpanel1', phone: '5500000001', email: 'a@b.c' })
    const adm = (await call('POST', '/admin/login', { username: 'soporte', password: 'superpanel1' })).json.token
    expect(adm).toBeTruthy()
    const biz = reg.json.business.id
    expect((await call('POST', `/admin/businesses/${biz}/verify-owner`, undefined, adm)).json.error.code).toBe('sin_sms')
    const owner = (await call('GET', `/admin/businesses/${biz}`, undefined, adm)).json.business.owner
    const reset = await call('POST', `/admin/businesses/${biz}/users/${owner.id}/reset-password`, { newPassword: 'Temporal99', reason: 'Confirmado por llamada' }, adm)
    expect(reset.json.ok).toBe(true)
    const again = await call('POST', '/auth/owner/login', { phone: '5511112222', password: 'Temporal99' })
    expect(again.json.mustChangePassword).toBe(true)
  })
})
