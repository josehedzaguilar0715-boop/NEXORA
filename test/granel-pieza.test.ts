import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('a granel por pieza: se compra por bolsa o caja y se vende suelto', () => {
  it('3 cajas de 100 chicles a $55 = 300 piezas a $0.55; se venden sueltos con su ganancia', async () => {
    const { s, T, product, open, sell, stock } = await negocioListo()
    // Solo para productos por pieza.
    expect((await s.call('POST', '/products', { token: T, body: { name: 'Frijol', unit: 'kg', price: 3000, pack: { name: 'Costal', size: 50 } } })).status).toBe(400)
    const chicle = await product({ name: 'Chicle de menta', unit: 'pieza', price: 100, pack: { name: 'Caja', size: 100 }, minStock: 50 })
    expect(chicle.pack).toEqual({ name: 'Caja', size: 100 })

    const r = await s.call('POST', '/purchases', { token: T, body: { payment: 'contado', items: [{ productId: chicle.id, packs: 3, cost: 16500 }] } })
    expect(r.status).toBe(201)
    expect(await stock(chicle.id)).toBe(300)
    expect((await s.call('GET', `/products/${chicle.id}`, { token: T })).json.product.lastCost).toBeCloseTo(55)

    await open(0)
    await sell([{ productId: chicle.id, quantity: 10 }]) // 10 chicles a $1
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.sales.total).toBe(1000)
    expect(sum.costOfSales).toBe(550)
    expect(await stock(chicle.id)).toBe(290)

    // Por pieza también se puede seguir comprando, y sin caja definida no se acepta «packs».
    const sueltos = await product({ name: 'Paleta', unit: 'pieza', price: 500 })
    expect((await s.call('POST', '/purchases', { token: T, body: { payment: 'contado', items: [{ productId: sueltos.id, packs: 2, cost: 1000 }] } })).json.error.message).toContain('no tiene definido')
    expect((await s.call('POST', '/purchases', { token: T, body: { payment: 'contado', items: [{ productId: chicle.id, quantity: 20, cost: 1100 }] } })).status).toBe(201)
    expect(await stock(chicle.id)).toBe(310)

    // Se puede cambiar o quitar después.
    await s.call('PATCH', `/products/${chicle.id}`, { token: T, body: { pack: { name: 'Bolsa', size: 50 } } })
    expect((await s.call('GET', `/products/${chicle.id}`, { token: T })).json.product.pack).toEqual({ name: 'Bolsa', size: 50 })
    await s.call('PATCH', `/products/${chicle.id}`, { token: T, body: { pack: null } })
    expect((await s.call('GET', `/products/${chicle.id}`, { token: T })).json.product.pack).toBeNull()
  })
})
