import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function palapa() {
  const n = await negocioListo()
  const { s, o, T } = n
  await s.call('PATCH', '/business', { token: T, body: { giro: 'palapa' } })
  const mesero = await s.createStaff(T, o.business.code, 'mesero1', 'cajero')
  const mesa = (await s.call('POST', '/tables', { token: T, body: { name: '5', area: 'playa', seats: 6, minConsumption: 50000 } })).json.id
  const mesa2 = (await s.call('POST', '/tables', { token: T, body: { name: '6', area: 'playa', seats: 4 } })).json.id
  // Insumos con costo y platillos con receta (sin existencia propia).
  const camaron = await n.product({ name: 'Camarón (kg)', unit: 'kg', price: 0, sellable: false })
  const pescado = await n.product({ name: 'Pescado entero', unit: 'kg', price: 32000, attrs: { station: 'cocina' } }) // precio por kilo del día
  const hielo = await n.product({ name: 'Bolsa de hielo', unit: 'pieza', price: 3000, attrs: { station: 'barra' } })
  const cerveza = await n.product({ name: 'Cerveza', unit: 'pieza', price: 4000, attrs: { station: 'barra' } })
  const coctel = await n.product({ name: 'Cóctel de camarón', unit: 'pieza', price: 18000, trackStock: false, attrs: { station: 'cocina', modifiers: [{ name: 'Grande', price: 6000 }] } })
  await s.call('PUT', `/recipes/${coctel.id}`, { token: T, body: { items: [{ productId: camaron.id, quantity: 0.2 }] } })
  await n.buy([{ productId: camaron.id, quantity: 5, cost: 120000 }, { productId: pescado.id, quantity: 10, cost: 180000 }, { productId: hielo.id, quantity: 20, cost: 20000 }, { productId: cerveza.id, quantity: 48, cost: 96000 }])
  return { ...n, mesero, mesa, mesa2, camaron, pescado, hielo, cerveza, coctel }
}

