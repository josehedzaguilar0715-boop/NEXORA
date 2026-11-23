import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

/**
 * Procesos completos: un día de trabajo y luego se cuadra TODO
 * (existencias, corte de caja, reportes, fiado, flujo de efectivo, panel, bitácora).
 * No basta con que una pantalla abra: cada operación tiene que llegar a todos los lugares donde cuenta.
 */
describe('un día completo cuadra en todos lados', () => {
  it('abarrotes: compra, ventas en 3 formas de pago, fiado y abono, cancelación, merma, gasto y retiro', async () => {
    const { s, o, T, product, buy, sell, stock } = await negocioListo()
    const coca = await product({ name: 'Coca 600', unit: 'pieza', price: 2000, minStock: 5 })
    const frijol = await product({ name: 'Frijol', unit: 'kg', price: 3800 })
    // Se abre la caja con $500. Una compra de $568 «pagada de la caja» no cabe: se rechaza y no entra nada.
    const sh = (await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 50000 } })).json.shift
    const sinEfectivo = await buy([{ productId: coca.id, quantity: 24, cost: 28800 }, { productId: frijol.id, quantity: 10, cost: 28000 }], { paidFromCash: true })
    expect(sinEfectivo.status).toBe(400)
    expect(sinEfectivo.json.error.code).toBe('efectivo_insuficiente')
    expect(await stock(coca.id)).toBe(0)
    // Gasto de la caja mayor al efectivo: también se rechaza.
    expect((await s.call('POST', '/expenses', { token: T, body: { concept: 'Refri', amount: 60000, kind: 'variable', method: 'efectivo', fromCash: true } })).json.error.code).toBe('efectivo_insuficiente')
    // Depósito de $500 más y ahora sí alcanza.
    expect((await s.call('POST', `/shifts/${sh.id}/movements`, { token: T, body: { type: 'deposito', amount: 50000, reason: 'Fondo extra' } })).status).toBeLessThan(300)
    expect((await buy([{ productId: coca.id, quantity: 24, cost: 28800 }, { productId: frijol.id, quantity: 10, cost: 28000 }], { paidFromCash: true })).status).toBe(201)
    expect(await stock(coca.id)).toBe(24)

    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari', phone: '9611112233' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 100000 } })

    const v1 = (await sell([{ productId: coca.id, quantity: 5 }, { productId: frijol.id, quantity: 1.5 }])).json.sale // efectivo 100 + 57 = 157
    const v2 = (await sell([{ productId: coca.id, quantity: 2 }], { paymentMethod: 'transferencia' })).json.sale // 40
    const v3 = (await sell([{ productId: coca.id, quantity: 3 }], { paymentMethod: 'fiado', customerId: cli.id })).json.sale // 60 fiado
    const v4 = (await sell([{ productId: coca.id, quantity: 2 }])).json.sale // 40 efectivo, se cancela
    expect([v1.total, v2.total, v3.total, v4.total]).toEqual([15700, 4000, 6000, 4000])
    expect((await s.call('POST', `/sales/${v4.id}/cancel`, { token: T, body: { reason: 'Se cobró dos veces', authCode: '4321' } })).status).toBe(200)

    // Abono de fiado en efectivo, merma, gasto pagado de la caja y retiro.
    expect((await s.call('POST', `/customers/${cli.id}/credit-payments`, { token: T, body: { amount: 2500, method: 'efectivo' } })).status).toBeLessThan(300)
    expect((await s.call('POST', '/inventory/waste', { token: T, body: { productId: coca.id, quantity: 1, reason: 'Se reventó' } })).status).toBeLessThan(300)
    expect((await s.call('POST', '/expenses', { token: T, body: { concept: 'Bolsas', amount: 3000, kind: 'variable', method: 'efectivo', fromCash: true } })).status).toBeLessThan(300)
    expect((await s.call('POST', `/shifts/${sh.id}/movements`, { token: T, body: { type: 'retiro', amount: 10000, reason: 'Pago de luz' } })).status).toBeLessThan(300)

    // 1) Existencias: 24 − 5 − 2 − 3 − (2 cancelada, regresa) − 1 merma = 13; frijol 10 − 1.5 = 8.5
    expect(await stock(coca.id)).toBe(13)
    expect(await stock(frijol.id)).toBeCloseTo(8.5)

    // 2) Corte: fondo 500 + depósito 500 − compra 568 + efectivo 157 + abono 25 − gasto 30 − retiro 100 = 484
    const tot = (await s.call('GET', `/shifts/${sh.id}`, { token: T })).json
    const t = tot.totals ?? tot.shift?.totals ?? tot
    const expected = 50000 + 50000 - 56800 + 15700 + 2500 - 3000 - 10000
    expect(t.cashSales).toBe(15700)
    expect(t.transferSales).toBe(4000)
    expect(t.creditSales).toBe(6000)
    expect(t.cancelled).toBe(1)
    expect(t.expectedCash).toBe(expected)

    // 3) Fiado: 60 − 25 = 35 y aparece en cuentas por cobrar.
    expect((await s.call('GET', `/customers/${cli.id}/credit`, { token: T })).json.balance).toBe(3500)
    expect((await s.call('GET', '/receivables', { token: T })).json.total).toBe(3500)

    // 4) Reporte del día: ventas sin la cancelada; costo de lo vendido coherente con las compras.
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.sales.total).toBe(15700 + 4000 + 6000)
    expect(sum.cancelled).toBe(1)
    const costCoca = 1200 // 288/24
    const costFrijol = 2800 // 280/10 por kg
    expect(sum.costOfSales).toBe(10 * costCoca + 1.5 * costFrijol)
    expect(sum.expenses).toBe(3000)
    expect(sum.waste).toBe(costCoca)

    // 5) Panel: lo que de verdad entró por forma de pago (el fiado no es dinero hasta que se abona).
    const real = (await s.call('GET', '/dashboard/panel', { token: T })).json.real
    expect(real).toMatchObject({ efectivo: 15700, transferencia: 4000, abonos: 2500, fiado: 6000 })

    // 6) Libro de dinero: entradas = ventas cobradas + cobranza + depósito; salidas = compra + gasto + retiro (sin contar doble).
    const lg = (await s.call('GET', '/accounting/ledger', { token: T })).json
    expect(lg.totalIn).toBe(15700 + 4000 + 2500 + 50000)
    expect(lg.totalOut).toBe(56800 + 3000 + 10000)

    // 7) Bitácora: la cancelación quedó con motivo y con quién autorizó.
    const log = (await s.call('GET', '/audit', { token: T })).json.entries
    expect(log.find((e: any) => e.action === 'venta.cancelacion')).toMatchObject({ reason: 'Se cobró dos veces' })

    // 8) Corte Z con el efectivo contado: cuadra exacto (diferencia 0).
    const z = await s.call('POST', `/shifts/${sh.id}/close`, { token: T, body: { countedCash: expected } })
    expect(z.status).toBe(200)
    expect(z.json.difference).toBe(0)
    // Después del corte no se puede cancelar una venta de ese turno.
    expect((await s.call('POST', `/sales/${v1.id}/cancel`, { token: T, body: { reason: 'tarde', authCode: '4321' } })).json.error.code).toBe('turno_cerrado')
    void o
  })
})
