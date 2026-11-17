import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

const at = (hm: string, date = '2026-11-17') => new Date(`${date}T${hm}:00-06:00`).toISOString()

async function unas() {
  const n = await negocioListo()
  const { s, o, T } = n
  await s.call('PATCH', '/business', { token: T, body: { giro: 'unas' } })
  const ana = await s.createStaff(T, o.business.code, 'anaunas', 'barbero')
  await s.call('PUT', `/staff/${ana.id}/agenda`, { token: T, body: { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '20:00' })) } })
  const gel = await n.product({ name: 'Gel UV (ml)', unit: 'litro', price: 0, sellable: false })
  const lima = await n.product({ name: 'Lima desechable', unit: 'pieza', price: 0, sellable: false })
  await n.buy([{ productId: gel.id, quantity: 1, cost: 200000 }, { productId: lima.id, quantity: 100, cost: 5000 }])
  const svc = async (body: object) => (await s.call('POST', '/services', { token: T, body })).json.service
  // Técnica con duración y tiempo de secado que bloquea la agenda; retoque cada 21 días.
  const acrilico = await svc({ name: 'Uñas acrílicas', category: 'acrilico', price: 45000, durationMin: 90, attrs: { technique: 'acrilico', extraBlockMin: 15, retouchDays: 21 } })
  const mani = await svc({ name: 'Manicure', category: 'manicure', price: 20000, durationMin: 40 })
  await s.call('PUT', `/recipes/${acrilico.id}`, { token: T, body: { items: [{ productId: gel.id, quantity: 0.008 }, { productId: lima.id, quantity: 1 }] } })
  return { ...n, ana, gel, lima, acrilico, mani }
}

