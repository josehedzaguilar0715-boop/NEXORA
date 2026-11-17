import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function restaurante() {
  const n = await negocioListo()
  const { s, T } = n
  await s.call('PATCH', '/business', { token: T, body: { giro: 'restaurante' } })
  const mesa = async (name: string, area: string, seats: number) => (await s.call('POST', '/tables', { token: T, body: { name, area, seats } })).json.id
  const t1 = await mesa('1', 'salon', 4)
  const t2 = await mesa('T1', 'terraza', 2)
  const res = await n.product({ name: 'Carne de res (kg)', unit: 'kg', price: 0, sellable: false })
  const lechuga = await n.product({ name: 'Lechuga', unit: 'pieza', price: 0, sellable: false })
  const dish = (name: string, price: number, station: string, extra: object = {}) => n.product({ name, unit: 'pieza', price, trackStock: false, attrs: { station, ...extra } })
  const arrachera = await dish('Arrachera', 22000, 'cocina_caliente', { modifiers: [{ name: 'Término medio', price: 0 }, { name: 'Con guacamole', price: 3500 }] })
  const ensalada = await dish('Ensalada', 9000, 'cocina_fria')
  const limonada = await dish('Limonada', 4500, 'barra')
  const pastel = await dish('Pastel de chocolate', 7000, 'postres')
  await s.call('PUT', `/recipes/${arrachera.id}`, { token: T, body: { items: [{ productId: res.id, quantity: 0.3 }] } })
  await s.call('PUT', `/recipes/${ensalada.id}`, { token: T, body: { items: [{ productId: lechuga.id, quantity: 0.5 }] } })
  await n.buy([{ productId: res.id, quantity: 10, cost: 250000 }, { productId: lechuga.id, quantity: 20, cost: 20000 }])
  return { ...n, t1, t2, res, lechuga, arrachera, ensalada, limonada, pastel }
}

