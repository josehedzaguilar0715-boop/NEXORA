import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('pago mixto', () => {
  it('tarjeta y el resto en efectivo: cambio, corte, reportes, flujo y ticket', async () => {
    const { s, T, open, sell } = await negocioListo()
    const shift = (await open(50000)).json.shift
    const r = await sell([{ description: 'Despensa', quantity: 1, unitPrice: 10000 }], { otherPayments: [{ method: 'tarjeta', amount: 3000 }], cashReceived: 10000 })
    expect(r.status).toBe(201)
    expect(r.json.sale).toMatchObject({ paymentMethod: 'mixto', change: 3000 })
    expect(r.json.sale.payments).toEqual([{ method: 'efectivo', amount: 7000 }, { method: 'tarjeta', amount: 3000 }])
    const t = (await s.call('GET', `/shifts/${shift.id}`, { token: T })).json.totals
    expect(t).toMatchObject({ cashSales: 7000, cardSales: 3000, expectedCash: 50000 + 7000 })
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.sales).toMatchObject({ total: 10000, efectivo: 7000, tarjeta: 3000 })
    const cf = (await s.call('GET', '/accounting/cash-flow', { token: T })).json
    expect(cf.cashNet).toBe(7000)
    const ticket = (await s.call('GET', `/sales/${r.json.sale.id}/ticket`, { token: T })).json.text
    expect(ticket).toContain('Tarjeta')
    expect(ticket).toContain('Cambio')
    // Todo con tarjeta y transferencia, sin efectivo.
    const all = await sell([{ description: 'Varios', quantity: 1, unitPrice: 5000 }], { otherPayments: [{ method: 'tarjeta', amount: 2000 }, { method: 'transferencia', amount: 3000 }] })
    expect(all.json.sale.payments).toEqual([{ method: 'tarjeta', amount: 2000 }, { method: 'transferencia', amount: 3000 }])
    // No cuadra o no se combina con fiado.
    expect((await sell([{ description: 'X', quantity: 1, unitPrice: 1000 }], { otherPayments: [{ method: 'tarjeta', amount: 2000 }] })).json.error.code).toBe('pago_no_cuadra')
    expect((await sell([{ description: 'X', quantity: 1, unitPrice: 1000 }], { paymentMethod: 'transferencia', otherPayments: [{ method: 'tarjeta', amount: 500 }] })).status).toBe(400)
    expect((await sell([{ description: 'X', quantity: 1, unitPrice: 1000 }], { otherPayments: [{ method: 'tarjeta', amount: 500 }], cashReceived: 100 })).json.error.code).toBe('efectivo_insuficiente')
  })
})
