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

describe('un día completo: barbería y restaurante', () => {
  it('barbería: servicios con comisión, propinas en efectivo y tarjeta, producto, cancelación; todo cuadra', async () => {
    const { s, o, T, product, buy, sell, stock, open } = await negocioListo()
    s.setGiro('barberia')
    const juan = await s.createStaff(T, o.business.code, 'juan', 'barbero')
    const luis = await s.createStaff(T, o.business.code, 'luis', 'barbero')
    const corte = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const cera = await product({ name: 'Cera', unit: 'pieza', price: 18000 })
    await buy([{ productId: cera.id, quantity: 10, cost: 90000 }])
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'all', rateBp: 4000 }] } })
    const sh = (await open(20000)).json.shift

    const a = (await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }], { tips: [{ staffId: juan.id, amount: 3000 }] })).json.sale // efectivo 150 + propina 30
    const b = (await sell([{ serviceId: corte.id, quantity: 1, staffId: luis.id }, { productId: cera.id, quantity: 1, staffId: luis.id }], { paymentMethod: 'tarjeta', tips: [{ staffId: luis.id, amount: 2000, method: 'tarjeta' }] })).json.sale
    const c = (await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }])).json.sale
    expect([a.total, b.total, c.total]).toEqual([15000, 33000, 15000])
    await s.call('POST', `/sales/${c.id}/cancel`, { token: T, body: { reason: 'No se hizo', authCode: '4321' } })

    expect(await stock(cera.id)).toBe(9)
    // Ingreso del negocio: sin propinas y sin la cancelada.
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.sales.total).toBe(15000 + 33000)
    // Comisiones: 40% de 150 (Juan) y 40% de 330 (Luis); la cancelada no cuenta.
    const com = (await s.call('GET', '/reports/commissions', { token: T })).json.staff
    const by = Object.fromEntries(com.map((x: any) => [x.name, x]))
    expect(by.juan).toMatchObject({ commission: 6000, tips: 3000, tipsCash: 3000 })
    expect(by.luis).toMatchObject({ commission: 13200, tips: 2000, tipsCash: 0 })
    // Caja: fondo 200 + corte en efectivo 150 + propina en efectivo 30 (se le entrega al barbero desde la caja).
    const t = (await s.call('GET', `/shifts/${sh.id}`, { token: T })).json.totals
    expect(t.cashSales).toBe(15000)
    expect(t.expectedCash).toBe(20000 + 15000 + 3000)
    const z = await s.call('POST', `/shifts/${sh.id}/close`, { token: T, body: { countedCash: 38000 } })
    expect(z.json.difference).toBe(0)
  })

  it('restaurante: mesa dividida por persona, propina, cortesía y platillo cancelado; recetas, costo y caja cuadran', async () => {
    const { s, T, product, buy, stock, open } = await negocioListo()
    s.setGiro('restaurante')
    const mesa = (await s.call('POST', '/tables', { token: T, body: { name: '1', area: 'salon', seats: 4 } })).json.id
    const res = await product({ name: 'Res (kg)', unit: 'kg', price: 0, sellable: false })
    const arrachera = await product({ name: 'Arrachera', unit: 'pieza', price: 22000, trackStock: false, attrs: { station: 'cocina_caliente' } })
    const limonada = await product({ name: 'Limonada', unit: 'pieza', price: 4500, trackStock: false, attrs: { station: 'barra' } })
    await s.call('PUT', `/recipes/${arrachera.id}`, { token: T, body: { items: [{ productId: res.id, quantity: 0.3 }] } })
    await buy([{ productId: res.id, quantity: 10, cost: 250000 }]) // $250/kg
    const sh = (await open(10000)).json.shift

    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa, people: 2 } })).json.tab
    const add = await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: arrachera.id, quantity: 1, person: 1 }, { productId: limonada.id, quantity: 1, person: 1 }, { productId: arrachera.id, quantity: 1, person: 2 }, { productId: limonada.id, quantity: 1, person: 2 }, { productId: limonada.id, quantity: 1, person: 2 }] } })
    const items = (await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab.items
    const lim1 = items.filter((i: any) => i.description === 'Limonada' && i.person === 2)
    expect(lim1).toHaveLength(2)
    // Una limonada se cancela (se pidió de más) y otra va de cortesía.
    expect((await s.call('POST', `/tab-items/${lim1[0].id}/cancel`, { token: T, body: { authCode: '4321', reason: 'Se pidió de más' } })).status).toBe(200)
    expect((await s.call('POST', `/tab-items/${lim1[1].id}/courtesy`, { token: T, body: { authCode: '4321', reason: 'Cliente frecuente' } })).status).toBe(200)
    await s.call('POST', `/tabs/${tab.id}/send`, { token: T })
    const r = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [
      { person: 1, paymentMethod: 'efectivo', tip: 3000, tipMethod: 'efectivo' },
      { person: 2, paymentMethod: 'tarjeta' },
    ] } })
    expect(r.status).toBe(200)
    const [p0, p1] = r.json.parts.map((x: any) => x.sale.total)
    expect(p0).toBe(22000 + 4500)
    expect(p1).toBe(22000) // la cancelada y la de cortesía no se cobran
    const log = (await s.call('GET', '/audit', { token: T })).json.entries.map((e: any) => e.action)
    expect(log).toEqual(expect.arrayContaining(['cuenta.cancelacion', 'cuenta.cortesia']))
    // Receta: 2 arracheras × 0.3 kg
    expect(await stock(res.id)).toBeCloseTo(9.4)
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.sales.total).toBe(p0 + p1)
    expect(sum.costOfSales).toBe(2 * 0.3 * 25000)
    const t = (await s.call('GET', `/shifts/${sh.id}`, { token: T })).json.totals
    expect(t.expectedCash).toBe(10000 + p0 + 3000)
    expect((await s.call('GET', '/tables', { token: T })).json.tables[0].status).toBe('limpieza')
  })
})

