import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function taqueria() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.setGiro('taqueria')
  const enc = await s.createStaff(T, o.business.code, 'encargado', 'encargado')
  await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
  const pastor = await n.product({ name: 'Carne al pastor', unit: 'kg', price: 28000, attrs: { station: 'trompo' } })
  const tortilla = await n.product({ name: 'Tortilla (kg)', unit: 'kg', price: 0, sellable: false })
  const chicharron = await n.product({ name: 'Chicharrón en salsa verde', unit: 'kg', price: 24000, attrs: { station: 'cocina' } })
  const taco = await n.product({ name: 'Taco al pastor', unit: 'pieza', price: 1800, trackStock: false, attrs: { station: 'trompo' } })
  const gordita = await n.product({ name: 'Gordita de chicharrón', unit: 'pieza', price: 3000, trackStock: false })
  // Receta: el costo por taco sale de aquí; la carne se descuenta por kilo.
  await s.call('PUT', `/recipes/${taco.id}`, { token: T, body: { items: [{ productId: pastor.id, quantity: 0.04 }, { productId: tortilla.id, quantity: 0.03 }] } })
  await s.call('PUT', `/recipes/${gordita.id}`, { token: T, body: { items: [{ productId: chicharron.id, quantity: 0.06 }] } })
  await n.buy([{ productId: pastor.id, quantity: 20, cost: 300000 }, { productId: tortilla.id, quantity: 10, cost: 25000 }, { productId: chicharron.id, quantity: 5, cost: 60000 }])
  return { ...n, enc, pastor, tortilla, chicharron, taco, gordita }
}

describe('taquería', () => {
  it('venta por pieza y por kilo o importe con báscula; el costo por taco sale de la receta', async () => {
    const { s, T, taco, pastor, open, sell, stock } = await taqueria()
    expect((await s.call('GET', `/recipes/${taco.id}/cost`, { token: T })).json.cost).toBe(600 + 75) // 40 g × $150/kg + 30 g × $25/kg
    await open(0)
    const v = await sell([{ productId: taco.id, quantity: 10 }, { productId: pastor.id, quantity: 0.5 }, { productId: pastor.id, amount: 7000 }])
    expect(v.json.sale.total).toBe(18000 + 14000 + 7000)
    expect(await stock(pastor.id)).toBeCloseTo(20 - 0.4 - 0.5 - 0.25)
  })

  it('carne del trompo: se registra lo que se empieza y lo vendido; al cierre el sobrante se cuenta con código', async () => {
    const { s, T, enc, taco, pastor, open, sell, stock } = await taqueria()
    const shift = (await open(0)).json.shift.id
    const batch = (await s.call('POST', '/meat/batches', { token: T, body: { productId: pastor.id, kg: 8 } })).json.id
    expect((await s.call('POST', '/meat/batches', { token: T, body: { productId: pastor.id, kg: 2 } })).json.error.code).toBe('trompo_abierto')
    await sell([{ productId: taco.id, quantity: 50 }]) // 2 kg
    await sell([{ productId: pastor.id, quantity: 1 }]) // 1 kg por kilo
    const live = (await s.call('GET', '/meat/batches', { token: T })).json.batches[0]
    expect(live).toMatchObject({ startedKg: 8, soldKg: 3, expectedLeftoverKg: 5, open: true })
    // No se hace el corte con el trompo abierto.
    expect((await s.call('POST', `/shifts/${shift}/close`, { token: T, body: { countedCash: 0 } })).json.error.code).toBe('trompo_abierto')
    expect((await s.call('POST', `/meat/batches/${batch}/close`, { token: enc.token, body: { leftoverKg: 4.6 } })).json.error.code).toBe('codigo_requerido')
    expect((await s.call('POST', `/meat/batches/${batch}/close`, { token: enc.token, body: { leftoverKg: 4.6, authCode: '7777' } })).json.error.code).toBe('motivo_requerido')
    const r = await s.call('POST', `/meat/batches/${batch}/close`, { token: enc.token, body: { leftoverKg: 4.6, reason: 'Merma al rebanar', authCode: '7777' } })
    expect(r.json).toMatchObject({ expectedKg: 5, countedKg: 4.6, differenceKg: -0.4 })
    expect(await stock(pastor.id)).toBeCloseTo(20 - 3 - 0.4)
    expect((await s.call('GET', '/reports/summary', { token: T })).json.waste).toBe(6000)
    // Cierre por turno con efectivo contado.
    const close = await s.call('POST', `/shifts/${shift}/close`, { token: T, body: { countedCash: 90000 + 28000 } })
    expect(close.json.difference).toBe(0)
  })

  it('guisados del día publicados en la mañana; los agotados no aparecen para vender (ni en caja ni en mesa)', async () => {
    const { s, T, enc, gordita, chicharron, open, sell } = await taqueria()
    const menu = (await s.call('POST', '/daily-menu', { token: enc.token, body: { productIds: [chicharron.id, gordita.id], authCode: '7777' } })).json.id
    await open(0)
    await s.call('POST', `/daily-menu/${menu}/sold-out`, { token: T, body: { productId: chicharron.id, soldOut: true } })
    expect((await sell([{ productId: chicharron.id, quantity: 0.25 }])).json.error.code).toBe('agotado')
    const mesa = (await s.call('POST', '/tables', { token: T, body: { name: 'Barra', area: 'barra', seats: 6 } })).json.id
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa } })).json.tab
    expect((await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: chicharron.id, quantity: 0.5 }] } })).json.error.code).toBe('agotado')
    expect((await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: gordita.id, quantity: 2 }] } })).status).toBe(201)
  })

  it('cuenta por mesa o barra y pedidos para llevar por pieza o por kilo con número', async () => {
    const { s, T, taco, pastor, open } = await taqueria()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'llevar', customerName: 'Don Beto' } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: taco.id, quantity: 12 }, { productId: pastor.id, quantity: 0.5 }] } })
    const r = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo', cashReceived: 50000 }] } })
    expect(r.json.parts[0].sale).toMatchObject({ total: 21600 + 14000, change: 50000 - 35600 })
    expect(tab.orderNumber).toBe(1)
  })

  it('precio por kilo actualizado por el dueño con código, en bitácora', async () => {
    const { s, T, pastor } = await taqueria()
    await s.call('PATCH', `/products/${pastor.id}`, { token: T, body: { price: 30000, authCode: '4321' } })
    const log = (await s.call('GET', '/audit', { token: T })).json.entries.find((e: any) => e.action === 'producto.cambio_precio')
    expect(log.authorized_by).toBeTruthy()
    expect(JSON.parse(log.old_value).price).toBe(28000)
  })
})
