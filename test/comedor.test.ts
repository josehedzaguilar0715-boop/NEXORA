import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function comedor() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.setGiro('comedor')
  const enc = await s.createStaff(T, o.business.code, 'encargada', 'encargado')
  await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
  const pollo = await n.product({ name: 'Pollo (kg)', unit: 'kg', price: 0, sellable: false })
  const arroz = await n.product({ name: 'Arroz (kg)', unit: 'kg', price: 0, sellable: false })
  const dish = (name: string, price: number) => n.product({ name, unit: 'pieza', price, trackStock: false })
  const corrida = await dish('Comida corrida', 9500)
  const molletes = await dish('Molletes', 6000)
  const agua = await dish('Agua del día', 2000)
  // Platillo por porción con receta y costo.
  await s.call('PUT', `/recipes/${corrida.id}`, { token: T, body: { items: [{ productId: pollo.id, quantity: 0.25 }, { productId: arroz.id, quantity: 0.1 }] } })
  await n.buy([{ productId: pollo.id, quantity: 10, cost: 120000 }, { productId: arroz.id, quantity: 5, cost: 15000 }])
  return { ...n, enc, pollo, arroz, corrida, molletes, agua }
}

describe('comedor', () => {
  it('menú del día por turno que el encargado publica con código', async () => {
    const { s, T, enc, corrida, molletes, agua } = await comedor()
    const body = { meal: 'desayuno', productIds: [molletes.id, agua.id] }
    expect((await s.call('POST', '/daily-menu', { token: enc.token, body })).json.error.code).toBe('codigo_requerido')
    expect((await s.call('POST', '/daily-menu', { token: enc.token, body: { ...body, authCode: '7777' } })).status).toBe(201)
    await s.call('POST', '/daily-menu', { token: enc.token, body: { meal: 'comida', productIds: [corrida.id, agua.id], authCode: '7777' } })
    const m = (await s.call('GET', '/daily-menu', { token: enc.token })).json
    expect(m.currentMeal).toBe('desayuno') // 09:00
    expect(m.menus.map((x: any) => x.meal).sort()).toEqual(['comida', 'desayuno'])
    const log = (await s.call('GET', '/audit', { token: T })).json.entries
    expect(log.filter((e: any) => e.action === 'menu_del_dia.publicado' && e.authorized_by === enc.id)).toHaveLength(2)
  })

  it('agotado: deja de venderse', async () => {
    const { s, T, enc, molletes, sell, open } = await comedor()
    const menu = (await s.call('POST', '/daily-menu', { token: enc.token, body: { meal: 'desayuno', productIds: [molletes.id], authCode: '7777' } })).json.id
    await open(0)
    expect((await sell([{ productId: molletes.id, quantity: 1 }])).status).toBe(201)
    await s.call('POST', `/daily-menu/${menu}/sold-out`, { token: T, body: { productId: molletes.id, soldOut: true } })
    expect((await sell([{ productId: molletes.id, quantity: 1 }])).json.error.code).toBe('agotado')
    expect((await s.call('GET', '/products/top', { token: T })).json.products[0]).toMatchObject({ name: 'Molletes', soldOut: true })
  })

  it('venta rápida: los más vendidos para botones grandes; caja rápida con cambio al momento', async () => {
    const { s, T, corrida, agua, molletes, sell, open } = await comedor()
    await open(0)
    for (let i = 0; i < 3; i++) await sell([{ productId: corrida.id, quantity: 1 }, { productId: agua.id, quantity: 2 }])
    await sell([{ productId: molletes.id, quantity: 1 }])
    expect((await s.call('GET', '/products/top', { token: T })).json.products.map((p: any) => p.name)).toEqual(['Agua del día', 'Comida corrida', 'Molletes'])
    const v = await sell([{ productId: corrida.id, quantity: 1 }], { cashReceived: 20000 })
    expect(v.json.sale.change).toBe(10500)
  })

  it('turnos de comida con corte por turno; platillo por porción descuenta su receta con costo', async () => {
    const { s, T, corrida, pollo, sell, stock } = await comedor()
    const d = (await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 50000, meal: 'desayuno' } })).json.shift
    expect(d.meal).toBe('desayuno')
    await sell([{ productId: corrida.id, quantity: 4 }])
    expect(await stock(pollo.id)).toBe(9)
    const close = await s.call('POST', `/shifts/${d.id}/close`, { token: T, body: { countedCash: 88000 } })
    expect(close.json.difference).toBe(0)
    s.advance(4 * 3600_000)
    const c2 = (await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 50000, meal: 'comida' } })).json.shift
    expect(c2.meal).toBe('comida')
    expect((await s.call('GET', '/reports/summary', { token: T })).json.costOfSales).toBe(4 * (3000 + 300))
  })

  it('crédito para oficinas y talleres con límite; pasarlo requiere código del dueño', async () => {
    const { s, T, corrida, sell, open } = await comedor()
    const oficina = (await s.call('POST', '/customers', { token: T, body: { name: 'Taller Mecánico Gómez' } })).json.customer
    await s.call('PUT', `/customers/${oficina.id}/credit-limit`, { token: T, body: { limit: 30000 } })
    await open(0)
    expect((await sell([{ productId: corrida.id, quantity: 3 }], { paymentMethod: 'fiado', customerId: oficina.id })).status).toBe(201)
    expect((await sell([{ productId: corrida.id, quantity: 1 }], { paymentMethod: 'fiado', customerId: oficina.id, authCode: '7777' })).status).toBe(403)
    expect((await sell([{ productId: corrida.id, quantity: 1 }], { paymentMethod: 'fiado', customerId: oficina.id, authCode: '4321' })).status).toBe(201)
  })

  it('propinas: opcionales y apagadas por defecto en comedor', async () => {
    const { s, T, me, corrida, sell, open } = await comedor()
    await open(0)
    expect((await sell([{ productId: corrida.id, quantity: 1 }], { tips: [{ staffId: me.id, amount: 1000 }] })).status).toBe(400)
    await s.call('PUT', '/settings', { token: T, body: { tipsEnabled: true } })
    expect((await sell([{ productId: corrida.id, quantity: 1 }], { tips: [{ staffId: me.id, amount: 1000 }] })).status).toBe(201)
  })

  it('mapa de mesas opcional: apagado por defecto', async () => {
    const { s, T } = await comedor()
    expect((await s.call('GET', '/auth/me', { token: T })).json.settings.tablesEnabled).toBeUndefined()
    await s.call('PUT', '/settings', { token: T, body: { tablesEnabled: true } })
    expect((await s.call('GET', '/auth/me', { token: T })).json.settings.tablesEnabled).toBe(true)
  })
})