describe('dos días seguidos', () => {
  it('ferretería: venta ayer, corte Z; hoy devolución en efectivo solo si alcanza, si no por transferencia; cada día con lo suyo', async () => {
    const { s, T, product, buy, sell, stock, open } = await negocioListo()
    s.setGiro('ferreteria')
    const taladro = await product({ name: 'Taladro', unit: 'pieza', price: 120000 })
    await buy([{ productId: taladro.id, quantity: 3, cost: 240000 }])
    const ayer = (await open(10000)).json.shift
    const v = (await sell([{ productId: taladro.id, quantity: 1 }])).json.sale
    const z1 = await s.call('POST', `/shifts/${ayer.id}/close`, { token: T, body: { countedCash: 130000 } })
    expect(z1.json.difference).toBe(0)

    s.advance(24 * 3600_000) // al día siguiente
    const hoy = (await open(20000)).json.shift
    const saleItemId = (s.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(v.id) as any).id
    const body = { saleId: v.id, items: [{ saleItemId, quantity: 1 }], reason: 'Salió defectuoso', authCode: '4321' }
    // En la caja de hoy solo hay $200: no se pueden devolver $1,200 en efectivo.
    const sinEfectivo = await s.call('POST', '/returns', { token: T, body: { ...body, refundMethod: 'efectivo' } })
    expect(sinEfectivo.json.error.code).toBe('efectivo_insuficiente')
    expect(await stock(taladro.id)).toBe(2) // no regresó nada
    expect((await s.call('POST', '/returns', { token: T, body: { ...body, refundMethod: 'transferencia' } })).status).toBe(201)
    expect(await stock(taladro.id)).toBe(3)
    // La caja de hoy no se mueve (fue transferencia); el corte de ayer sigue igual.
    expect((await s.call('GET', `/shifts/${hoy.id}`, { token: T })).json.totals.expectedCash).toBe(20000)
    expect((await s.call('GET', `/shifts/${ayer.id}`, { token: T })).json.totals.expectedCash).toBe(130000)
    // Reportes por día: ayer la venta; hoy la devolución.
    const r1 = (await s.call('GET', '/reports/summary?from=2026-11-17&to=2026-11-17', { token: T })).json
    const r2 = (await s.call('GET', '/reports/summary?from=2026-11-18&to=2026-11-18', { token: T })).json
    expect([r1.sales.total, r1.refunds]).toEqual([120000, 0])
    expect([r2.sales.total, r2.refunds]).toEqual([0, 120000])
  })
})
