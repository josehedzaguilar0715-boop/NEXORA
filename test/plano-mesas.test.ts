import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('plano de mesas', () => {
  it('quien configura acomoda las mesas; el cajero las ve pero no las mueve; se ignoran mesas ajenas', async () => {
    const { s, o, T } = await negocioListo()
    s.setGiro('restaurante')
    const mesero = await s.createStaff(T, o.business.code, 'mesero1', 'cajero')
    const m1 = (await s.call('POST', '/tables', { token: T, body: { name: '1', area: 'salon', seats: 4 } })).json.id as string
    expect((await s.call('GET', '/tables/plan', { token: T })).json.plan).toEqual({})
    const r = await s.call('PUT', '/tables/plan', { token: T, body: { [m1]: { x: 20, y: 30 }, 'mesa-ajena': { x: 1, y: 1 } } })
    expect(r.status).toBe(200)
    expect(r.json.plan).toEqual({ [m1]: { x: 20, y: 30 } })
    // El cajero lo ve igual que el dueño...
    expect((await s.call('GET', '/tables/plan', { token: mesero.token })).json.plan[m1]).toEqual({ x: 20, y: 30 })
    // ...pero no puede cambiarlo.
    expect((await s.call('PUT', '/tables/plan', { token: mesero.token, body: { [m1]: { x: 50, y: 50 } } })).status).toBe(403)
    // Posiciones fuera de rango se rechazan.
    expect((await s.call('PUT', '/tables/plan', { token: T, body: { [m1]: { x: 500, y: 0 } } })).status).toBe(400)
    expect((await s.call('GET', '/tables/plan', { token: mesero.token })).json.plan[m1]).toEqual({ x: 20, y: 30 })
  })
})
