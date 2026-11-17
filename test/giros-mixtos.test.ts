import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

describe('negocios mixtos', () => {
  it('los giros se eligen al crear la cuenta y el dueño no los cambia después', async () => {
    const s = setup()
    const r = await s.call('POST', '/auth/register', { body: { businessName: 'Tienda y papelería', ownerName: 'Eva', phone: '5544441111', password: 'secreto123', giro: 'abarrotes', extraGiros: ['papeleria', 'abarrotes', 'papeleria'] } })
    const v = await s.call('POST', '/auth/register/verify', { body: { challengeId: r.json.challengeId, code: s.codes['5544441111'] } })
    const T = v.json.token
    let me = (await s.call('GET', '/auth/me', { token: T })).json
    expect(me.business.giros).toEqual(['abarrotes', 'papeleria'])
    // Desde Ajustes ya no se cambian los giros (se ignoran).
    await s.call('PATCH', '/business', { token: T, body: { giro: 'barberia', extraGiros: ['restaurante'] } })
    me = (await s.call('GET', '/auth/me', { token: T })).json
    expect(me.business.giros).toEqual(['abarrotes', 'papeleria'])
    // Soporte sí puede cambiarlos.
    const adm = await s.adminToken()
    const p = await s.call('PATCH', `/admin/businesses/${me.business.id}`, { token: adm, body: { giro: 'papeleria', extraGiros: [] } })
    expect(p.json.business.giros).toEqual(['papeleria'])
    expect((await s.call('PATCH', `/admin/businesses/${me.business.id}`, { token: adm, body: { extraGiros: ['zapateria'] } })).status).toBe(400)
  })

  it('el super panel da de alta un negocio mixto', async () => {
    const s = setup()
    const adm = await s.adminToken()
    const r = await s.call('POST', '/admin/businesses', { token: adm, body: { businessName: 'Tienda y fonda', ownerName: 'Eva', phone: '5544443333', tempPassword: 'temporal123', giro: 'abarrotes', extraGiros: ['comedor'] } })
    expect(r.status).toBe(201)
    expect(r.json.business.giros).toEqual(['abarrotes', 'comedor'])
  })
})
