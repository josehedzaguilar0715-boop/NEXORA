import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function verduleria() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.setGiro('verduleria')
  const enc = await s.createStaff(T, o.business.code, 'encargado', 'encargado')
  // El encargado cambia precios del día: necesita ese permiso y un código.
  await s.call('PATCH', `/users/${enc.id}`, { token: T, body: { permissions: ['sell', 'open_close_cash', 'edit_inventory', 'view_inventory', 'change_prices', 'customers_credit'] } })
  await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
  const jitomate = await n.product({ name: 'Jitomate', unit: 'kg', price: 2800 })
  const cilantro = await n.product({ name: 'Cilantro', unit: 'kg', price: 4000, presentations: [{ name: 'Manojo', factor: 0.1, price: 500 }] })
  const aguacate = await n.product({ name: 'Aguacate', unit: 'kg', price: 6000, presentations: [{ name: 'Pieza', factor: 0.25, price: 1600 }] })
  const bolsa = await n.product({ name: 'Bolsa para caldo', unit: 'pieza', price: 3500 })
  return { ...n, enc, jitomate, cilantro, aguacate, bolsa }
}

describe('verdulería', () => {
  it('venta por kilo (báscula), pieza, manojo o bolsa armada con su equivalencia', async () => {
    const { s, T, jitomate, cilantro, aguacate, bolsa, buy, open, sell, stock } = await verduleria()
    await s.call('PUT', `/products/${bolsa.id}/combo`, { token: T, body: { items: [{ productId: jitomate.id, quantity: 0.5 }, { productId: cilantro.id, quantity: 0.1 }] } })
    await buy([{ productId: jitomate.id, quantity: 20, cost: 36000 }, { productId: cilantro.id, quantity: 2, cost: 4000 }, { productId: aguacate.id, quantity: 10, cost: 40000 }, { productId: bolsa.id, quantity: 1, cost: 0 }])
    await open(0)
    const v = await sell([
      { productId: jitomate.id, quantity: 1.35 },
      { productId: cilantro.id, presentationId: cilantro.presentations[0].id, quantity: 2 },
      { productId: aguacate.id, presentationId: aguacate.presentations[0].id, quantity: 3 },
      { productId: bolsa.id, quantity: 1 },
    ])
    expect(v.json.sale.total).toBe(3780 + 1000 + 4800 + 3500)
    expect(await stock(jitomate.id)).toBeCloseTo(20 - 1.35 - 0.5)
    expect(await stock(cilantro.id)).toBeCloseTo(2 - 0.2 - 0.1)
    expect(await stock(aguacate.id)).toBeCloseTo(10 - 0.75)
  })

  it('precio del día al abrir: el encargado lo actualiza en lote con código', async () => {
    const { s, enc, jitomate, aguacate } = await verduleria()
    const body = { prices: [{ productId: jitomate.id, price: 3200 }, { productId: aguacate.id, price: 6500 }] }
    expect((await s.call('POST', '/daily-prices', { token: enc.token, body })).json.error.code).toBe('codigo_requerido')
    const r = await s.call('POST', '/daily-prices', { token: enc.token, body: { ...body, authCode: '7777' } })
    expect(r.json.changed.map((x: any) => x.to)).toEqual([3200, 6500])
    expect((await s.call('GET', `/products/${jitomate.id}`, { token: enc.token })).json.product.price).toBe(3200)
  })

  it('compras al mercado como lote con fletes repartidos por kilo', async () => {
    const { buy, jitomate, aguacate } = await verduleria()
    const r = await buy([{ productId: jitomate.id, quantity: 30, cost: 45000 }, { productId: aguacate.id, quantity: 10, cost: 50000 }], { freight: [{ concept: 'Diablero y gasolina', amount: 8000 }] })
    expect(r.json.items.map((i: any) => i.freightShare)).toEqual([6000, 2000])
    expect(r.json.items[0].unitCost).toBe(1700)
  })

  it('merma diaria con motivo y código al cierre; conteo rápido para cuadrar venta y merma', async () => {
    const { s, T, enc, jitomate, aguacate, buy, open, sell, stock } = await verduleria()
    await buy([{ productId: jitomate.id, quantity: 20, cost: 36000 }, { productId: aguacate.id, quantity: 10, cost: 40000 }])
    await open(0)
    await sell([{ productId: jitomate.id, quantity: 5 }, { productId: aguacate.id, quantity: 2 }])
    const waste = { items: [{ productId: jitomate.id, quantity: 1.5, reason: 'Aplastado' }, { productId: aguacate.id, quantity: 0.5, reason: 'Muy maduro' }] }
    expect((await s.call('POST', '/inventory/waste-batch', { token: enc.token, body: waste })).json.error.code).toBe('codigo_requerido')
    const w = await s.call('POST', '/inventory/waste-batch', { token: enc.token, body: { ...waste, authCode: '7777' } })
    expect(w.json.cost).toBe(2700 + 2000)
    const count = await s.call('POST', '/inventory/count-batch', { token: enc.token, body: { reason: 'Conteo de cierre', items: [{ productId: jitomate.id, counted: 13.3 }, { productId: aguacate.id, counted: 7.5 }] } })
    expect(count.json.items.map((x: any) => [x.expected, x.difference])).toEqual([[13.5, -0.2], [7.5, 0]])
    expect(await stock(jitomate.id)).toBeCloseTo(13.3)
    expect((await s.call('GET', '/reports/summary', { token: T })).json.waste).toBe(4700)
  })

  it('clientes frecuentes (fondas) con cuenta semanal, límite y saldo', async () => {
    const { s, T, jitomate, buy, open, sell } = await verduleria()
    await buy([{ productId: jitomate.id, quantity: 50, cost: 90000 }])
    const fonda = (await s.call('POST', '/customers', { token: T, body: { name: 'Fonda Doña Lucha' } })).json.customer
    await s.call('PUT', `/customers/${fonda.id}/credit-limit`, { token: T, body: { limit: 100000 } })
    await open(0)
    for (let d = 0; d < 3; d++) {
      await sell([{ productId: jitomate.id, quantity: 5 }], { paymentMethod: 'fiado', customerId: fonda.id })
      s.advance(86_400_000)
      s.longLived()
    }
    await s.call('POST', `/customers/${fonda.id}/credit-payments`, { token: T, body: { amount: 20000, method: 'transferencia' } })
    const st = (await s.call('GET', `/customers/${fonda.id}/statement?from=2026-11-17&to=2026-11-23`, { token: T })).json
    expect(st).toMatchObject({ opening: 0, charges: 42000, payments: 20000, closing: 22000, limit: 100000 })
  })

  it('pedidos por teléfono o WhatsApp: se cobran al entregar, salvo que el dueño cambie la regla', async () => {
    const { s, T, jitomate, aguacate, buy, open } = await verduleria()
    await buy([{ productId: jitomate.id, quantity: 10, cost: 18000 }, { productId: aguacate.id, quantity: 5, cost: 20000 }])
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'recoger', customerName: 'Restaurante El Patio', phone: '5512312300' } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: jitomate.id, quantity: 3 }, { productId: aguacate.id, quantity: 1 }] } })
    expect((await s.call('POST', `/tabs/${tab.id}/deliver`, { token: T, body: {} })).json.error.code).toBe('pedido_sin_pagar')
    const d = await s.call('POST', `/tabs/${tab.id}/deliver`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect(d.json.sale.total).toBe(8400 + 6000)
    // Regla del dueño: cobrar antes de entregar.
    await s.call('PUT', '/settings', { token: T, body: { phoneOrdersPrepaid: true } })
    const tab2 = (await s.call('POST', '/tabs', { token: T, body: { kind: 'recoger', customerName: 'Fonda' } })).json.tab
    await s.call('POST', `/tabs/${tab2.id}/items`, { token: T, body: { items: [{ productId: jitomate.id, quantity: 1 }] } })
    expect((await s.call('POST', `/tabs/${tab2.id}/deliver`, { token: T, body: { paymentMethod: 'efectivo' } })).json.error.code).toBe('pedido_sin_pagar')
    await s.call('POST', `/tabs/${tab2.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'transferencia' }] } })
    expect((await s.call('POST', `/tabs/${tab2.id}/deliver`, { token: T, body: {} })).json.ok).toBe(true)
  })
})
