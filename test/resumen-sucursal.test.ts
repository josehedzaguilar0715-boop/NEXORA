import { describe, expect, it } from 'vitest'
import { dosSucursales } from './sucursales-fixture.js'

/** Resumen operativo para el encargado: ventas de su sucursal, sin nada financiero confidencial. */
describe('resumen operativo de sucursal', () => {
  it('el encargado ve solo su sucursal y no recibe utilidades, márgenes, costos ni retiros', async () => {
    const f = await dosSucursales()
    const r = (await f.s.call('GET', '/sucursal/resumen', { token: f.enc1.token })).json
    expect(r.branch.id).toBe(f.b1)
    // Sucursal 1: ventas de e1a ($60) y e1b; la sucursal 2 no se mezcla.
    const total1 = (f.s.db.prepare("SELECT COALESCE(SUM(total),0) t, COUNT(*) n FROM sales WHERE branch_id = ? AND status = 'completada'").get(f.b1) as { t: number; n: number })
    expect(r.today.sales).toBe(total1.t)
    expect(r.today.tickets).toBe(total1.n)
    expect(r.sold.length).toBeGreaterThan(0)
    const txt = JSON.stringify(r).toLowerCase()
    for (const k of ['profit', 'utilidad', 'margin', 'cost', 'costo', 'retiro', 'withdraw', 'ganancia']) expect(txt, k).not.toContain(k)
    // No puede ver otra sucursal ni siquiera pidiéndola.
    const otra = await f.s.call('GET', `/sucursal/resumen?branchId=${f.b2}`, { token: f.enc1.token })
    expect(otra.status).toBe(403)
  })
  it('el empleado no lo ve; el dueño ve el total del negocio o una sucursal', async () => {
    const f = await dosSucursales()
    expect((await f.s.call('GET', '/sucursal/resumen', { token: f.e1a.token })).status).toBe(403)
    const todo = (await f.s.call('GET', '/sucursal/resumen', { token: f.T })).json
    const s1 = (await f.s.call('GET', `/sucursal/resumen?branchId=${f.b1}`, { token: f.T })).json
    expect(todo.branch).toBeNull()
    expect(todo.today.sales).toBeGreaterThanOrEqual(s1.today.sales)
  })
  it('objetivo operativo: lo fija el dueño por sucursal y el encargado solo lo ve; comparaciones solo si hay datos', async () => {
    const f = await dosSucursales()
    expect((await f.s.call('GET', '/sucursal/resumen', { token: f.enc1.token })).json.goal).toBeNull()
    expect((await f.s.call('PUT', '/sucursal/meta', { token: f.enc1.token, body: { branchId: f.b1, amount: 100_000 } })).status).toBe(403)
    expect((await f.s.call('PUT', '/sucursal/meta', { token: f.T, body: { branchId: f.b1, amount: 100_000 } })).status).toBe(200)
    const r = (await f.s.call('GET', '/sucursal/resumen', { token: f.enc1.token })).json
    expect(r.goal).toMatchObject({ amount: 100_000 })
    expect(r.goal.pct).toBe(Math.round((r.today.sales / 100_000) * 100))
    // Sin actividad en días anteriores no se inventan comparaciones.
    expect(r.comparison.yesterday).toBeNull()
    expect(r.comparison.lastWeek).toBeNull()
    expect(r.comparison.avg7).toBeNull()
    // Con ventas ayer sí hay comparación.
    f.s.advance(86_400_000)
    f.s.longLived()
    const r2 = (await f.s.call('GET', '/sucursal/resumen', { token: f.enc1.token })).json
    expect(r2.comparison.yesterday).toMatchObject({ label: 'Ayer', sales: r.today.sales })
    expect(r2.today.tickets).toBe(0)
    expect(r2.notes.join(' ')).toContain('no hay ventas')
  })
})
