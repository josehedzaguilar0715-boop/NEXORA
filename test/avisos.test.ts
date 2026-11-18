import { describe, expect, it, vi } from 'vitest'
import { negocioListo } from './helpers.js'

const titles = (r: any) => r.json.items.map((i: any) => i.title)

describe('avisos al dueño y al personal', () => {
  it('stock bajo una vez al día, cancelación y corte con faltante le llegan al dueño; el cajero no los ve', async () => {
    const { s, o, T, product, buy, open, sell } = await negocioListo()
    const coca = await product({ name: 'Coca 600', unit: 'pieza', price: 2000, minStock: 10 })
    await buy([{ productId: coca.id, quantity: 12, cost: 14400 }])
    await open(0)
    await sell([{ productId: coca.id, quantity: 3 }]) // quedan 9 < 10
    await sell([{ productId: coca.id, quantity: 1 }]) // no se repite el mismo día
    let r = await s.call('GET', '/notifications', { token: T })
    expect(titles(r)).toEqual(['Stock bajo: Coca 600'])
    expect(r.json.items[0].body).toContain('Quedan 9 pzas')
    expect(r.json.unread).toBe(1)
    await s.call('POST', '/notifications/seen', { token: T })
    expect((await s.call('GET', '/notifications', { token: T })).json.unread).toBe(0)
    s.advance(60_000)

    const enc = await s.createStaff(T, o.business.code, 'encargada', 'encargado')
    await s.call('POST', '/shifts/open', { token: enc.token, body: { openingFloat: 10000 } })
    const v = (await s.call('POST', '/sales', { token: enc.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ productId: coca.id, quantity: 1 }] } })).json.sale
    await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
    expect((await s.call('POST', `/sales/${v.id}/cancel`, { token: enc.token, body: { reason: 'Se equivocó de producto', authCode: '7777' } })).status).toBe(200)
    const sh = (await s.call('GET', '/shifts/current', { token: enc.token })).json.shift
    expect((await s.call('POST', `/shifts/${sh.id}/close`, { token: enc.token, body: { countedCash: 5000, reason: 'Pago de garrafón' } })).status).toBe(200)
    r = await s.call('GET', '/notifications', { token: T })
    expect(titles(r)).toEqual(expect.arrayContaining([`Venta #${v.folio} cancelada ($20.00)`, 'Corte de encargada con faltante de $50.00']))
    expect(r.json.unread).toBe(2)
    // El cajero/encargado no recibe los avisos del dueño, pero sí el de stock (tiene inventario).
    const re = await s.call('GET', '/notifications', { token: enc.token })
    expect(titles(re)).toEqual(['Stock bajo: Coca 600'])
    const caj = await s.createStaff(T, o.business.code, 'cajero3', 'cajero')
    expect((await s.call('GET', '/notifications', { token: caj.token })).json.items).toEqual([])
  })

  it('cocina recibe las comandas; el mesero, que ya está listo; push solo a servicios conocidos', async () => {
    const { s, o, T, product, open } = await negocioListo()
    s.setGiro('comedor')
    const mesa = (await s.call('POST', '/tables', { token: T, body: { name: '4', area: 'salon', seats: 4 } })).json.id
    const corrida = await product({ name: 'Comida corrida', unit: 'pieza', price: 9500, trackStock: false })
    const mesero = await s.createStaff(T, o.business.code, 'mesero1', 'cajero')
    await open(0)
    const tab = (await s.call('POST', '/tabs', { token: mesero.token, body: { kind: 'mesa', tableId: mesa, people: 2 } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: mesero.token, body: { items: [{ productId: corrida.id, quantity: 2 }] } })

    const k = await s.createStaff(T, o.business.code, 'cocina1', 'cocina')
    // Push: la cocina activa avisos en su celular (endpoint de un servicio conocido).
    expect((await s.call('POST', '/push/subscribe', { token: k.token, body: { endpoint: 'https://evil.example.com/x' } })).status).toBe(400)
    const key = (await s.call('GET', '/push/key', { token: k.token })).json.publicKey
    expect(key).toMatch(/^[A-Za-z0-9_-]{87}$/) // 65 bytes en base64url
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect((await s.call('POST', '/push/subscribe', { token: k.token, body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' } })).status).toBe(201)
      await s.call('POST', `/tabs/${tab.id}/send`, { token: mesero.token })
      await new Promise((r) => setTimeout(r, 50))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://fcm.googleapis.com/fcm/send/abc')
      expect((init.headers as Record<string, string>).authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    } finally { vi.unstubAllGlobals() }

    const rk = await s.call('GET', '/notifications', { token: k.token })
    expect(rk.json).toMatchObject({ push: true, unread: 1 })
    expect(rk.json.items[0]).toMatchObject({ title: 'Nueva comanda · Mesa 4', body: '2 Comida corrida', link: '#/cocina' })
    expect((await s.call('GET', '/notifications/latest', { token: k.token })).json.notice.title).toBe('Nueva comanda · Mesa 4')
    // El dueño no se llena de comandas.
    expect(titles(await s.call('GET', '/notifications', { token: T }))).not.toContain('Nueva comanda · Mesa 4')

    const com = (await s.call('GET', '/kitchen', { token: k.token })).json.comandas[0]
    await s.call('POST', `/comandas/${com.id}/ready`, { token: k.token })
    expect(titles(await s.call('GET', '/notifications', { token: mesero.token }))).toContain('Listo para entregar · Mesa 4')
  })

  it('cita por link: le avisa al dueño y a quien la atiende', async () => {
    const { s, o, T } = await negocioListo()
    s.setGiro('barberia')
    const b = await s.createStaff(T, o.business.code, 'barbero1', 'barbero')
    await s.call('PUT', `/staff/${b.id}/agenda`, { token: T, body: { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: '09:00', end: '20:00' })) } })
    const sv = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    s.addon('reservas')
    await s.call('PUT', '/modules', { token: T, body: { active: ['reservas'] } })
    const r = await s.call('POST', `/public/book/${o.business.code}`, { body: { serviceIds: [sv.id], staffId: b.id, date: '2026-11-18', time: '16:00', name: 'Joel Zamorano', phone: '9632369624' } })
    expect(r.status).toBe(201)
    for (const tk of [T, b.token]) {
      const n = (await s.call('GET', '/notifications', { token: tk })).json.items[0]
      expect(n).toMatchObject({ title: 'Nueva cita por confirmar · Joel Zamorano', link: '#/agenda' })
      expect(n.body).toContain('4:00 p.m.')
    }
  })
})
