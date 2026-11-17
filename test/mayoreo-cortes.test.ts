import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('mayoreo y cortes X / Z', () => {
  it('precio de mayoreo desde cierta cantidad en cualquier giro', async () => {
    const { s, T, product, open, sell } = await negocioListo()
    const p = await product({ name: 'Refresco', unit: 'pieza', price: 2000 })
    await s.call('PUT', `/products/${p.id}/price-tiers`, { token: T, body: { tiers: [{ minQuantity: 12, price: 1700 }] } })
    expect((await s.call('GET', `/products/${p.id}`, { token: T })).json.product.tiers).toEqual([{ minQuantity: 12, price: 1700 }])
    await open()
    expect((await sell([{ productId: p.id, quantity: 11 }])).json.sale.total).toBe(11 * 2000)
    expect((await sell([{ productId: p.id, quantity: 12 }])).json.sale.total).toBe(12 * 1700)
  })

  it('corte X no cierra y se numera; corte Z cierra con su número', async () => {
    const { s, T, open, sell } = await negocioListo()
    const shift = (await open(50000)).json.shift
    await sell([{ description: 'Varios', quantity: 1, unitPrice: 8200 }])
    const x1 = (await s.call('POST', `/shifts/${shift.id}/x-report`, { token: T })).json.report
    expect(x1).toMatchObject({ kind: 'X', number: 1, tickets: 1, salesTotal: 8200 })
    expect(x1.text).toContain('CORTE X #1')
    expect(x1.text).toContain('$582.00')
    expect((await s.call('POST', `/shifts/${shift.id}/x-report`, { token: T })).json.report.number).toBe(2)
    expect((await s.call('GET', '/shifts/current', { token: T })).json.shift.status).toBe('abierto')
    const z = (await s.call('POST', `/shifts/${shift.id}/close`, { token: T, body: { countedCash: 58000, reason: 'faltaron 2 pesos' } })).json.report
    expect(z).toMatchObject({ kind: 'Z', number: 1 })
    expect(z.text).toContain('CORTE Z #1')
    expect(z.text).toContain('Motivo: faltaron 2 pesos')
    expect((await s.call('GET', `/shifts/${shift.id}/z-report`, { token: T })).json.report.number).toBe(1)
    expect((await s.call('POST', `/shifts/${shift.id}/x-report`, { token: T })).status).toBe(409)
    // El siguiente turno lleva el corte Z #2.
    const s2 = (await open(10000)).json.shift
    expect((await s.call('POST', `/shifts/${s2.id}/close`, { token: T, body: { countedCash: 10000 } })).json.report.number).toBe(2)
  })
})
