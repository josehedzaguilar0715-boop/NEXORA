import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('enlaces públicos sin datos internos', () => {
  async function barberia() {
    const n = await negocioListo()
    const { s, T } = n
    s.setGiro('barberia')
    s.addon('reservas')
    await s.call('PUT', '/modules', { token: T, body: { active: ['reservas'] } })
    await s.call('PATCH', '/business', { token: T, body: { name: 'Fénix Barbería' } })
    const b = await s.createStaff(T, n.o.business.code, 'luis', 'barbero', { name: 'Luis Alberto Pérez Gómez' })
    await s.call('PUT', `/staff/${b.id}/agenda`, { token: T, body: { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: '09:00', end: '20:00' })) } })
    const sv = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    return { ...n, b, sv }
  }

  it('el enlace usa un identificador público, distinto del código con el que entran los empleados', async () => {
    const { s, T, o } = await barberia()
    const { slug } = (await s.call('GET', '/business/public-link', { token: T })).json
    expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{4}$/)
    expect(slug.toUpperCase()).not.toContain(o.business.code)
    // Pedirlo otra vez da el mismo.
    expect((await s.call('GET', '/business/public-link', { token: T })).json.slug).toBe(slug)
    const pub = (await s.app.request(`/public/book/${slug}`)).status
    expect(pub).toBe(200)
    // Los enlaces viejos (con el código) siguen funcionando para no romper los ya compartidos.
    expect((await s.app.request(`/public/book/${o.business.code}`)).status).toBe(200)
  })

  it('el dueño elige un enlace fácil; se valida y no puede repetirse', async () => {
    const { s, T, o } = await barberia()
    expect((await s.call('PUT', '/business/public-link', { token: T, body: { slug: 'Fénix!' } })).status).toBe(400)
    expect((await s.call('PUT', '/business/public-link', { token: T, body: { slug: 'fenix-barberia' } })).json.slug).toBe('fenix-barberia')
    expect((await s.app.request('/public/book/fenix-barberia')).status).toBe(200)
    // Un empleado no puede cambiarlo.
    const caj = await s.createStaff(T, o.business.code, 'caja1', 'cajero')
    expect((await s.call('PUT', '/business/public-link', { token: caj.token, body: { slug: 'otra-cosa' } })).status).toBe(403)
    // Otro negocio no puede usar el mismo.
    const o2 = await s.registerOwner('5598887766')
    expect((await s.call('PUT', '/business/public-link', { token: o2.token, body: { slug: 'fenix-barberia' } })).json.error.code).toBe('enlace_ocupado')
  })

  it('la página pública no muestra apellidos ni identificadores internos del personal', async () => {
    const { s, T, b, sv } = await barberia()
    const { slug } = (await s.call('GET', '/business/public-link', { token: T })).json
    const info = (await (await s.app.request(`/public/book/${slug}`)).json()) as any
    const luis = info.staff.find((x: any) => x.id === b.id)
    expect(luis.name).toBe('Luis G.')
    expect(JSON.stringify(info)).not.toContain('Pérez')
    // Reserva y estado de la cita: tampoco el nombre completo ni el id interno de quien atiende.
    const r = await s.app.request(`/public/book/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serviceIds: [sv.id], staffId: b.id, date: '2026-11-18', time: '16:00', name: 'Joel Z', phone: '9632369624' }) })
    const booked = (await r.json()) as any
    expect(booked.appointment.staffName).toBe('Luis G.')
    expect(booked.appointment.staffId).toBeUndefined()
    const st = (await (await s.app.request(`/public/appointments/${booked.token}`)).json()) as any
    expect(JSON.stringify(st)).not.toContain('Pérez')
  })

  it('la página pública usa la identidad del negocio (su giro) y no expone su id interno', async () => {
    const { s, T } = await barberia()
    const { slug } = (await s.call('GET', '/business/public-link', { token: T })).json
    const info = (await (await s.app.request(`/public/book/${slug}`)).json()) as any
    expect(info.business).toEqual({ name: 'Fénix Barbería', phone: expect.anything(), giro: 'barberia' })
    const { productOf } = await import('../web/src/products/index.js')
    expect(productOf(info.business.giro).id).toBe('barber')
  })

})
