import { describe, expect, it } from 'vitest'
import { dosSucursales } from './sucursales-fixture.js'

/** Acceso financiero: dueño y administrador autorizado; el empleado nunca; el encargado actual no cambia. */
const FINANZAS = ['/dashboard/panel', '/reports/summary', '/reports/daily?days=7', '/reports/recent?limit=8', '/expenses', '/finance/trend', '/inventory/value', '/audit', '/accounting/income-statement', '/accounting/balance']
const get = async (f: Awaited<ReturnType<typeof dosSucursales>>, tok: string, p: string) => (await f.s.app.request(p, { headers: { authorization: `Bearer ${tok}` } })).status

describe('acceso a finanzas por puesto', () => {
  it('un empleado con «ver reportes» marcado NO ve dashboard ni finanzas (servidor)', async () => {
    const f = await dosSucursales()
    expect((await f.s.call('PATCH', `/users/${f.e1a.id}`, { token: f.T, body: { position: 'empleado', permissions: ['sell', 'view_reports'] } })).status).toBe(200)
    for (const p of FINANZAS) expect(await get(f, f.e1a.token, p), p).toBe(403)
    // …pero conserva lo que ya tenía: ver las ventas de sus compañeros.
    expect(await get(f, f.e1a.token, '/sales')).toBe(200)
  })
  it('no se le pueden dar funciones de finanzas a un empleado ni a un encargado', async () => {
    const f = await dosSucursales()
    for (const id of [f.e1a.id, f.enc1.id]) {
      const r = await f.s.call('PATCH', `/users/${id}`, { token: f.T, body: { permissions: ['sell', 'view_finance'] } })
      expect(r.status).toBe(400)
    }
  })
  it('el encargado actual conserva su acceso (sin cambios)', async () => {
    const f = await dosSucursales()
    expect(await get(f, f.enc1.token, '/dashboard/panel')).toBe(200)
    expect(await get(f, f.enc1.token, '/expenses')).toBe(200)
  })
  it('el administrador autorizado nace sin funciones y el dueño se las marca una por una', async () => {
    const f = await dosSucursales()
    const a = await f.s.createStaff(f.T, f.o.business.code, 'admin1', 'administrador')
    expect(a.token).toBeTruthy()
    const me = await f.s.call('GET', '/auth/me', { token: a.token })
    expect(me.json.user.position).toBe('administrador')
    expect(me.json.access).toEqual({ dashboard: false, finance: false, manage: false, costs: false })
    for (const p of FINANZAS) expect(await get(f, a.token, p), p).toBe(403)
    // Solo el panel general.
    await f.s.call('PATCH', `/users/${a.id}`, { token: f.T, body: { permissions: ['view_dashboard'] } })
    expect(await get(f, a.token, '/dashboard/panel')).toBe(200)
    expect(await get(f, a.token, '/reports/summary')).toBe(200)
    expect(await get(f, a.token, '/expenses')).toBe(403)
    expect(await get(f, a.token, '/accounting/balance')).toBe(403)
    // Y ahora las finanzas.
    await f.s.call('PATCH', `/users/${a.id}`, { token: f.T, body: { permissions: ['view_dashboard', 'view_finance'] } })
    expect(await get(f, a.token, '/expenses')).toBe(200)
    expect(await get(f, a.token, '/accounting/balance')).toBe(200)
    // Ve todo el negocio (no solo una sucursal).
    const r = await f.s.app.request('/reports/summary?branchId=' + f.b2, { headers: { authorization: `Bearer ${a.token}` } })
    expect(r.status).toBe(200)
  })
  it('un administrador no crea administradores ni toca al dueño; solo el dueño nombra administradores', async () => {
    const f = await dosSucursales()
    const a = await f.s.createStaff(f.T, f.o.business.code, 'admin2', 'administrador')
    await f.s.call('PATCH', `/users/${a.id}`, { token: f.T, body: { permissions: ['create_employees', 'view_finance'] } })
    const r = await f.s.call('POST', '/users', { token: a.token, body: { name: 'otro', username: 'otroadmin', password: 'inicial123', template: 'administrador' } })
    expect(r.status).toBe(403)
    expect((await f.s.call('PATCH', `/users/${a.id}`, { token: a.token, body: { permissions: ['create_employees', 'view_finance', 'manage_finance'] } })).status).toBe(403)
  })
  it('costos y totales: el empleado no los recibe, el dueño sí', async () => {
    const f = await dosSucursales()
    const dueno = (await f.s.call('GET', '/products', { token: f.T })).json.products[0]
    expect(dueno).toHaveProperty('lastCost')
    const emp = (await f.s.call('GET', '/products', { token: f.e1a.token })).json.products[0]
    expect(emp).not.toHaveProperty('lastCost')
    expect(emp).not.toHaveProperty('marginBp')
    expect(emp).not.toHaveProperty('suggestedPrice')
    expect((await f.s.call('GET', '/receivables', { token: f.T })).json).toHaveProperty('total')
    expect((await f.s.call('GET', '/receivables', { token: f.e1a.token })).json).not.toHaveProperty('total')
  })
})
