import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

describe('cuentas gratis desde el super panel', () => {
  it('un negocio gratis no vence ni paga; al quitarlo tiene días para su primer pago', async () => {
    const s = setup()
    let at = await s.adminToken()
    const o = await s.registerOwner('5591112222')
    const id = o.business.id
    // Hacerlo gratis pide motivo.
    expect((await s.call('POST', `/admin/businesses/${id}/free`, { token: at, body: { free: true } })).status).toBe(400)
    const r = await s.call('POST', `/admin/businesses/${id}/free`, { token: at, body: { free: true, reason: 'Cortesía a un amigo' } })
    expect(r.json.business).toMatchObject({ free: true, status: 'activo', monthlyFee: 0, paidUntil: null })
    // Pasa un año y sigue activo; no se le puede registrar pago.
    s.advance(400 * 86_400_000)
    s.longLived()
    at = await s.adminToken()
    expect((await s.call('GET', `/admin/businesses/${id}`, { token: at })).json.business.status).toBe('activo')
    expect((await s.call('GET', '/auth/me', { token: o.token })).status).toBe(200)
    expect((await s.call('POST', `/admin/businesses/${id}/payments`, { token: at, body: { months: 1 } })).json.error.code).toBe('cuenta_gratis')
    // Filtro «Gratis» del panel.
    const list = (await s.call('GET', '/admin/businesses?status=gratis', { token: at })).json.businesses
    expect(list.map((b: any) => b.id)).toEqual([id])
    expect((await s.call('GET', '/admin/businesses?status=activo', { token: at })).json.businesses).toHaveLength(0)

    // Quitar lo gratis: 10 días para pagar y luego vence.
    const q = await s.call('POST', `/admin/businesses/${id}/free`, { token: at, body: { free: false, reason: 'Termina la cortesía', graceDays: 10 } })
    expect(q.json.business).toMatchObject({ free: false, status: 'activo' })
    expect(q.json.business.monthlyFee).toBeGreaterThan(0)
    s.advance(11 * 86_400_000)
    at = await s.adminToken()
    expect((await s.call('GET', `/admin/businesses/${id}`, { token: at })).json.business.status).toBe('vencido')
    expect((await s.call('POST', `/admin/businesses/${id}/payments`, { token: at, body: { months: 1 } })).status).toBe(201)
  })

  it('alta asistida directamente gratis', async () => {
    const s = setup()
    let at = await s.adminToken()
    const r = await s.call('POST', '/admin/businesses', { token: at, body: { businessName: 'Tienda Amiga', ownerName: 'Rosa Díaz', phone: '5593334444', tempPassword: 'temporal123', free: true } })
    expect(r.json.business).toMatchObject({ free: true, status: 'activo', monthlyFee: 0 })
    s.advance(90 * 86_400_000)
    at = await s.adminToken()
    expect((await s.call('GET', `/admin/businesses/${r.json.business.id}`, { token: at })).json.business.status).toBe('activo')
  })
})
