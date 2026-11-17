import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

describe('cuentas y acceso', () => {
  it('registra al dueño con código por teléfono y entra', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const me = await s.call('GET', '/auth/me', { token: o.token })
    expect(me.json.user.role).toBe('owner')
    expect(me.json.permissions).toBe('todos')
  })

  it('el login del dueño exige segundo paso y rechaza código malo', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const l = await s.call('POST', '/auth/owner/login', { body: { phone: o.phone, password: o.password, deviceName: 'Tablet' } })
    expect(l.json.token).toBeUndefined()
    const bad = await s.call('POST', '/auth/owner/verify', { body: { challengeId: l.json.challengeId, code: '000000' } })
    expect(bad.status).toBe(400)
    const ok = await s.call('POST', '/auth/owner/verify', { body: { challengeId: l.json.challengeId, code: s.codes[o.phone] } })
    expect(ok.json.token).toBeTruthy()
    const ses = await s.call('GET', '/auth/sessions', { token: ok.json.token })
    expect(ses.json.sessions.some((x: any) => x.deviceName === 'Tablet')).toBe(true)
  })

  it('el código de verificación vence', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const l = await s.call('POST', '/auth/owner/login', { body: { phone: o.phone, password: o.password } })
    s.advance(11 * 60_000)
    const r = await s.call('POST', '/auth/owner/verify', { body: { challengeId: l.json.challengeId, code: s.codes[o.phone] } })
    expect(r.status).toBe(400)
  })

  it('bloquea tras 5 contraseñas malas y se libera con el tiempo', async () => {
    const s = setup()
    const o = await s.registerOwner()
    for (let i = 0; i < 5; i++) await s.call('POST', '/auth/owner/login', { body: { phone: o.phone, password: 'incorrecta1' } })
    const locked = await s.call('POST', '/auth/owner/login', { body: { phone: o.phone, password: o.password } })
    expect(locked.status).toBe(423)
    s.advance(16 * 60_000)
    const ok = await s.call('POST', '/auth/owner/login', { body: { phone: o.phone, password: o.password } })
    expect(ok.status).toBe(200)
  })

  it('empleado: entra con código de negocio y debe cambiar su contraseña', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const e = await s.createStaff(o.token, o.business.code, 'ana', 'cajero')
    const blocked = await s.call('GET', '/shifts/current', { token: e.token })
    expect(blocked.status).toBe(403)
    const ch = await s.call('POST', '/auth/change-password', { token: e.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
    expect(ch.status).toBe(200)
    expect((await s.call('GET', '/shifts/current', { token: e.token })).status).toBe(200)
  })

  it('el dueño puede desactivar el cambio obligatorio de contraseña', async () => {
    const s = setup()
    const o = await s.registerOwner()
    await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
    const e = await s.createStaff(o.token, o.business.code, 'luis', 'cajero')
    expect((await s.call('GET', '/shifts/current', { token: e.token })).status).toBe(200)
  })

  it('un permiso no asignado se rechaza y los datos están aislados por negocio', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const o2 = await s.registerOwner('5598765432')
    const e = await s.createStaff(o.token, o.business.code, 'pepe', 'empleado_piso', { })
    await s.call('POST', '/auth/change-password', { token: e.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
    expect((await s.call('GET', '/users', { token: e.token })).status).toBe(403)
    const list = await s.call('GET', '/users', { token: o2.token })
    expect(list.json.users).toHaveLength(1)
    const patch = await s.call('PATCH', `/users/${e.id}`, { token: o2.token, body: { active: false } })
    expect(patch.status).toBe(404)
  })

  it('el dueño restablece contraseña y cierra sesiones del empleado', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const e = await s.createStaff(o.token, o.business.code, 'rosa', 'cajero')
    await s.call('POST', `/users/${e.id}/reset-password`, { token: o.token, body: { newPassword: 'otraclave99' } })
    expect((await s.call('GET', '/auth/me', { token: e.token })).status).toBe(401)
    const l = await s.call('POST', '/auth/login', { body: { businessCode: o.business.code, username: 'rosa', password: 'otraclave99' } })
    expect(l.status).toBe(200)
  })
})