describe('restaurante', () => {
  it('mapa en vivo: libre → ocupada → por cobrar → limpieza → libre (la libera el mesero)', async () => {
    const { s, T, t1, limonada, open } = await restaurante()
    await open(0)
    const status = async () => (await s.call('GET', '/tables', { token: T })).json.tables.find((t: any) => t.id === t1).status
    expect(await status()).toBe('libre')
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: t1, people: 2 } })).json.tab
    expect(await status()).toBe('ocupada')
    expect((await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: t1 } })).json.error.code).toBe('mesa_ocupada')
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: limonada.id, quantity: 2 }] } })
    await s.call('POST', `/tabs/${tab.id}/request-bill`, { token: T })
    expect(await status()).toBe('por_cobrar')
    await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'tarjeta' }] } })
    expect(await status()).toBe('limpieza')
    await s.call('POST', `/tables/${t1}/free`, { token: T })
    expect(await status()).toBe('libre')
  })

  it('comandas por estación: cada una ve solo lo suyo; tiempos de cocina por comanda', async () => {
    const { s, T, t2, arrachera, ensalada, limonada, pastel, open } = await restaurante()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: t2, people: 2 } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: arrachera.id, quantity: 1, modifiers: ['Término medio', 'Con guacamole'], notes: 'sin cebolla' }, { productId: ensalada.id, quantity: 1 }, { productId: limonada.id, quantity: 2 }, { productId: pastel.id, quantity: 1 }] } })
    // Antes de confirmar no llega nada a cocina.
    expect((await s.call('GET', '/kitchen', { token: T })).json.comandas).toHaveLength(0)
    await s.call('POST', `/tabs/${tab.id}/send`, { token: T })
    const caliente = (await s.call('GET', '/kitchen?station=cocina_caliente', { token: T })).json.comandas
    expect(caliente).toHaveLength(1)
    expect(caliente[0].items).toEqual([{ description: 'Arrachera · Término medio · Con guacamole', quantity: 1, notes: 'sin cebolla' }])
    expect((await s.call('GET', '/kitchen?station=barra', { token: T })).json.comandas[0].items[0].description).toBe('Limonada')
    s.advance(12 * 60_000)
    const ready = await s.call('POST', `/comandas/${caliente[0].id}/ready`, { token: T })
    expect(ready.json.minutes).toBe(12)
    expect((await s.call('GET', '/kitchen?station=cocina_caliente', { token: T })).json.comandas).toHaveLength(0)
    const times = (await s.call('GET', '/reports/kitchen-times', { token: T })).json.stations
    expect(times).toEqual([{ station: 'cocina_caliente', comandas: 1, avgMinutes: 12, maxMinutes: 12 }])
    const total = (await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab.pending
    expect(total).toBe(25500 + 9000 + 9000 + 7000)
  })

  it('para llevar: número de pedido; se cobra al hacerlo; estados recibido → en cocina → listo → entregado; aviso manual', async () => {
    const { s, T, arrachera, res, open, stock } = await restaurante()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'llevar', customerName: 'Mario', phone: '5544332211' } })).json.tab
    expect(tab).toMatchObject({ orderNumber: 1, orderStatus: 'recibido' })
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: arrachera.id, quantity: 2 }] } })
    expect((await s.call('POST', `/tabs/${tab.id}/send`, { token: T })).json.error.code).toBe('pedido_sin_pagar')
    await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    expect(await stock(res.id)).toBeCloseTo(9.4)
    await s.call('POST', `/tabs/${tab.id}/send`, { token: T })
    expect((await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab.orderStatus).toBe('en_cocina')
    const k = (await s.call('GET', '/kitchen', { token: T })).json.comandas[0]
    expect(k.where).toBe('Pedido #1')
    await s.call('POST', `/comandas/${k.id}/ready`, { token: T })
    expect((await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab.orderStatus).toBe('listo')
    const notice = (await s.call('GET', `/tabs/${tab.id}/notice`, { token: T })).json
    expect(notice.message).toContain('#1')
    expect(notice.whatsapp).toContain('wa.me/525544332211')
    await s.call('POST', `/tabs/${tab.id}/deliver`, { token: T })
    const second = (await s.call('POST', '/tabs', { token: T, body: { kind: 'recoger' } })).json.tab
    expect(second.orderNumber).toBe(2)
  })

  it('reserva de hora para recoger: apagada por defecto, con interruptor del dueño', async () => {
    const { s, T } = await restaurante()
    const pickupAt = new Date('2026-11-17T14:00:00-06:00').toISOString()
    expect((await s.call('POST', '/tabs', { token: T, body: { kind: 'recoger', pickupAt } })).status).toBe(400)
    await s.call('PUT', '/settings', { token: T, body: { pickupScheduling: true } })
    expect((await s.call('POST', '/tabs', { token: T, body: { kind: 'recoger', pickupAt } })).json.tab.pickupAt).toBe(pickupAt)
  })

  it('menú editable por el dueño sin tocar la caja; combos de platillos descuentan sus recetas', async () => {
    const { s, T, t1, arrachera, limonada, res, product, open, stock } = await restaurante()
    const combo = await product({ name: 'Combo arrachera + limonada', unit: 'pieza', price: 24000, trackStock: false, attrs: { station: 'cocina_caliente' } })
    await s.call('PUT', `/products/${combo.id}/combo`, { token: T, body: { items: [{ productId: arrachera.id, quantity: 1 }, { productId: limonada.id, quantity: 1 }] } })
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: t1 } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: combo.id, quantity: 1 }] } })
    const r = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    expect(r.json.parts[0].sale.total).toBe(24000)
    expect(await stock(res.id)).toBeCloseTo(9.7)
    expect(await stock(arrachera.id)).toBe(0)
    // El dueño desactiva un platillo: ya no se puede pedir.
    await s.call('PATCH', `/products/${limonada.id}`, { token: T, body: { active: false } })
    const tab2 = (await s.call('POST', '/tabs', { token: T, body: { kind: 'llevar' } })).json.tab
    expect((await s.call('POST', `/tabs/${tab2.id}/items`, { token: T, body: { items: [{ productId: limonada.id, quantity: 1 }] } })).status).toBe(400)
  })

  it('el mesero no puede poner un precio distinto sin código', async () => {
    const { s, o, T, t1, limonada, open } = await restaurante()
    const mesero = await s.createStaff(T, o.business.code, 'mesero2', 'cajero')
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: mesero.token, body: { kind: 'mesa', tableId: t1 } })).json.tab
    expect((await s.call('POST', `/tabs/${tab.id}/items`, { token: mesero.token, body: { items: [{ productId: limonada.id, quantity: 1, unitPrice: 100 }] } })).status).toBe(403)
    expect((await s.call('POST', `/tabs/${tab.id}/items`, { token: mesero.token, body: { items: [{ description: 'Algo', quantity: 1, unitPrice: 100 }] } })).status).toBe(403)
  })
})
