import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('automatización de inventario: qué comprar y qué no se mueve', () => {
  it('sugiere comprar según el ritmo real de ventas y muestra el dinero parado en lo que no se vende', async () => {
    const { s, T, o, product, buy, open, sell } = await negocioListo()
    const rapido = await product({ name: 'Refresco', unit: 'pieza', price: 2000, minStock: 5 })
    const lento = await product({ name: 'Adorno', unit: 'pieza', price: 9000 })
    await buy([{ productId: rapido.id, quantity: 10, cost: 10_000 }, { productId: lento.id, quantity: 4, cost: 20_000 }])
    s.db.prepare("UPDATE products SET created_at = '2020-01-01T00:00:00.000Z'").run() // llevan tiempo en el catálogo
    await open(10_000)
    await sell([{ productId: rapido.id, quantity: 8 }])
    const r = (await s.call('GET', '/inventory/replenishment', { token: T })).json
    // Refresco: quedan 2, mínimo 5 → conviene comprar 3 (costo $10 c/u).
    const a = r.toBuy.find((x: any) => x.name === 'Refresco')
    expect(a).toMatchObject({ stock: 2, minStock: 5, suggested: 3, estCost: 3000 })
    expect(a.daysLeft).toBeGreaterThan(0)
    expect(r.toBuy.find((x: any) => x.name === 'Adorno')).toBeUndefined()
    // Adorno: 4 piezas sin una sola venta → $200 parados ($50 c/u).
    expect(r.slow).toEqual([expect.objectContaining({ name: 'Adorno', stock: 4, tiedUp: 20_000 })])
    expect(r.tiedUp).toBe(20_000)
    expect(r.toBuyCost).toBe(3000)
    // Quien no edita inventario (y por tanto no debe ver costos) no lo recibe.
    const piso = await s.createStaff(T, o.business.code, 'pisoinv', 'empleado_piso', { permissions: ['view_inventory'] })
    expect((await s.call('GET', '/inventory/replenishment', { token: piso.token })).status).toBe(403)
  })
})
