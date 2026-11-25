import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

// El reloj de las pruebas empieza el martes 17/nov/2026 a las 09:00 (hora del centro de México).
const at = (hm: string, date = '2026-11-17') => new Date(`${date}T${hm}:00-06:00`).toISOString()
const SEMANA = [0, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '10:00', end: '19:00' })) // descansa los lunes

async function salon() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.setGiro('barberia')
  const juan = await s.createStaff(T, o.business.code, 'juan', 'barbero')
  const ana = await s.createStaff(T, o.business.code, 'ana', 'barbero')
  for (const b of [juan, ana]) await s.call('PUT', `/staff/${b.id}/agenda`, { token: T, body: { inAgenda: true, schedule: SEMANA } })
  const svc = async (body: object) => (await s.call('POST', '/services', { token: T, body })).json.service
  const corte = await svc({ name: 'Corte', price: 15000, durationMin: 30 })
  const barba = await svc({ name: 'Barba', price: 10000, durationMin: 20 })
  return { ...n, juan, ana, corte, barba }
}

describe('agenda: calendario gráfico (rango, fotos y edición)', () => {
  it('la agenda devuelve varios días con sus horarios y descansos por día', async () => {
    const { s, T, juan, corte } = await salon()
    await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('11:00'), customerName: 'Pedro' } })
    await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('12:00', '2026-11-19'), customerName: 'Luis' } })
    const sem = (await s.call('GET', '/agenda?date=2026-11-16&days=7', { token: T })).json
    expect(sem.days).toBe(7)
    expect(Object.keys(sem.hoursByDay)).toHaveLength(7)
    expect(sem.hoursByDay['2026-11-16']).toHaveLength(0) // lunes: descansan
    expect(sem.hoursByDay['2026-11-17'].length).toBe(2) // martes: Juan y Ana
    expect(sem.appointments.map((a: any) => a.customerName).sort()).toEqual(['Luis', 'Pedro'])
    // Un solo día sigue funcionando como antes.
    const dia = (await s.call('GET', '/agenda?date=2026-11-17', { token: T })).json
    expect(dia.days).toBe(1); expect(dia.appointments).toHaveLength(1); expect(dia.hours).toHaveLength(2)
    // El máximo es una semana.
    expect((await s.call('GET', '/agenda?date=2026-11-16&days=30', { token: T })).json.days).toBe(7)
  })

  it('la foto del profesional solo la pone el dueño, solo con https, y aparece en la lista', async () => {
    const { s, T, juan } = await salon()
    expect((await s.call('PUT', `/staff/${juan.id}/photo`, { token: juan.token, body: { url: 'https://ejemplo.com/j.jpg' } })).status).toBe(403) // un barbero no puede
    expect((await s.call('PUT', `/staff/${juan.id}/photo`, { token: T, body: { url: 'http://inseguro.com/j.jpg' } })).status).toBe(400)
    expect((await s.call('PUT', `/staff/${juan.id}/photo`, { token: T, body: { url: 'javascript:alert(1)' } })).status).toBe(400)
    expect((await s.call('PUT', `/staff/${juan.id}/photo`, { token: T, body: { url: 'https://ejemplo.com/j.jpg' } })).status).toBe(200)
    const lista = (await s.call('GET', '/agenda/staff', { token: T })).json.staff as any[]
    expect(lista.find((x) => x.id === juan.id).photoUrl).toBe('https://ejemplo.com/j.jpg')
    expect(lista.find((x) => x.name === 'ana').photoUrl).toBeNull()
    await s.call('PUT', `/staff/${juan.id}/photo`, { token: T, body: { url: null } })
    expect(((await s.call('GET', '/agenda/staff', { token: T })).json.staff as any[]).find((x) => x.id === juan.id).photoUrl).toBeNull()
    // Un profesional de otro negocio no se puede tocar.
    expect((await s.call('PUT', '/staff/otro-negocio/photo', { token: T, body: { url: 'https://ejemplo.com/x.jpg' } })).status).toBe(404)
  })

  it('editar una cita: cliente, notas y servicios (recalcula la duración y no se cruza); una cita terminada ya no se edita', async () => {
    const { s, T, juan, corte, barba, open } = await salon()
    await open()
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('11:00'), customerName: 'Pedro' } })).json.appointment
    const otra = (await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('11:40'), customerName: 'Sig' } })).json.appointment
    // Nombre, teléfono y notas.
    const e1 = await s.call('PATCH', `/appointments/${a.id}`, { token: T, body: { customerName: 'Pedro Pérez', phone: '5512345678', notes: 'Prefiere tijera' } })
    expect(e1.status).toBe(200); expect(e1.json.appointment).toMatchObject({ customerName: 'Pedro Pérez', notes: 'Prefiere tijera' })
    // Agregar barba: 30 + 20 = 50 min → termina 11:50 y choca con la cita de las 11:40.
    expect((await s.call('PATCH', `/appointments/${a.id}`, { token: T, body: { serviceIds: [corte.id, barba.id] } })).status).toBe(409)
    expect((await s.call('GET', '/agenda?date=2026-11-17', { token: T })).json.appointments.find((x: any) => x.id === a.id).endsAt).toBe(at('11:30'))
    // Quitar el choque (mover la otra) y ahora sí cabe.
    await s.call('POST', `/appointments/${otra.id}/reschedule`, { token: T, body: { startsAt: at('13:00') } })
    const e2 = await s.call('PATCH', `/appointments/${a.id}`, { token: T, body: { serviceIds: [corte.id, barba.id] } })
    expect(e2.status).toBe(200); expect(e2.json.appointment.endsAt).toBe(at('11:50'))
    expect(e2.json.appointment.services.map((x: any) => x.name)).toEqual(['Corte', 'Barba'])
    // Terminada: ya no se edita ni se reprograma; el cobro no se duplica.
    expect((await s.call('POST', `/appointments/${a.id}/complete`, { token: T })).status).toBe(200)
    expect((await s.call('PATCH', `/appointments/${a.id}`, { token: T, body: { notes: 'tarde' } })).status).toBe(409)
    const c1 = await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect([200, 201]).toContain(c1.status)
    expect((await s.call('POST', `/appointments/${a.id}/checkout`, { token: T, body: { paymentMethod: 'efectivo' } })).status).toBe(409)
  })

  it('reprogramar a otro profesional respeta cruces, horarios y descansos', async () => {
    const { s, T, juan, ana, corte } = await salon()
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: at('11:00'), customerName: 'Pedro' } })).json.appointment
    await s.call('POST', '/appointments', { token: T, body: { staffId: ana.id, serviceIds: [corte.id], startsAt: at('12:00'), customerName: 'Ocupa' } })
    expect((await s.call('POST', `/appointments/${a.id}/reschedule`, { token: T, body: { startsAt: at('12:15'), staffId: ana.id } })).status).toBe(409) // cruce con Ana
    expect((await s.call('POST', `/appointments/${a.id}/reschedule`, { token: T, body: { startsAt: at('09:00') } })).status).toBe(409) // antes de abrir
    expect((await s.call('POST', `/appointments/${a.id}/reschedule`, { token: T, body: { startsAt: at('12:00', '2026-11-23') } })).status).toBe(409) // lunes: descanso
    const ok = await s.call('POST', `/appointments/${a.id}/reschedule`, { token: T, body: { startsAt: at('14:00'), staffId: ana.id } })
    expect(ok.status).toBe(200); expect(ok.json.appointment).toMatchObject({ staffId: ana.id, startsAt: at('14:00'), endsAt: at('14:30') })
  })
})
