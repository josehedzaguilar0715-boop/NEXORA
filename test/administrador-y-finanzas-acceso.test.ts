import { describe, expect, it } from 'vitest'
import { dosSucursales } from './sucursales-fixture.js'

/** Acceso financiero: dueño y administrador autorizado; el empleado nunca; el encargado no (opción B). */
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
  it('el encargado NO ve panel ni finanzas (opción B), pero conserva sus funciones operativas y su puesto', async () => {
    const f = await dosSucursales()
    for (const p of FINANZAS) expect(await get(f, f.enc1.token, p), p).toBe(403)
    for (const p of ['/finanzas/resumen', '/finanzas/planes', '/finanzas/retiros', '/accounting/cash-flow', '/accounting/ledger', '/accounting/export?kind=ventas', '/fixed-expenses']) expect(await get(f, f.enc1.token, p), p).toBe(403)
    // Supervisión de su sucursal y operación: sin cambios.
    for (const p of ['/sales', '/products', '/shifts/current', '/customers', '/receivables', '/dashboard/mine']) expect(await get(f, f.enc1.token, p), p).toBe(200)
    // Su puesto y sus permisos no cambiaron.
    const u = (await f.s.call('GET', '/auth/me', { token: f.enc1.token })).json
    expect(u.user.position).toBe('encargado')
    expect(u.permissions).toContain('view_reports')
    expect(u.permissions).toContain('cancel_discount')
    expect(u.access).toEqual({ dashboard: false, finance: false, manage: false, costs: false }) // costos: permiso aparte, que el dueño da
    // Y los demás sí: dueño (todo) y administrador autorizado (lo marcado).
    for (const p of FINANZAS) expect(await get(f, f.T, p), `dueño ${p}`).toBe(200)
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

  it('costos y márgenes: permiso independiente que el dueño da a cada encargado (o a quien quiera), sin abrir finanzas', async () => {
    const f = await dosSucursales()
    const prod = async (tok: string) => (await f.s.call('GET', '/products', { token: tok })).json.products[0]
    const cats = async (tok: string) => (await f.s.call('GET', '/categories', { token: tok })).json.categories
    // Sin el permiso: el encargado vende e inventaría, pero no ve costos ni márgenes.
    expect(await prod(f.enc1.token)).not.toHaveProperty('lastCost')
    expect(await prod(f.enc1.token)).not.toHaveProperty('marginBp')
    // El dueño se lo da a ESTE encargado.
    const perms = (await f.s.call('GET', '/auth/me', { token: f.enc1.token })).json.permissions as string[]
    expect((await f.s.call('PATCH', `/users/${f.enc1.id}`, { token: f.T, body: { permissions: [...perms, 'view_costs'] } })).status).toBe(200)
    expect(await prod(f.enc1.token)).toHaveProperty('lastCost')
    expect((await f.s.call('GET', '/auth/me', { token: f.enc1.token })).json.access).toEqual({ dashboard: false, finance: false, manage: false, costs: true })
    // Sigue sin finanzas ni cambio de puesto.
    expect(await get(f, f.enc1.token, '/dashboard/panel')).toBe(403)
    expect(await get(f, f.enc1.token, '/finanzas/resumen')).toBe(403)
    expect((await f.s.call('GET', '/auth/me', { token: f.enc1.token })).json.user.position).toBe('encargado')
    // Otro encargado (sin el permiso) no lo ve.
    expect(await prod(f.enc2.token)).not.toHaveProperty('lastCost')
    // El permiso también puede darse a un empleado que compra, y se quita igual.
    expect((await f.s.call('PATCH', `/users/${f.e1a.id}`, { token: f.T, body: { permissions: ['sell', 'view_inventory', 'view_costs'] } })).status).toBe(200)
    expect(await prod(f.e1a.token)).toHaveProperty('lastCost')
    await f.s.call('PATCH', `/users/${f.enc1.id}`, { token: f.T, body: { permissions: perms } })
    expect(await prod(f.enc1.token)).not.toHaveProperty('lastCost')
    void cats
  })
})
