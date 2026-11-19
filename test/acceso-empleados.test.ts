import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('acceso de empleados sin código del negocio', () => {
  it('entra con usuario y contraseña; el usuario no se repite entre negocios', async () => {
    const { s, T } = await negocioListo()
    expect((await s.call('POST', '/users', { token: T, body: { name: 'Manuel', username: 'manuel', password: 'inicial123', template: 'cajero' } })).status).toBe(201)
    const login = await s.call('POST', '/auth/login', { body: { username: 'Manuel', password: 'inicial123' } })
    expect(login.json.token).toBeTruthy()
    expect((await s.call('POST', '/auth/login', { body: { username: 'manuel', password: 'mala12345' } })).status).toBe(401)
    // Otro negocio no puede usar el mismo usuario y recibe una sugerencia.
    const o2 = await s.registerOwner('5598887777')
    const dup = await s.call('POST', '/users', { token: o2.token, body: { name: 'Manuel', username: 'manuel', password: 'inicial123', template: 'cajero' } })
    expect(dup.json.error.code).toBe('usuario_repetido')
    expect(dup.json.error.message).toContain('manuel.')
  })

  it('usuarios repetidos de antes: entra el que tenga esa contraseña', async () => {
    const { s, T } = await negocioListo()
    await s.call('POST', '/users', { token: T, body: { name: 'Ana', username: 'ana', password: 'primera123', template: 'cajero' } })
    const o2 = await s.registerOwner('5598886666')
    // Simula un usuario repetido creado antes de la regla.
    const other = (await s.call('POST', '/users', { token: o2.token, body: { name: 'Ana 2', username: 'ana2', password: 'segunda123', template: 'cajero' } })).json.user
    s.db.prepare("UPDATE users SET username = 'ana' WHERE id = ?").run(other.id)
    const a = await s.call('POST', '/auth/login', { body: { username: 'ana', password: 'segunda123' } })
    const me = (await s.call('GET', '/auth/me', { token: a.json.token })).json
    expect(me.user.name).toBe('Ana 2')
    const b = await s.call('POST', '/auth/login', { body: { username: 'ana', password: 'primera123' } })
    expect((await s.call('GET', '/auth/me', { token: b.json.token })).json.user.name).toBe('Ana')
  })
})
