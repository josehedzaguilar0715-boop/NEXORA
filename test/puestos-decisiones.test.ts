import { describe, expect, it } from 'vitest'
import { dosSucursales } from './sucursales-fixture.js'

describe('decisiones de permisos: clientes y fiado compartidos, historial por sucursal', () => {
  it('un cliente con deuda se ve y se abona desde las dos sucursales sin duplicar, y cada movimiento dice su sucursal', async () => {
    const f = await dosSucursales()
    const cid = f.customer.id
    const cargo = await f.call(f.T, 'POST', `/customers/${cid}/credit-charges`, { id: f.s.uuid(), amount: 10000, note: 'Deuda anterior' })
    expect(cargo.status).toBe(201)
    // El mismo cargo reenviado (misma id) no duplica la deuda.
    const idRep = f.s.uuid()
    await f.call(f.T, 'POST', `/customers/${cid}/credit-charges`, { id: idRep, amount: 5000, note: 'Otra deuda' })
    expect((await f.call(f.T, 'POST', `/customers/${cid}/credit-charges`, { id: idRep, amount: 5000, note: 'Otra deuda' })).json.duplicate).toBe(true)
    expect((await f.s.call('GET', `/customers/${cid}/credit`, { token: f.e1a.token })).json.balance).toBe(15000)
    expect((await f.s.call('GET', `/customers/${cid}/credit`, { token: f.e2.token })).json.balance).toBe(15000) // saldo compartido
    // Abonos desde cada sucursal (cada uno en su caja).
    const a1 = await f.call(f.e1a.token, 'POST', `/customers/${cid}/credit-payments`, { id: f.s.uuid(), amount: 2000, method: 'efectivo' })
    const idAb = f.s.uuid()
    const a2 = await f.call(f.e2.token, 'POST', `/customers/${cid}/credit-payments`, { id: idAb, amount: 3000, method: 'efectivo' })
    expect([a1.status, a2.status]).toEqual([201, 201])
    expect((await f.call(f.e2.token, 'POST', `/customers/${cid}/credit-payments`, { id: idAb, amount: 3000, method: 'efectivo' })).json.duplicate).toBe(true)
    const cred = (await f.s.call('GET', `/customers/${cid}/credit`, { token: f.T })).json
    expect(cred.balance).toBe(10000)
    const abonos = cred.ledger.filter((l: any) => l.kind === 'abono')
    expect(abonos.map((l: any) => l.branchId).sort()).toEqual([f.b1, f.b2].sort())
    expect(abonos.every((l: any) => l.createdBy)).toBe(true) // auditable: quién lo hizo
    // El empleado de la otra sucursal no puede anular el abono de la sucursal 1.
    const ab1 = abonos.find((l: any) => l.branchId === f.b1)
    const anul = await f.call(f.e2.token, 'POST', `/credit-ledger/${ab1.id}/void`, { reason: 'intento' })
    expect([403, 404]).toContain(anul.status)
    expect((await f.s.call('GET', `/customers/${cid}/credit`, { token: f.T })).json.balance).toBe(10000)
  })

  it('las ventas indican su sucursal', async () => {
    const f = await dosSucursales()
    expect((await f.s.call('GET', `/sales/${f.sale2.id}`, { token: f.T })).json.sale.branchId).toBe(f.b2)
    expect((await f.s.call('GET', `/sales/${f.sale1a.id}`, { token: f.T })).json.sale.branchId).toBe(f.b1)
  })
})

describe('decisiones de permisos: permisos antiguos no amplían el alcance', () => {
  it('un empleado anterior con «ver reportes» guardado no ve reportes ni ventas de compañeros hasta que el dueño lo autorice', async () => {
    const f = await dosSucursales()
    // Simula un usuario anterior al sistema de puestos: sin puesto guardado y con el permiso viejo.
    f.s.db.prepare("UPDATE users SET position = NULL, permissions = ? WHERE id = ?").run(JSON.stringify(['sell', 'open_close_cash', 'view_reports']), f.e1b.id)
    expect((await f.s.call('GET', '/reports/summary', { token: f.e1b.token })).status).toBe(403)
    expect((await f.s.call('GET', `/sales/${f.sale1a.id}`, { token: f.e1b.token })).status).toBe(403)
    expect(JSON.parse(JSON.stringify((await f.s.call('GET', '/sales', { token: f.e1b.token })).json.sales)).map((x: any) => x.id)).toEqual([f.sale1b.id])
    // El dueño lo autoriza expresamente: ahora sí, y queda registrado su puesto.
    expect((await f.call(f.T, 'PATCH', `/users/${f.e1b.id}`, { permissions: ['sell', 'open_close_cash', 'view_reports'] })).status).toBe(200)
    expect((f.s.db.prepare('SELECT position FROM users WHERE id = ?').get(f.e1b.id) as any).position).toBe('empleado')
    expect((await f.s.call('GET', '/reports/summary', { token: f.e1b.token })).status).toBe(200)
    // …pero nunca de otra sucursal.
    expect((await f.s.call('GET', `/sales/${f.sale2.id}`, { token: f.e1b.token })).status).toBe(403)
  })

  it('un encargado anterior (sin puesto) conserva su alcance de sucursal y no se amplía', async () => {
    const f = await dosSucursales()
    f.s.db.prepare('UPDATE users SET position = NULL').run()
    expect((await f.s.call('GET', '/reports/summary', { token: f.enc2.token })).status).toBe(200)
    expect((await f.s.call('GET', `/reports/summary?branchId=${f.b1}`, { token: f.enc2.token })).status).toBe(403)
  })
})

