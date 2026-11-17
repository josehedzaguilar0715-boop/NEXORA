import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('finanzas y contabilidad', () => {
  it('estado de resultados, flujo, balance, libro y exportación cuadran con lo registrado', async () => {
    const { s, T, product, buy, open, sell } = await negocioListo()
    const refresco = await product({ name: 'Refresco', unit: 'pieza', price: 2000 })
    // Compra de contado: 10 piezas por $100 (costo $10 c/u). Compra a crédito: 5 piezas por $50.
    await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }])
    await s.call('POST', '/purchases', { token: T, body: { payment: 'credito', items: [{ productId: refresco.id, quantity: 5, cost: 5000 }] } })
    const shift = (await open(10000)).json.shift
    await sell([{ productId: refresco.id, quantity: 3 }]) // $60 efectivo
    await sell([{ productId: refresco.id, quantity: 2 }], { paymentMethod: 'transferencia' }) // $40
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 100000 } })
    await sell([{ productId: refresco.id, quantity: 1 }], { paymentMethod: 'fiado', customerId: cli.id }) // $20 fiado
    await s.call('POST', `/customers/${cli.id}/credit-payments`, { token: T, body: { amount: 500, method: 'efectivo' } }) // cobra $5
    await s.call('POST', '/expenses', { token: T, body: { concept: 'Luz', amount: 1500, kind: 'fijo', category: 'servicios', method: 'transferencia' } })
    await s.call('POST', `/shifts/${shift.id}/movements`, { token: T, body: { type: 'retiro', amount: 2000, reason: 'Retiro del dueño' } })

    const is = (await s.call('GET', '/accounting/income-statement', { token: T })).json
    expect(is.current).toMatchObject({ grossSales: 12000, netSales: 12000, costOfSales: 6000, grossProfit: 6000, expenses: 1500, netProfit: 4500, tickets: 3, averageTicket: 4000 })
    expect(is.current.expensesByCategory).toEqual([{ category: 'servicios', amount: 1500 }])
    expect(is.current.grossMargin).toBeCloseTo(0.5)

    const cf = (await s.call('GET', '/accounting/cash-flow', { token: T })).json
    // Entra: 60 + 40 de ventas, 5 de cobranza = 105. Sale: 100 a proveedor, 15 de luz, 20 de retiro = 135.
    expect(cf.totalIn).toBe(10500)
    expect(cf.totalOut).toBe(13500)
    expect(cf.net).toBe(-3000)
    // Efectivo: +60 +5 −20 (la compra de contado se pagó por transferencia por defecto o efectivo; ver método).
    expect(cf.cashNet + cf.bankNet).toBe(-3000)

    const bal = (await s.call('GET', '/accounting/balance', { token: T })).json
    expect(bal.inventory).toBe(9 * 1000) // quedan 9 piezas a $10
    expect(bal.receivables).toBe(1500)
    expect(bal.payables).toBe(5000)
    expect(bal.cashInRegisters).toBe(10000 + 6000 + 500 - 2000)
    expect(bal.equity).toBe(bal.cashInRegisters + 9000 + 1500 - 5000)

    const lg = (await s.call('GET', '/accounting/ledger', { token: T })).json
    expect(lg.totalIn).toBe(10500)
    expect(lg.totalOut).toBe(13500)
    expect(lg.entries.map((e: any) => e.type)).toEqual(expect.arrayContaining(['Venta', 'Cobro de fiado', 'Pago a proveedor', 'Gasto', 'Retiro de caja']))

    const res = await s.app.request('/accounting/export?kind=movimientos', { headers: { authorization: `Bearer ${T}` } })
    expect(res.headers.get('content-type')).toContain('text/csv')
    const csv = await res.text()
    expect(csv.split('\r\n')[0]).toContain('Fecha,Hora,Tipo,Concepto')
    expect(csv).toContain('Retiro del dueño')
    const gastos = await (await s.app.request('/accounting/export?kind=gastos', { headers: { authorization: `Bearer ${T}` } })).text()
    expect(gastos).toContain('Luz,"Luz, agua, gas, internet y teléfono",fijo,transferencia,15.00')
  })
})