describe('estudio de uñas', () => {
  it('el tiempo de secado bloquea la agenda', async () => {
    const { s, T, ana, acrilico, mani } = await unas()
    const a = await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [acrilico.id], startsAt: at('10:00'), customerName: 'Mariana' } })
    expect(a.json.appointment.endsAt).toBe(at('11:45')) // 90 min + 15 de secado
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [mani.id], startsAt: at('11:30'), customerName: 'Karla' } })).status).toBe(409)
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [mani.id], startsAt: at('11:45'), customerName: 'Karla' } })).status).toBe(201)
  })

  it('cada técnica descuenta sus consumibles; comisión por técnica; propina aparte', async () => {
    const { s, T, ana, acrilico, gel, lima, open, stock } = await unas()
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'category', targetId: 'acrilico', rateBp: 3500 }] } })
    await open(0)
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [acrilico.id], startsAt: at('10:00'), customerName: 'Mariana' } })).json.appointment
    await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'tarjeta', tips: [{ staffId: ana.id, amount: 5000, method: 'tarjeta' }] } })
    expect(await stock(gel.id)).toBeCloseTo(0.992)
    expect(await stock(lima.id)).toBe(99)
    const rep = (await s.call('GET', '/reports/commissions', { token: T })).json.staff[0]
    expect(rep).toMatchObject({ commission: 15750, tips: 5000, tipsCash: 0 })
  })

  it('paquete de sesiones: N usos en total dentro de su vigencia', async () => {
    const { s, T } = await unas()
    await s.call('PUT', '/modules', { token: T, body: { active: ['membresias'] } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Sofía' } })).json.customer
    const plan = (await s.call('POST', '/membership-plans', { token: T, body: { name: '5 manicures', kind: 'paquete', usesPerPeriod: 5, validityDays: 90, period: 'mes', price: 85000 } })).json.id
    const m = (await s.call('POST', `/customers/${cli.id}/memberships`, { token: T, body: { planId: plan } })).json.membership
    expect(m).toMatchObject({ kind: 'paquete', remaining: 5 })
    s.longLived()
    for (let i = 0; i < 5; i++) {
      expect((await s.call('POST', '/scan', { token: T, body: { code: cli.code, action: 'membresia' } })).status).toBe(200)
      s.advance(15 * 86_400_000) // cada 15 días: atraviesa varios meses sin reiniciar
    }
    expect((await s.call('POST', '/scan', { token: T, body: { code: cli.code, action: 'membresia' } })).json.error.code).toBe('sin_usos')
  })

  it('a domicilio: dirección por clienta; el traslado bloquea la agenda; cargo opcional fuera de comisión', async () => {
    const { s, T, ana, mani, open } = await unas()
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'all', rateBp: 5000 }] } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Elena', phone: '5512312312' } })).json.customer
    await s.call('PATCH', `/customers/${cli.id}`, { token: T, body: { address: 'Calle Reforma 10, Col. Centro', homeAll: true } })
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [mani.id], startsAt: at('12:00'), customerId: cli.id, travelMin: 30 } })).json.appointment
    expect(a).toMatchObject({ atHome: true, address: 'Calle Reforma 10, Col. Centro', travelMin: 30 })
    // 11:30–13:10 queda ocupado por el traslado de ida y vuelta.
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [mani.id], startsAt: at('10:55'), customerName: 'Otra' } })).status).toBe(409)
    expect((await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [mani.id], startsAt: at('13:10'), customerName: 'Otra' } })).status).toBe(201)
    // Cargo por traslado apagado por defecto.
    await open(0)
    const sinCargo = await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect(sinCargo.json.sale.total).toBe(20000)
    // Encendido: va en la cuenta pero no genera comisión.
    await s.call('PUT', '/settings', { token: T, body: { travelFee: 8000 } })
    const b = (await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [mani.id], startsAt: at('16:00'), customerId: cli.id, travelMin: 20 } })).json.appointment
    const v = await s.call('POST', `/appointments/${b.id}/checkout`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect(v.json.sale.total).toBe(28000)
    const com = s.db.prepare('SELECT SUM(amount) a FROM sale_commissions WHERE sale_id = ?').get(v.json.sale.id) as any
    expect(com.a).toBe(10000) // 50 % de la manicure, nada del traslado
  })

  it('la dirección no aparece en el link público', async () => {
    const { s, T, o, ana, mani } = await unas()
    s.addon('reservas')
    await s.call('PUT', '/modules', { token: T, body: { active: ['reservas'] } })
    const r = await s.app.request(`/public/book/${o.business.code}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceIds: [mani.id], staffId: ana.id, date: '2026-11-18', time: '10:00', name: 'Web', phone: '5511112222' }) })
    const j = (await r.json()) as any
    expect(j.appointment.address).toBeUndefined()
  })

  it('notas de la clienta: texto libre que escribe solo el dueño', async () => {
    const { s, o, T } = await unas()
    const enc = await s.createStaff(T, o.business.code, 'recepcion', 'encargado')
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Lucía', notes: 'Prefiere tonos nude' } })).json.customer
    expect((await s.call('PATCH', `/customers/${cli.id}`, { token: enc.token, body: { notes: 'otra cosa' } })).status).toBe(403)
    expect((await s.call('PATCH', `/customers/${cli.id}`, { token: T, body: { notes: 'Prefiere tonos nude; no le gusta cuadrada' } })).status).toBe(200)
  })

  it('recordatorio de retoque: apagado por defecto; al activarlo solo prepara el mensaje', async () => {
    const { s, T, ana, acrilico, open } = await unas()
    await open(0)
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [acrilico.id], startsAt: at('10:00'), customerName: 'Mariana', phone: '5544443333' } })).json.appointment
    await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect((await s.call('GET', '/reminders/retouch', { token: T })).json.error.code).toBe('modulo_inactivo')
    await s.call('PUT', '/modules', { token: T, body: { active: ['recordatorios'] } })
    s.longLived()
    expect((await s.call('GET', '/reminders/retouch', { token: T })).json.reminders).toHaveLength(0)
    s.advance(22 * 86_400_000)
    const r = (await s.call('GET', '/reminders/retouch', { token: T })).json.reminders
    expect(r).toHaveLength(1)
    expect(r[0].whatsapp).toContain('wa.me/525544443333')
  })
})
