import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('ventas y reportes por mes y cajero', () => {
  it('tarjetas del día y del mes, tickets del día, filtro por cajero y bitácora de movimientos con usuario', async () => {
    const { s, o, T, product, buy, open, sell } = await negocioListo()
    const coca = await product({ name: 'Coca 600', unit: 'pieza', price: 2000 })
    const queso = await product({ name: 'Queso', unit: 'kg', price: 16000 })
    await buy([{ productId: coca.id, quantity: 12, cost: 14400 }, { productId: queso.id, quantity: 5, cost: 50000 }])
    await open(0)
    await sell([{ productId: coca.id, quantity: 5 }])
    await sell([{ productId: queso.id, quantity: 0.5 }], { paymentMethod: 'transferencia' })
    const caj = await s.createStaff(T, o.business.code, 'cajera1', 'cajero')
    await s.call('POST', '/shifts/open', { token: caj.token, body: { openingFloat: 0 } })
    await s.call('POST', '/sales', { token: caj.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ productId: coca.id, quantity: 1 }] } })

    const b = (await s.call('GET', '/reports/board', { token: T })).json
    expect(b).toMatchObject({ from: '2026-11-01', to: '2026-11-17', day: '2026-11-17', sellsBulk: true })
    expect(b.dayKpis).toMatchObject({ sales: 20000, tickets: 3, cost: 6000 + 5000 + 1200, profit: 20000 - 12200, bulk: 8000 })
    expect(b.period.avgTicket).toBe(6667)
    expect(b.tickets).toHaveLength(3)
    expect(b.tickets.map((t: any) => t.method).sort()).toEqual(['efectivo', 'efectivo', 'transferencia'])
    expect(b.cashiers).toHaveLength(2)

    const solo = (await s.call('GET', `/reports/board?cashierId=${caj.id}`, { token: T })).json
    expect(solo.dayKpis).toMatchObject({ sales: 2000, tickets: 1 })
    expect(solo.tickets[0]).toMatchObject({ cashier: 'cajera1', total: 2000 })

    // Otro día sin ventas.
    expect((await s.call('GET', '/reports/board?day=2026-11-10', { token: T })).json.tickets).toEqual([])

    const log = (await s.call('GET', '/reports/stock-log', { token: T })).json.movements
    expect(log.map((m: any) => m.type)).not.toContain('venta')
    expect(log.find((m: any) => m.type === 'compra' && m.product === 'Coca 600')).toMatchObject({ label: 'Entrada por compra', qty: 12, user: 'Dueño' })

    // Tendencia del mes: un punto por día; periodos largos, por mes.
    const tr = (await s.call('GET', '/finance/trend', { token: T })).json
    expect(tr).toMatchObject({ by: 'dia', from: '2026-11-01', to: '2026-11-17' })
    expect(tr.points).toHaveLength(17)
    expect(tr.points.at(-1)).toMatchObject({ label: '2026-11-17', income: 20000 })
    expect(tr.real).toMatchObject({ efectivo: 12000, transferencia: 8000 })
    const anio = (await s.call('GET', '/finance/trend?from=2026-01-01&to=2026-12-31', { token: T })).json
    expect(anio.by).toBe('mes')
    expect(anio.points).toHaveLength(11)
    expect(anio.points.at(-1)).toMatchObject({ label: '2026-11', income: 20000 })
  })
})
