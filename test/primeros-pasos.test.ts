import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

const pasos = async (s: ReturnType<typeof setup>, T: string) => (await s.call('GET', '/today', { token: T })).json.tasks.find((t: any) => t.key === 'primeros_pasos')

describe('primeros pasos por giro', () => {
  it('abarrotes: código, productos y primera venta; desaparece al terminar', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const T = o.token
    await s.call('PATCH', '/business', { token: T, body: { forcePasswordChange: false } })
    let p = await pasos(s, T)
    expect(p.items.map((i: any) => i.label)).toEqual(['Pon tu código de autorización', 'Agrega tus productos', 'Haz tu primera venta', 'Da de alta a tu personal (opcional)'])
    expect(p.screen).toBe('usuarios')
    const me = (await s.call('GET', '/auth/me', { token: T })).json.user
    await s.call('PUT', `/users/${me.id}/auth-code`, { token: T, body: { code: '4321' } })
    const prod = (await s.call('POST', '/products', { token: T, body: { name: 'Arroz', unit: 'pieza', price: 3000 } })).json.product
    p = await pasos(s, T)
    expect(p.title).toContain('faltan 2 de 4')
    expect(p.screen).toBe('caja')
    await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 0 } })
    await s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ productId: prod.id, quantity: 1 }] } })
    // Solo queda lo opcional: ya no se muestra.
    expect(await pasos(s, T)).toBeUndefined()
  })

  it('barbería pide servicios y horario; el personal no ve primeros pasos; después de 60 días ya no aparece', async () => {
    const s = setup()
    const o = await s.registerOwner()
    s.setGiro('barberia')
    await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
    const p = await pasos(s, o.token)
    expect(p.items.map((i: any) => i.label)).toContain('Da de alta tus servicios')
    expect(p.items.map((i: any) => i.label)).toContain('Marca quién atiende citas y su horario')
    const st = await s.createStaff(o.token, o.business.code, 'juan', 'barbero')
    await s.call('POST', '/auth/change-password', { token: st.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
    expect(await pasos(s, st.token)).toBeUndefined()
    s.advance(61 * 86_400_000); s.longLived()
    expect(await pasos(s, o.token)).toBeUndefined()
  })
})
