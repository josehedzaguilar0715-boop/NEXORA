import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

// El reloj de las pruebas empieza el martes 17/nov/2026 a las 09:00 (hora del centro de México).
const at = (hm: string, date = '2026-11-17') => new Date(`${date}T${hm}:00-06:00`).toISOString()
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== 1).map((weekday) => ({ weekday, start: '10:00', end: '19:00' })) // descansa los lunes

async function barberia() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.addon('reservas')
  await s.call('PUT', '/modules', { token: T, body: { active: ['reservas', 'membresias'] } })
  const juan = await s.createStaff(T, o.business.code, 'juan', 'barbero')
  const luis = await s.createStaff(T, o.business.code, 'luis', 'barbero')
  for (const b of [juan, luis]) await s.call('PUT', `/staff/${b.id}/agenda`, { token: T, body: { inAgenda: true, schedule: ALL_WEEK } })
  const svc = async (body: object) => (await s.call('POST', '/services', { token: T, body })).json.service
  const corte = await svc({ name: 'Corte', price: 15000, durationMin: 30 })
  const barba = await svc({ name: 'Barba', price: 10000, durationMin: 20 })
  const combo = await svc({ name: 'Corte + barba', price: 22000 })
  await s.call('PUT', `/services/${combo.id}/combo`, { token: T, body: { items: [{ serviceId: corte.id, share: 13000 }, { serviceId: barba.id, share: 9000 }] } })
  const cera = await n.product({ name: 'Cera para cabello', unit: 'pieza', price: 18000 })
  await n.buy([{ productId: cera.id, quantity: 10, cost: 90000 }])
  return { ...n, juan, luis, corte, barba, combo, cera }
}

describe('barbería: agenda', () => {
  it('cita en mostrador por barbero, hora y duración; no se encima ni sale de horario o descanso', async () => {
    const { s, T, juan, corte, barba } = await barberia()
    const a = await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id, barba.id], startsAt: at('11:00'), customerName: 'Pedro' } })
    expect(a.json.appointment).toMatchObject({ status: 'confirmada', endsAt: at('11:50') })
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('11:30'), customerName: 'Otro' } })).json.error.message).toContain('otra cita')
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('18:45'), customerName: 'Tarde' } })).json.error.message).toContain('horario')
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('12:00', '2026-11-23'), customerName: 'Lunes' } })).json.error.message).toContain('descanso')
  })

  it('bloqueos de agenda por barbero', async () => {
    const { s, T, juan, corte } = await barberia()
    await s.call('POST', `/staff/${juan.id}/blocks`, { token: T, body: { startsAt: at('14:00'), endsAt: at('16:00'), reason: 'Comida y trámite' } })
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('15:00'), customerName: 'Xavi' } })).json.error.message).toContain('bloqueada')
    const av = (await s.call('GET', `/agenda/availability?date=2026-11-17&serviceIds=${corte.id}&staffId=${juan.id}`, { token: T })).json
    expect(av.slots).not.toContain('14:30')
    expect(av.slots).toContain('16:00')
    expect(av.slots[0]).toBe('10:00')
  })

  it('cliente sin cita: atención inmediata en la misma agenda', async () => {
    const { s, T, juan, corte } = await barberia()
    s.advance(2 * 3600_000) // 11:00
    const w = await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], walkIn: true, customerName: 'Sin cita' } })
    expect(w.json.appointment).toMatchObject({ status: 'en_atencion', source: 'sin_cita' })
    const day = (await s.call('GET', '/agenda?date=2026-11-17', { token: T })).json.appointments
    expect(day).toHaveLength(1)
  })
})

