import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

// Martes 17/nov/2026, 09:00 hora local.
async function turistico() {
  const n = await negocioListo()
  const { s, T } = n
  s.setGiro('turistico')
  await s.call('PUT', '/tourism/slots', { token: T, body: { slots: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [{ weekday, start: '10:00', end: '13:00', capacity: 10 }, { weekday, start: '13:00', end: '17:00', capacity: 10 }]) } })
  const t = async (name: string, price: number) => (await s.call('POST', '/services', { token: T, body: { name, price, category: 'boleto' } })).json.service
  const adulto = await t('Adulto', 12000)
  const nino = await t('Niño', 6000)
  const mayor = await t('Adulto mayor', 6000)
  const guiada = await t('Visita guiada', 20000)
  const estacionamiento = (await s.call('POST', '/services', { token: T, body: { name: 'Estacionamiento', price: 3000, category: 'servicio' } })).json.service
  return { ...n, adulto, nino, mayor, guiada, estacionamiento }
}

describe('lugar turístico', () => {
  it('boletos por tipo, fecha y horario; aforo por horario: no se vende de más', async () => {
    const { s, T, open, adulto, nino } = await turistico()
    await open(0)
    const r = await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '10:00', items: [{ serviceId: adulto.id, quantity: 2 }, { serviceId: nino.id, quantity: 3 }] } })
    expect(r.json.sale.total).toBe(2 * 12000 + 3 * 6000)
    expect(r.json.tickets).toHaveLength(5)
    expect(new Set(r.json.tickets.map((t: any) => t.code)).size).toBe(5)
    const slots = (await s.call('GET', '/tourism/slots?date=2026-11-17', { token: T })).json.slots
    expect(slots[0]).toMatchObject({ sold: 5, available: 5 })
    expect((await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '10:00', items: [{ serviceId: adulto.id, quantity: 6 }] } })).json.error.code).toBe('sin_cupo')
    expect((s.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(1) // la venta rechazada no quedó
  })

  it('acceso con QR: un boleto una entrada; rechaza repetidos, vencidos, cancelados; aforo en tiempo real', async () => {
    const { s, T, open, adulto } = await turistico()
    await open(0)
    const tk = (await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '10:00', items: [{ serviceId: adulto.id, quantity: 3 }] } })).json.tickets
    const scan = (code: string) => s.call('POST', '/tourism/scan', { token: T, body: { code } })
    expect((await scan(tk[0].code)).json.occupancy).toBe(1)
    expect((await scan(tk[0].code)).json.error.code).toBe('boleto_usado')
    expect((await scan(tk[1].code)).json.occupancy).toBe(2)
    expect((await s.call('POST', '/tourism/exit', { token: T, body: { count: 1 } })).json.occupancy).toBe(1)
    expect((await s.call('GET', '/tourism/occupancy', { token: T })).json.inside).toBe(1)
    await s.call('POST', '/tickets/cancel', { token: T, body: { codes: [tk[2].code], reason: 'Se equivocó de día', refund: false, authCode: '4321' } })
    expect((await scan(tk[2].code)).json.error.code).toBe('boleto_cancelado')
    const later = (await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '10:00', items: [{ serviceId: adulto.id, quantity: 1 }] } })).json.tickets[0]
    s.advance(5 * 3600_000) // 14:00: el horario de 10 a 13 ya terminó
    expect((await scan(later.code)).json.error.code).toBe('boleto_vencido')
    expect((await scan('BTNOEXISTE0000')).status).toBe(404)
  })

  it('venta anticipada en línea: genera QR, queda por pagar (cuenta para el aforo) y se cobra en taquilla', async () => {
    const { s, T, o, open, adulto } = await turistico()
    s.addon('reservas')
    await s.call('PUT', '/modules', { token: T, body: { active: ['reservas'] } })
    const shop = (await (await s.app.request(`/public/tickets-shop/${o.business.code}?date=2026-11-18`)).json()) as any
    expect(shop.types.map((t: any) => t.name)).toContain('Adulto')
    expect(shop.types.map((t: any) => t.name)).not.toContain('Estacionamiento')
    const buy = await s.app.request(`/public/tickets-shop/${o.business.code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-11-18', start: '10:00', items: [{ serviceId: adulto.id, quantity: 4 }], name: 'Familia López', phone: '5512345000' }) })
    const order = (await buy.json()) as any
    expect(order.tickets).toHaveLength(4)
    const qr = await s.app.request(`/public/ticket-qr/${order.tickets[0].code}.svg`)
    expect(await qr.text()).toContain('<svg')
    expect((await s.call('GET', '/tourism/slots?date=2026-11-18', { token: T })).json.slots[0].available).toBe(6)
    s.advance(86_400_000) // llega el día
    expect((await s.call('POST', '/tourism/scan', { token: T, body: { code: order.tickets[0].code } })).json.error.code).toBe('boleto_sin_pagar')
    await open(0)
    // Lo comprado en línea se paga solo en efectivo o transferencia.
    expect((await s.call('POST', `/tourism/orders/${order.token}/pay`, { token: T, body: { paymentMethod: 'tarjeta' } })).status).toBe(400)
    const paid = await s.call('POST', `/tourism/orders/${order.token}/pay`, { token: T, body: { paymentMethod: 'transferencia' } })
    expect(paid.json.sale.total).toBe(48000)
    expect((await s.call('POST', '/tourism/scan', { token: T, body: { code: order.tickets[0].code } })).json.ok).toBe(true)
    const rep = (await s.call('GET', '/reports/tickets?from=2026-11-17&to=2026-11-18', { token: T })).json
    expect(rep.byChannel).toEqual([{ k: 'en_linea', tickets: 4, amount: 48000, visits: 1 }])
  })

  it('taquilla por turno: corte por tipo de boleto; tienda y estacionamiento por separado', async () => {
    const { s, T, open, sell, adulto, mayor, estacionamiento, product, buy } = await turistico()
    const shift = (await open(0)).json.shift.id
    await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '13:00', items: [{ serviceId: adulto.id, quantity: 2 }, { serviceId: mayor.id, quantity: 1 }] } })
    const iman = await product({ name: 'Imán recuerdo', unit: 'pieza', price: 5000 })
    await buy([{ productId: iman.id, quantity: 20, cost: 30000 }])
    await sell([{ productId: iman.id, quantity: 2 }, { serviceId: estacionamiento.id, quantity: 1 }])
    const corte = (await s.call('GET', `/shifts/${shift}/tickets`, { token: T })).json.byType
    expect(corte).toEqual(expect.arrayContaining([{ type: 'Adulto', tickets: 2, amount: 24000 }, { type: 'Adulto mayor', tickets: 1, amount: 6000 }]))
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.cashSales).toBe(30000 + 13000)
  })

  it('visitas guiadas con cupo, hora y guía', async () => {
    const { s, o, T, open, guiada } = await turistico()
    const guia = await s.createStaff(T, o.business.code, 'guia1', 'empleado_piso')
    const tour = (await s.call('POST', '/tours', { token: T, body: { name: 'Recorrido histórico', date: '2026-11-17', start: '11:00', capacity: 3, guideId: guia.id, serviceId: guiada.id } })).json.id
    await open(0)
    expect((await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '11:00', tourId: tour, items: [{ serviceId: guiada.id, quantity: 3 }] } })).status).toBe(201)
    expect((await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '11:00', tourId: tour, items: [{ serviceId: guiada.id, quantity: 1 }] } })).json.error.code).toBe('sin_cupo')
    expect((await s.call('GET', '/tours?date=2026-11-17', { token: T })).json.tours[0]).toMatchObject({ sold: 3, guide: 'guia1' })
  })

  it('cierre temporal por clima: con código, avisa y cancela los afectados; reembolso solo si el dueño lo decide', async () => {
    const { s, T, o, open, adulto } = await turistico()
    s.addon('reservas')
    await s.call('PUT', '/modules', { token: T, body: { active: ['reservas'] } })
    await open(0)
    await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '13:00', items: [{ serviceId: adulto.id, quantity: 2 }] } })
    await s.app.request(`/public/tickets-shop/${o.business.code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-11-17', start: '13:00', items: [{ serviceId: adulto.id, quantity: 1 }], name: 'Turista', phone: '5512340001' }) })
    const body = { date: '2026-11-17', start: '13:00', reason: 'lluvia fuerte', refund: true, refundMethod: 'efectivo' }
    expect((await s.call('POST', '/tourism/closures', { token: T, body })).json.error.code).toBe('codigo_requerido')
    const r = await s.call('POST', '/tourism/closures', { token: T, body: { ...body, authCode: '4321' } })
    expect(r.json).toMatchObject({ affected: 3, refunded: 24000 }) // el boleto por pagar no se reembolsa
    expect(r.json.notices[0].whatsapp).toContain('wa.me/525512340001')
    expect((await s.call('GET', '/tourism/slots?date=2026-11-17', { token: T })).json.slots[1]).toMatchObject({ closed: true, available: 0 })
    expect((await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '13:00', items: [{ serviceId: adulto.id, quantity: 1 }] } })).json.error.code).toBe('horario_cerrado')
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.expectedCash).toBe(0)
    const log = (await s.call('GET', '/audit', { token: T })).json.entries
    expect(log.some((e: any) => e.action === 'turistico.cancelacion' && e.authorized_by)).toBe(true)
  })

  it('grupos con descuento por cantidad vía promociones', async () => {
    const { s, T, open, adulto } = await turistico()
    await s.call('PUT', '/modules', { token: T, body: { active: ['promociones'] } })
    await s.call('POST', '/promotions', { token: T, body: { name: 'Grupo 10+', kind: 'porcentaje', value: 1500, startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z', appliesTo: { refs: [adulto.id] }, minQuantity: 10 } })
    await open(0)
    const r = await s.call('POST', '/tourism/sell', { token: T, body: { date: '2026-11-17', start: '13:00', items: [{ serviceId: adulto.id, quantity: 10 }] } })
    expect(r.json.sale.total).toBe(120000 - 18000)
  })
})
