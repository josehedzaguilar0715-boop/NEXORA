import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('panel de inicio', () => {
  it('ventas de hoy contra ayer y la meta, ganancia real por forma de pago, lo que más deja y stock bajo', async () => {
    const { s, o, T, product, buy, open, sell } = await negocioListo()
    const coca = await product({ name: 'Coca 600', unit: 'pieza', price: 2000, minStock: 10 })
    const queso = await product({ name: 'Queso', unit: 'kg', price: 16000 })
    await buy([{ productId: coca.id, quantity: 12, cost: 14400 }, { productId: queso.id, quantity: 5, cost: 50000 }])
    await open(0)
    await sell([{ productId: coca.id, quantity: 5 }]) // $100 efectivo, costo $60
    await sell([{ productId: queso.id, quantity: 0.5 }], { paymentMethod: 'transferencia' }) // $80, costo $50
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 100000 } })
    await sell([{ productId: coca.id, quantity: 2 }], { paymentMethod: 'fiado', customerId: cli.id }) // $40 fiado, costo $24
    await s.call('POST', `/customers/${cli.id}/credit-payments`, { token: T, body: { amount: 1500, method: 'efectivo' } })
    await s.call('POST', '/expenses', { token: T, body: { concept: 'Bolsas', amount: 3000, kind: 'variable', method: 'efectivo' } })

    const d = (await s.call('GET', '/dashboard/panel', { token: T })).json
    expect(d.today).toMatchObject({ sales: 22000, tickets: 3, vsYesterday: null, goal: null, bulk: 8000 })
    expect(d.real).toMatchObject({ efectivo: 10000, transferencia: 8000, abonos: 1500, fiado: 4000, ingresado: 19500, costo: 13400, egresos: 3000 })
    expect(d.real.utilidad).toBe(19500 - 13400 - 3000)
    expect(d.month).toMatchObject({ sales: 22000, out: 3000, avgTicket: 7333 })
    expect(d.topProfit[0]).toMatchObject({ name: 'Coca 600', profit: 5600 })
    expect(d.lowStock).toEqual([{ name: 'Coca 600', unit: 'pieza', stock: 5, min: 10 }])
    expect(d.lowStockCount).toBe(1)
    expect(d.series.at(-1)).toMatchObject({ date: '2026-11-17', sales: 22000 })

    // La meta del día la pone solo el dueño.
    expect((await s.call('PUT', '/dashboard/goal', { token: T, body: { amount: 50000 } })).status).toBe(200)
    expect((await s.call('GET', '/dashboard/panel', { token: T })).json.today.goal).toBe(50000)
    const caj = await s.createStaff(T, o.business.code, 'cajero9', 'cajero')
    expect((await s.call('PUT', '/dashboard/goal', { token: caj.token, body: { amount: 1 } })).status).toBe(403)

    // Al día siguiente compara contra ayer.
    s.advance(86_400_000); s.longLived()
    const d2 = (await s.call('GET', '/dashboard/panel', { token: T })).json
    expect(d2.today).toMatchObject({ sales: 0, vsYesterday: -100 })
  })

  it('cocina: su usuario ve las comandas y pedidos, los marca listos y no puede cobrar', async () => {
    const { s, o, T, product, open } = await negocioListo()
    s.setGiro('comedor')
    const mesa = (await s.call('POST', '/tables', { token: T, body: { name: '1', area: 'salon', seats: 4 } })).json.id
    const corrida = await product({ name: 'Comida corrida', unit: 'pieza', price: 9500, trackStock: false })
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa, people: 2 } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: corrida.id, quantity: 2, notes: 'sin chile' }] } })
    await s.call('POST', `/tabs/${tab.id}/send`, { token: T })

    const k = await s.createStaff(T, o.business.code, 'cocina1', 'cocina')
    const com = (await s.call('GET', '/kitchen', { token: k.token })).json.comandas
    expect(com).toHaveLength(1)
    expect(com[0]).toMatchObject({ where: 'Mesa 1', items: [{ description: 'Comida corrida', quantity: 2, notes: 'sin chile' }] })
    expect((await s.call('POST', `/comandas/${com[0].id}/ready`, { token: k.token })).status).toBe(200)
    expect((await s.call('GET', '/kitchen', { token: k.token })).json.comandas).toHaveLength(0)
    // No cobra ni abre caja.
    expect((await s.call('POST', '/sales', { token: k.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ productId: corrida.id, quantity: 1 }] } })).status).toBe(403)
    expect((await s.call('POST', `/tabs/${tab.id}/checkout`, { token: k.token, body: { parts: [{ paymentMethod: 'efectivo' }] } })).status).toBe(403)
  })
})