describe('barbería: cobro, comisiones y propinas', () => {
  it('comisión por barbero y servicio sobre precio final con descuento; propina aparte y sin comisión; producto en la misma cuenta', async () => {
    const { s, T, juan, corte, cera, open } = await barberia()
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ staffId: juan.id, targetType: 'service', targetId: corte.id, rateBp: 4000 }, { targetType: 'product', targetId: cera.id, rateBp: 1000 }] } })
    await open(0)
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('10:00'), customerName: 'Pedro' } })).json.appointment
    const v = await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'efectivo', items: [{ productId: cera.id, quantity: 1 }], discount: 3300, authCode: '4321', tips: [{ staffId: juan.id, amount: 5000 }] } })
    expect(v.status).toBe(201)
    expect(v.json.sale.total).toBe(15000 + 18000 - 3300) // 29 700; la propina no es ingreso del negocio
    const com = s.db.prepare('SELECT base, rate_bp, amount FROM sale_commissions ORDER BY amount DESC').all() as any[]
    // Descuento repartido: factor 29 700 / 33 000 = 0.9
    expect(com).toEqual([{ base: 13500, rate_bp: 4000, amount: 5400 }, { base: 16200, rate_bp: 1000, amount: 1620 }])
    const rep = (await s.call('GET', '/reports/commissions', { token: T })).json.staff[0]
    expect(rep).toMatchObject({ commission: 7020, tips: 5000, tipsCash: 5000 })
    const t = (await s.call('GET', '/shifts/current', { token: T })).json.totals
    expect(t.expectedCash).toBe(29700 + 5000) // la propina en efectivo está en la caja
    expect((await s.call('GET', '/agenda?date=2026-11-17', { token: T })).json.appointments[0].status).toBe('atendida')
  })

  it('sin valores predeterminados: sin regla no hay comisión; sin barbero asignado tampoco', async () => {
    const { s, T, juan, corte, sell, open } = await barberia()
    await open(0)
    await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }])
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'all', rateBp: 3000 }] } })
    await sell([{ serviceId: corte.id, quantity: 1 }])
    expect((s.db.prepare('SELECT COUNT(*) n FROM sale_commissions').get() as any).n).toBe(0)
    await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }])
    expect((s.db.prepare('SELECT amount, rate_bp FROM sale_commissions').get() as any)).toEqual({ amount: 4500, rate_bp: 3000 })
  })

  it('combo con precio fijo repartido entre sus servicios para la comisión', async () => {
    const { s, T, luis, corte, barba, combo, open } = await barberia()
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ staffId: luis.id, targetType: 'service', targetId: corte.id, rateBp: 5000 }, { staffId: luis.id, targetType: 'service', targetId: barba.id, rateBp: 2000 }] } })
    await open(0)
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: luis.id, serviceIds: [combo.id], startsAt: at('12:00'), customerName: 'Combo' } })).json.appointment
    expect(a.endsAt).toBe(at('12:50')) // duración = corte 30 + barba 20
    const v = await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'tarjeta' } })
    expect(v.json.sale.total).toBe(22000)
    const com = s.db.prepare('SELECT base, amount FROM sale_commissions ORDER BY base DESC').all()
    expect(com).toEqual([{ base: 13000, amount: 6500 }, { base: 9000, amount: 1800 }])
  })

  it('cancelar la venta anula comisión y propina', async () => {
    const { s, T, juan, corte, sell, open } = await barberia()
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'all', rateBp: 3000 }] } })
    await open(0)
    const v = await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }], { tips: [{ staffId: juan.id, amount: 2000 }] })
    await s.call('POST', `/sales/${v.json.sale.id}/cancel`, { token: T, body: { reason: 'Error', authCode: '4321' } })
    expect((await s.call('GET', '/reports/commissions', { token: T })).json.staff).toHaveLength(0)
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.expectedCash).toBe(0)
  })

  it('el barbero ve solo sus comisiones', async () => {
    const { s, T, juan, luis, corte, sell, open } = await barberia()
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'all', rateBp: 3000 }] } })
    await open(0)
    await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }])
    await sell([{ serviceId: corte.id, quantity: 1, staffId: luis.id }])
    await s.call('POST', '/auth/change-password', { token: juan.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
    const mine = (await s.call('GET', '/reports/commissions', { token: juan.token })).json.staff
    expect(mine).toHaveLength(1)
    expect(mine[0].name).toBe('juan')
  })
})

describe('barbería: reserva pública por link', () => {
  it('el cliente elige servicio y "el primero disponible", solo ve horas libres; queda pendiente hasta confirmar y ve el estado', async () => {
    const { s, T, o, juan, luis, corte } = await barberia()
    const code = o.business.code
    const info = (await (await s.app.request(`/public/book/${code}`)).json()) as any
    expect(info.services.map((x: any) => x.name)).toContain('Corte')
    expect(info.staff).toHaveLength(2)
    // Juan ocupado a las 10:00; Luis bloqueado a las 10:00 → nadie libre a esa hora.
    await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('10:00'), customerName: 'Ana' } })
    await s.call('POST', `/staff/${luis.id}/blocks`, { token: T, body: { startsAt: at('10:00'), endsAt: at('11:00'), reason: 'Junta' } })
    const av = await (await s.app.request(`/public/book/${code}/availability?date=2026-11-17&serviceIds=${corte.id}&staffId=any`)).json() as any
    expect(av.slots).not.toContain('10:00')
    expect(av.slots).toContain('10:30')
    const book = async (time: string, phone = '5599990000') => s.app.request(`/public/book/${code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceIds: [corte.id], staffId: 'any', date: '2026-11-17', time, name: 'Cliente Web', phone }) })
    expect((await book('10:00')).status).toBe(409)
    const r = await (await book('10:30')).json() as any
    expect(r.appointment.status).toBe('pendiente')
    expect(r.appointment.phone).toBeUndefined() // el link público no expone datos privados
    let st = await (await s.app.request(`/public/appointments/${r.token}`)).json() as any
    expect(st.appointment.status).toBe('pendiente')
    const appt = (await s.call('GET', '/agenda?date=2026-11-17', { token: T })).json.appointments.find((x: any) => x.source === 'link')
    await s.call('POST', `/appointments/${appt.id}/confirm`, { token: T })
    st = await (await s.app.request(`/public/appointments/${r.token}`)).json() as any
    expect(st.appointment.status).toBe('confirmada')
  })

  it('el link solo funciona con el módulo de reservas activo; límite de reservas pendientes por teléfono', async () => {
    const { s, T, o, corte } = await barberia()
    const book = (time: string) => s.app.request(`/public/book/${o.business.code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceIds: [corte.id], staffId: 'any', date: '2026-11-18', time, name: 'Spam', phone: '5511110000' }) })
    for (const t of ['10:00', '11:00', '12:00']) expect((await book(t)).status).toBe(201)
    expect((await book('13:00')).status).toBe(429)
    await s.call('PUT', '/modules', { token: T, body: { active: [] } })
    expect((await s.app.request(`/public/book/${o.business.code}`)).status).toBe(404)
  })
})
