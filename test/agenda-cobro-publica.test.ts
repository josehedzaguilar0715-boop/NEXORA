import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

/** Agenda → Caja: la cita terminada queda «por cobrar» y se cobra aparte; la página pública no revela datos personales. */
async function barberia() {
  const n = await negocioListo()
  n.s.setGiro?.('barberia')
  const { s, T } = n
  s.db.prepare("UPDATE businesses SET giro = 'barberia'").run()
  const svc = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
  const me = (await s.call('GET', '/auth/me', { token: T })).json.user
  await s.call('PUT', `/staff/${me.id}/agenda`, { token: T, body: { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '19:00' })) } })
  return { ...n, svc, me }
}
/** 11:00 hora de México (UTC−6) del día de la prueba. */
const a11 = '2026-11-17T17:00:00.000Z'

describe('agenda → caja', () => {
  it('terminar la cita la deja por cobrar; Caja la cobra una sola vez y la cita pasa a cobrada', async () => {
    const { s, T, svc, me, open } = await barberia()
    await open(10_000)
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: me.id, serviceIds: [svc.id], startsAt: a11, customerName: 'Cliente Prueba', phone: '5511223344' } })).json.appointment
    expect(a?.id).toBeTruthy()
    expect((await s.call('GET', '/agenda/to-charge', { token: T })).json.appointments).toHaveLength(0)
    const t = await s.call('POST', `/appointments/${a.id}/complete`, { token: T })
    expect(t.status).toBe(200)
    expect(t.json.appointment).toMatchObject({ status: 'en_atencion', toCharge: true })
    expect((await s.call('POST', `/appointments/${a.id}/complete`, { token: T })).status).toBe(409) // ya terminada
    const pend = (await s.call('GET', '/agenda/to-charge', { token: T })).json.appointments
    expect(pend).toHaveLength(1)
    expect(pend[0]).toMatchObject({ id: a.id, total: 15000 })
    const ch = await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', cashReceived: 20000 } })
    expect(ch.status).toBe(201)
    expect((await s.call('GET', '/agenda/to-charge', { token: T })).json.appointments).toHaveLength(0)
    expect((await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo' } })).status).toBe(409)
    // La venta existe y la finanza la ve.
    expect((await s.call('GET', '/finanzas/resumen', { token: T })).json.vendido).toBe(15000)
  })

  it('un empleado sin permiso de vender no ve las citas por cobrar', async () => {
    const { s, T, o } = await barberia()
    const piso = await s.createStaff(T, o.business.code, 'pisito', 'empleado_piso', { permissions: ['attendance'] })
    expect((await s.call('GET', '/agenda/to-charge', { token: piso.token })).status).toBe(403)
  })
})

describe('página pública de reservas', () => {
  it('muestra identidad, servicios y horario; no nombre personal del dueño ni datos internos', async () => {
    const { s, T, svc, me } = await barberia()
    s.db.prepare("UPDATE businesses SET logo_url = 'https://ejemplo.mx/logo.png'").run()
    s.db.prepare("UPDATE businesses SET addons = '[\"reservas\"]', modules = '[\"reservas\"]'").run()
    const code = (s.db.prepare('SELECT code FROM businesses').get() as { code: string }).code
    const r = await s.call('GET', `/public/book/${code}`)
    expect(r.status).toBe(200)
    expect(r.json.business.logoUrl).toBe('https://ejemplo.mx/logo.png')
    expect(r.json.hours).toHaveLength(7)
    expect(r.json.hours[0]).toMatchObject({ start: '09:00', end: '19:00' })
    expect(r.json.services.map((x: any) => x.name)).toContain('Corte')
    // El dueño atiende: se muestra el nombre del negocio, no su nombre personal.
    const ownerName = (s.db.prepare("SELECT name FROM users WHERE role = 'owner'").get() as { name: string }).name
    const txt = JSON.stringify(r.json)
    expect(r.json.staff).toHaveLength(1)
    expect(r.json.staff[0].name).toBe((s.db.prepare('SELECT name FROM businesses').get() as { name: string }).name)
    expect(txt).not.toContain(ownerName)
    // Nada interno: ni identificadores de usuario con datos, ni correo, ni permisos.
    for (const k of ['permissions', 'password', 'email', 'username', 'branch_id', 'business_id']) expect(txt.toLowerCase()).not.toContain(k)
    void svc; void me; void T
  })
})
