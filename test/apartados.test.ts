import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('apartados con anticipo', () => {
  it('apartar, abonar, entregar: inventario, caja, reportes, flujo y balance cuadran', async () => {
    const { s, T, product, buy, open, stock } = await negocioListo()
    const tele = await product({ name: 'Televisión 32"', unit: 'pieza', price: 450000 })
    await buy([{ productId: tele.id, quantity: 2, cost: 600000 }])
    const shift = (await open(10000)).json.shift
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari' } })).json.customer
    // No se puede apartar más de lo que hay.
    expect((await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: tele.id, quantity: 3 }], deposit: 1000, method: 'efectivo' } })).json.error.code).toBe('sin_existencia')
    const a = (await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: tele.id, quantity: 1 }], deposit: 100000, method: 'efectivo', dueDate: '2099-01-31' } })).json.layaway
    expect(a).toMatchObject({ folio: 1, total: 450000, paid: 100000, balance: 350000, status: 'abierto' })
    // Sigue en la tienda pero ya no está disponible: solo queda 1 para apartar.
    const p = (await s.call('GET', `/products/${tele.id}`, { token: T })).json.product
    expect(p).toMatchObject({ stock: 2, reserved: 1 })
    expect((await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: tele.id, quantity: 2 }], deposit: 1000, method: 'efectivo' } })).status).toBe(409)
    // El anticipo en efectivo entra a la caja, pero no es venta todavía.
    let t = (await s.call('GET', `/shifts/${shift.id}`, { token: T })).json.totals
    expect(t.expectedCash).toBe(10000 + 100000)
    expect((await s.call('GET', '/reports/summary', { token: T })).json.sales.total).toBe(0)
    expect((await s.call('GET', '/accounting/balance', { token: T })).json.layawayDeposits).toBe(100000)
    // Abono con transferencia y no más de lo que resta.
    expect((await s.call('POST', `/layaways/${a.id}/payments`, { token: T, body: { amount: 999999, method: 'efectivo' } })).status).toBe(400)
    await s.call('POST', `/layaways/${a.id}/payments`, { token: T, body: { amount: 200000, method: 'transferencia' } })
    // Entregar con saldo pendiente pide cobrarlo.
    expect((await s.call('POST', `/layaways/${a.id}/deliver`, { token: T, body: {} })).json.error.code).toBe('saldo_pendiente')
    const del = (await s.call('POST', `/layaways/${a.id}/deliver`, { token: T, body: { method: 'efectivo' } })).json
    expect(del.layaway).toMatchObject({ status: 'entregado', balance: 0 })
    expect(await stock(tele.id)).toBe(1)
    t = (await s.call('GET', `/shifts/${shift.id}`, { token: T })).json.totals
    expect(t.expectedCash).toBe(10000 + 100000 + 150000) // anticipo + liquidación en efectivo; la venta no se cobra dos veces
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum).toMatchObject({ costOfSales: 300000 })
    expect(sum.sales.total).toBe(450000)
    const cf = (await s.call('GET', '/accounting/cash-flow', { token: T })).json
    expect(cf.inflows.filter((x: any) => x.category === 'apartados').reduce((a: number, x: any) => a + x.amount, 0)).toBe(450000)
    expect(cf.inflows.some((x: any) => x.category === 'ventas')).toBe(false)
    expect((await s.call('GET', '/accounting/balance', { token: T })).json.layawayDeposits).toBe(0)
    const ticket = (await s.call('GET', `/layaways/${a.id}/ticket`, { token: T })).json.text
    expect(ticket).toContain('APARTADO #1')
    expect(ticket).toContain('ENTREGADO')
  })

  it('cancelar con código: devolviendo el anticipo o quedándoselo', async () => {
    const { s, T, product, buy, open, stock } = await negocioListo()
    const bici = await product({ name: 'Bicicleta', unit: 'pieza', price: 300000 })
    await buy([{ productId: bici.id, quantity: 2, cost: 400000 }])
    const shift = (await open(10000)).json.shift
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Don Beto' } })).json.customer
    const a1 = (await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: bici.id, quantity: 1 }], deposit: 50000, method: 'efectivo' } })).json.layaway
    const a2 = (await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: bici.id, quantity: 1 }], deposit: 30000, method: 'efectivo' } })).json.layaway
    expect((await s.call('POST', `/layaways/${a1.id}/cancel`, { token: T, body: { reason: 'Ya no la quiere', refund: true } })).status).toBe(400)
    await s.call('POST', `/layaways/${a1.id}/cancel`, { token: T, body: { reason: 'Ya no la quiere', refund: true, refundMethod: 'efectivo', authCode: '4321' } })
    await s.call('POST', `/layaways/${a2.id}/cancel`, { token: T, body: { reason: 'Venció el plazo', refund: false, authCode: '4321' } })
    expect(await stock(bici.id)).toBe(2)
    expect((await s.call('GET', `/products/${bici.id}`, { token: T })).json.product.reserved).toBe(0)
    const t = (await s.call('GET', `/shifts/${shift.id}`, { token: T })).json.totals
    expect(t.expectedCash).toBe(10000 + 30000) // se devolvieron los 500; se quedaron los 300
    expect((await s.call('GET', '/reports/summary', { token: T })).json.sales.total).toBe(30000)
    const list = (await s.call('GET', '/layaways?status=cancelado', { token: T })).json.layaways
    expect(list).toHaveLength(2)
  })
})
