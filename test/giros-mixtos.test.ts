import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

describe('negocios mixtos', () => {
  it('el dueño agrega giros adicionales y el sistema los toma en cuenta', async () => {
    const s = setup()
    const o = await s.registerOwner()
    let me = (await s.call('GET', '/auth/me', { token: o.token })).json
    expect(me.business.giros).toEqual(['abarrotes'])
    const r = await s.call('PATCH', '/business', { token: o.token, body: { extraGiros: ['papeleria', 'abarrotes', 'papeleria', 'restaurante'] } })
    expect(r.status).toBe(200)
    me = (await s.call('GET', '/auth/me', { token: o.token })).json
    expect(me.business.giro).toBe('abarrotes')
    expect(me.business.giros).toEqual(['abarrotes', 'papeleria', 'restaurante'])
    // Cambiar el giro principal a uno de los adicionales no lo duplica.
    await s.call('PATCH', '/business', { token: o.token, body: { giro: 'papeleria' } })
    me = (await s.call('GET', '/auth/me', { token: o.token })).json
    expect(me.business.giros).toEqual(['papeleria', 'abarrotes', 'restaurante'])
    expect((await s.call('PATCH', '/business', { token: o.token, body: { extraGiros: ['zapateria'] } })).status).toBe(400)
  })

  it('el super panel da de alta un negocio mixto', async () => {
    const s = setup()
    const adm = await s.adminToken()
    const r = await s.call('POST', '/admin/businesses', { token: adm, body: { businessName: 'Tienda y fonda', ownerName: 'Eva', phone: '5544443333', tempPassword: 'temporal123', giro: 'abarrotes', extraGiros: ['comedor'] } })
    expect(r.status).toBe(201)
    expect(r.json.business.giros).toEqual(['abarrotes', 'comedor'])
  })
})