describe('palapa', () => {
  it('mesa con cuenta abierta; comandas a cocina y barra con mesa y hora; recetas descuentan insumos', async () => {
    const { s, T, mesa, coctel, cerveza, camaron, open, stock } = await palapa()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa, people: 3 } })).json.tab
    expect((await s.call('GET', '/tables', { token: T })).json.tables.find((t: any) => t.id === mesa).status).toBe('ocupada')
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: coctel.id, quantity: 2, modifiers: ['Grande'] }, { productId: cerveza.id, quantity: 4 }] } })
    const sent = await s.call('POST', `/tabs/${tab.id}/send`, { token: T })
    expect(sent.json.comandas.map((k: any) => k.station).sort()).toEqual(['barra', 'cocina'])
    const barra = (await s.call('GET', '/kitchen?station=barra', { token: T })).json.comandas
    expect(barra).toHaveLength(1)
    expect(barra[0]).toMatchObject({ where: 'Mesa 5', items: [{ description: 'Cerveza', quantity: 4 }] })
    const r = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    expect(r.json.parts[0].sale.total).toBe(2 * 24000 + 4 * 4000)
    expect(await stock(camaron.id)).toBe(4.6)
    expect(await stock(coctel.id)).toBe(0) // platillo: sin existencia propia
  })

  it('cobro dividido por persona y por producto; propinas por mesero aparte', async () => {
    const { s, T, mesa2, coctel, cerveza, mesero, open } = await palapa()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa2, people: 2, waiterId: mesero.id } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: coctel.id, quantity: 1, person: 1 }, { productId: cerveza.id, quantity: 2, person: 1 }, { productId: coctel.id, quantity: 1, person: 2 }, { productId: cerveza.id, quantity: 1, person: 2 }] } })
    const view = (await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab
    expect(view.byPerson).toEqual({ 1: 26000, 2: 22000 })
    const p1 = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ person: 1, paymentMethod: 'tarjeta', tip: 3000, tipMethod: 'tarjeta' }] } })
    expect(p1.json.parts[0]).toMatchObject({ remaining: 22000 })
    const rest = (await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab.items.filter((i: any) => i.status !== 'pagado')
    await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ itemIds: [rest[0].id], paymentMethod: 'efectivo' }, { itemIds: [rest[1].id], paymentMethod: 'efectivo', tip: 2000 }] } })
    expect((await s.call('GET', '/tables', { token: T })).json.tables.find((t: any) => t.id === mesa2).status).toBe('limpieza')
    const tips = (await s.call('GET', '/reports/commissions', { token: T })).json.staff.find((x: any) => x.staffId === mesero.id)
    expect(tips).toMatchObject({ tips: 5000, tipsCash: 2000, commission: 0 })
    expect((await s.call('GET', '/reports/summary', { token: T })).json.sales.total).toBe(48000) // las propinas no son venta
  })

  it('consumo mínimo por mesa: se cobra la diferencia', async () => {
    const { s, T, mesa, cerveza, open } = await palapa()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: cerveza.id, quantity: 5 }] } })
    const r = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    expect(r.json.parts[0].sale.total).toBe(50000)
    expect(r.json.parts[0].sale.items.map((i: any) => i.description)).toContain('Diferencia de consumo mínimo')
  })

  it('reservas de mesa confirmadas por el dueño o encargado; se ven en el mapa', async () => {
    const { s, o, T, mesa2 } = await palapa()
    const caj = await s.createStaff(T, o.business.code, 'cajera', 'cajero')
    const r = (await s.call('POST', '/table-reservations', { token: caj.token, body: { tableId: mesa2, startsAt: new Date('2026-11-17T09:30:00-06:00').toISOString(), people: 4, name: 'Familia Ruiz', phone: '5511112222' } })).json
    expect(r.status).toBe('pendiente')
    expect((await s.call('POST', `/table-reservations/${r.id}/confirm`, { token: caj.token })).status).toBe(403)
    expect((await s.call('POST', `/table-reservations/${r.id}/confirm`, { token: T })).json.status).toBe('confirmada')
    const t = (await s.call('GET', '/tables', { token: T })).json.tables.find((x: any) => x.id === mesa2)
    expect(t).toMatchObject({ status: 'reservada', reservation: { name: 'Familia Ruiz', people: 4 } })
  })

  it('renta de activos con su propio control de inventario', async () => {
    const { s, T, mesa, open } = await palapa()
    const camastro = (await s.call('POST', '/rental-assets', { token: T, body: { name: 'Camastro', quantity: 3, price: 5000 } })).json.id
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/rentals`, { token: T, body: { assetId: camastro, quantity: 2 } })
    expect((await s.call('POST', `/tabs/${tab.id}/rentals`, { token: T, body: { assetId: camastro, quantity: 2 } })).json.error.code).toBe('sin_disponibles')
    expect((await s.call('GET', '/rental-assets', { token: T })).json.assets[0]).toMatchObject({ out: 2, available: 1 })
    await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    expect((await s.call('GET', '/rental-assets', { token: T })).json.assets[0].available).toBe(3) // al cerrar la cuenta regresan
  })

  it('precio por kilo del día con código; bebidas y hielo con costo; merma de perecederos', async () => {
    const { s, T, mesa, pescado, hielo, open, stock } = await palapa()
    expect((await s.call('PATCH', `/products/${pescado.id}`, { token: T, body: { price: 35000 } })).json.error.code).toBe('codigo_requerido')
    await s.call('PATCH', `/products/${pescado.id}`, { token: T, body: { price: 35000, authCode: '4321' } })
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: pescado.id, quantity: 1.2 }, { productId: hielo.id, quantity: 1 }] } })
    const v = await s.call('POST', `/tabs/${tab.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    expect(v.json.parts[0].sale.total).toBe(Math.max(50000, 42000 + 3000))
    expect(await stock(hielo.id)).toBe(19)
    await s.call('POST', '/inventory/waste', { token: T, body: { productId: pescado.id, quantity: 1, reason: 'Se descompuso por calor' } })
    expect(await stock(pescado.id)).toBeCloseTo(7.8)
    const r = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(r.waste).toBe(18000)
  })

  it('cancelar o regalar un platillo pide siempre el código del dueño y queda en bitácora', async () => {
    const { s, o, T, mesa, coctel, open } = await palapa()
    const enc = await s.createStaff(T, o.business.code, 'encargado1', 'encargado')
    await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa } })).json.tab
    const items = (await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: coctel.id, quantity: 1 }, { productId: coctel.id, quantity: 1 }] } })).json.tab.items
    expect((await s.call('POST', `/tab-items/${items[0].id}/cancel`, { token: T, body: { reason: 'Se equivocó' } })).json.error.code).toBe('codigo_requerido')
    expect((await s.call('POST', `/tab-items/${items[0].id}/cancel`, { token: T, body: { reason: 'Se equivocó', authCode: '7777' } })).status).toBe(403)
    await s.call('POST', `/tab-items/${items[0].id}/cancel`, { token: T, body: { reason: 'Se equivocó', authCode: '4321' } })
    await s.call('POST', `/tab-items/${items[1].id}/courtesy`, { token: T, body: { reason: 'Cumpleaños', authCode: '4321' } })
    expect((await s.call('GET', `/tabs/${tab.id}`, { token: T })).json.tab.pending).toBe(0)
    const log = (await s.call('GET', '/audit', { token: T })).json.entries.map((e: any) => e.action)
    expect(log).toEqual(expect.arrayContaining(['cuenta.cancelacion', 'cuenta.cortesia']))
  })

  it('sin señal: reenviar los mismos renglones (mismo id) no los duplica', async () => {
    const { s, T, mesa, cerveza, open } = await palapa()
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { id: s.uuid(), kind: 'mesa', tableId: mesa } })).json.tab
    const body = { items: [{ id: s.uuid(), productId: cerveza.id, quantity: 2 }] }
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body })
    const again = await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body })
    expect(again.json.tab.items).toHaveLength(1)
  })
})