describe('decisiones de permisos: nombres de compañeros, traspasos y contabilidad', () => {
  it('el empleado ve solo id y nombre de compañeros de su sucursal para identificar quién atendió', async () => {
    const f = await dosSucursales()
    const r = (await f.s.call('GET', '/staff/sellers', { token: f.e1b.token })).json.staff as Record<string, unknown>[]
    expect(r.map((x) => x.id).sort()).toEqual([f.enc1.id, f.e1a.id, f.e1b.id, f.owner.id].filter((id) => r.some((x) => x.id === id)).sort())
    expect(r.every((x) => Object.keys(x).sort().join() === 'id,name')).toBe(true)
    expect(r.some((x) => x.id === f.e2.id || x.id === f.enc2.id)).toBe(false)
  })

  it('traspasos y contabilidad consolidada son solo del dueño en negocios con varias sucursales', async () => {
    const f = await dosSucursales()
    for (const u of [f.enc1, f.enc2, f.e1a]) {
      expect((await f.call(u.token, 'POST', '/inventory/transfers', { fromBranchId: f.b1, toBranchId: f.b2, items: [{ productId: f.prod.id, quantity: 1 }] })).status).toBe(403)
      for (const p of ['/accounting/balance', '/accounting/income-statement', '/accounting/ledger', '/fixed-expenses']) expect((await f.s.call('GET', p, { token: u.token })).status, p).toBe(403)
    }
    for (const p of ['/accounting/balance', '/accounting/income-statement', '/fixed-expenses']) expect((await f.s.call('GET', p, { token: f.T })).status, p).toBe(200)
  })
})

describe('decisiones de permisos: la agenda se comparte dentro de cada sucursal, no entre sucursales', () => {
  it('compañeros de la misma sucursal ven las mismas citas; la otra sucursal no ve ninguna', async () => {
    const f = await dosSucursales()
    const hoy = new Date().toISOString().slice(0, 10)
    const cita = (branch: string, staff: string, nombre: string) => {
      const id = f.s.uuid()
      f.s.db.prepare("INSERT INTO appointments (id, business_id, branch_id, staff_id, customer_name, services, starts_at, ends_at, status, source, created_at) VALUES (?,?,?,?,?,'[]',?,?,'confirmada','mostrador',?)")
        .run(id, (f.s.db.prepare('SELECT business_id FROM users WHERE id = ?').get(staff) as any).business_id, branch, staff, nombre, `${hoy}T18:00:00.000Z`, `${hoy}T18:30:00.000Z`, new Date().toISOString())
      return id
    }
    cita(f.b1, f.e1a.id, 'Cita Sucursal Uno'); cita(f.b2, f.e2.id, 'Cita Sucursal Dos')
    const ver = async (tok: string) => JSON.stringify((await f.s.call('GET', `/agenda?date=${hoy}`, { token: tok })).json)
    for (const tok of [f.e1a.token, f.e1b.token, f.enc1.token]) { const t = await ver(tok); expect(t).toContain('Cita Sucursal Uno'); expect(t).not.toContain('Cita Sucursal Dos') }
    for (const tok of [f.e2.token, f.enc2.token]) { const t = await ver(tok); expect(t).toContain('Cita Sucursal Dos'); expect(t).not.toContain('Cita Sucursal Uno') }
    const dueno = await ver(f.T); expect(dueno).toContain('Cita Sucursal Uno'); expect(dueno).toContain('Cita Sucursal Dos')
  })
})
