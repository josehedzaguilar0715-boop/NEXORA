import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dosSucursales } from './sucursales-fixture.js'

/** Los tres puestos (dueño, encargado, empleado) se controlan en el SERVIDOR: aquí se prueba con peticiones directas, sin pantallas. */

const rutasGet = () => {
  const r = new Set<string>()
  for (const file of readdirSync('src').filter((x) => x.endsWith('.ts') && !['admin.ts', 'assets.gen.ts'].includes(x)))
    for (const m of readFileSync(`src/${file}`, 'utf8').matchAll(/\.get\('(\/[^':]*)'/g)) r.add(m[1]!)
  return [...r].filter((x) => !x.startsWith('/public/') && !x.startsWith('/admin') && x !== '/health')
}
const fugas = async (f: Awaited<ReturnType<typeof dosSucursales>>, token: string, marcas: Record<string, string>) => {
  const out: string[] = []
  for (const r of rutasGet()) {
    const body = await (await f.s.app.request(r, { headers: { authorization: `Bearer ${token}` } })).text()
    for (const [k, v] of Object.entries(marcas)) if (v && body.includes(v)) out.push(`${r} ← ${k}`)
  }
  return out
}

describe('puestos: encargado de la sucursal 2 no ve ni modifica la sucursal 1', () => {
  it('ninguna lista ni reporte de la sucursal 2 contiene datos de la sucursal 1', async () => {
    const f = await dosSucursales()
    const suc1 = { turno1a: f.shift1a.id, turno1b: f.shift1b.id, venta1a: f.sale1a.id, venta1b: f.sale1b.id, compra1: f.purchase1.id, gasto1: f.exp1.id, textoGasto1: 'Luz sucursal 1', enc1: f.enc1.id, emp1a: f.e1a.id, emp1b: f.e1b.id }
    expect(await fugas(f, f.enc2.token, suc1)).toEqual([])
    expect(await fugas(f, f.e2.token, suc1)).toEqual([])
  })

  it('no puede leer ni cambiar registros de la sucursal 1 por identificador', async () => {
    const f = await dosSucursales()
    const t = f.enc2.token
    for (const p of [`/sales/${f.sale1a.id}`, `/shifts/${f.shift1a.id}`, `/purchases/${f.purchase1.id}`, `/users/${f.e1a.id}`, `/sales?shiftId=${f.shift1a.id}`]) {
      const r = await f.s.call('GET', p, { token: t })
      expect(r.status, p).toBe(403)
      expect(r.json.error.code).toBe('otra_sucursal')
    }
    const mod = [
      await f.call(t, 'POST', `/sales/${f.sale1a.id}/cancel`, { reason: 'x', authCode: '4321' }),
      await f.call(t, 'POST', `/shifts/${f.shift1a.id}/close`, { countedCash: 0 }),
      await f.call(t, 'PATCH', `/users/${f.e1a.id}`, { name: 'Hackeado' }),
      await f.call(t, 'POST', `/users/${f.e1a.id}/reset-password`, { newPassword: 'NuevaClave123' }),
    ]
    for (const r of mod) expect([403, 404]).toContain(r.status)
    expect(mod.filter((r) => r.status === 403).length).toBeGreaterThan(2)
    // Nada cambió en la sucursal 1.
    const v = f.s.db.prepare('SELECT status FROM sales WHERE id = ?').get(f.sale1a.id) as { status: string }
    expect(v.status).not.toBe('cancelada')
    expect((f.s.db.prepare('SELECT status FROM shifts WHERE id = ?').get(f.shift1a.id) as { status: string }).status).toBe('abierto')
  })

  it('no puede crear datos en la sucursal 1 ni mover existencias entre sucursales', async () => {
    const f = await dosSucursales()
    const t = f.enc2.token
    expect((await f.call(t, 'POST', '/expenses', { branchId: f.b1, concept: 'Intruso', amount: 100, kind: 'variable', method: 'efectivo' })).status).toBe(403)
    expect((await f.call(t, 'POST', '/purchases', { branchId: f.b1, payment: 'contado', items: [{ productId: f.prod.id, quantity: 1, cost: 100 }] })).status).toBe(403)
    expect((await f.call(t, 'POST', '/inventory/transfers', { fromBranchId: f.b1, toBranchId: f.b2, items: [{ productId: f.prod.id, quantity: 1 }] })).status).toBe(403)
    expect((await f.call(t, 'POST', '/users', { username: 'colado', name: 'Colado', password: 'Clave12345', template: 'cajero', branchId: f.b1 })).status).toBe(403)
    expect(f.s.db.prepare("SELECT COUNT(*) n FROM expenses WHERE concept = 'Intruso'").get()).toEqual({ n: 0 })
  })

  it('sus totales son solo los de su sucursal', async () => {
    const f = await dosSucursales()
    // Los totales financieros ya no son del encargado (opción B): lo suyo es supervisar las ventas de su sucursal.
    expect((await f.s.call('GET', '/reports/summary', { token: f.enc2.token })).status).toBe(403)
    const toda = (await f.s.call('GET', '/reports/summary', { token: f.T })).json
    const suc2 = (await f.s.call('GET', `/reports/summary?branchId=${f.b2}`, { token: f.T })).json
    expect(JSON.stringify(suc2)).not.toBe(JSON.stringify(toda))
    const ventas = (await f.s.call('GET', '/sales', { token: f.enc2.token })).json.sales as { id: string }[]
    expect(ventas.map((x) => x.id)).toEqual([f.sale2.id])
    // El dueño le autoriza administrar personal: ve y edita solo el de su sucursal.
    await f.call(f.T, 'PATCH', `/users/${f.enc2.id}`, { permissions: ['sell', 'open_close_cash', 'cancel_discount', 'view_reports', 'create_employees'] })
    const equipo = (await f.s.call('GET', '/users', { token: f.enc2.token })).json.users as { id: string }[]
    expect(equipo.map((x) => x.id).sort()).toEqual([f.enc2.id, f.e2.id].sort())
  })
})

describe('puestos: un empleado solo ve lo propio', () => {
  it('no consulta las operaciones privadas de otro empleado de su misma sucursal', async () => {
    const f = await dosSucursales()
    const t = f.e1b.token
    expect(await fugas(f, t, { turno1a: f.shift1a.id, venta1a: f.sale1a.id })).toEqual([])
    for (const p of [`/sales/${f.sale1a.id}`, `/shifts/${f.shift1a.id}`, `/sales?cashierId=${f.e1a.id}`, `/sales?shiftId=${f.shift1a.id}`]) {
      const r = await f.s.call('GET', p, { token: t })
      expect(r.status, p).toBe(403)
      expect(r.json.error.code).toBe('no_es_tuyo')
    }
    const lista = (await f.s.call('GET', '/sales', { token: t })).json.sales as { id: string }[]
    expect(lista.map((x) => x.id)).toEqual([f.sale1b.id])
    // Tampoco puede anular ni cerrar lo de otro.
    expect((await f.call(t, 'POST', `/shifts/${f.shift1a.id}/close`, { countedCash: 0 })).status).toBe(403)
    expect([403, 404]).toContain((await f.call(t, 'POST', `/sales/${f.sale1a.id}/cancel`, { reason: 'x' })).status)
  })

  it('sí ve y trabaja con lo suyo', async () => {
    const f = await dosSucursales()
    const mia = await f.s.call('GET', `/sales/${f.sale1b.id}`, { token: f.e1b.token })
    expect(mia.status).toBe(200)
    expect((await f.s.call('GET', '/shifts/current', { token: f.e1b.token })).json.shift.id).toBe(f.shift1b.id)
    expect((await f.s.call('GET', '/sales?cashierId=' + f.e1b.id, { token: f.e1b.token })).status).toBe(200)
  })

  it('no administra inventario, caja general, usuarios ni reportes generales', async () => {
    const f = await dosSucursales()
    const t = f.e1b.token
    for (const [m, p, b] of [
      ['GET', '/reports/summary'], ['GET', '/reports/daily'], ['GET', '/dashboard/panel'], ['GET', '/accounting/balance'], ['GET', '/expenses'], ['GET', '/payables'],
      ['POST', '/products', { name: 'Nuevo', unit: 'pieza', price: 100 }], ['POST', '/purchases', { payment: 'contado', items: [{ productId: f.prod.id, quantity: 1, cost: 100 }] }],
      ['POST', '/users', { username: 'otro', name: 'Otro', password: 'Clave12345', template: 'cajero' }], ['PATCH', `/users/${f.e1a.id}`, { name: 'x' }],
      ['POST', '/expenses', { concept: 'x', amount: 100, kind: 'variable', method: 'efectivo' }],
    ] as [string, string, object?][]) {
      const r = await f.call(t, m, p, b)
      expect(r.status, `${m} ${p}`).toBe(403)
    }
  })

  it('con «ver reportes» autorizado por el dueño sí ve a sus compañeros de sucursal, pero nunca a los de otra', async () => {
    const f = await dosSucursales()
    await f.call(f.T, 'PATCH', `/users/${f.e1b.id}`, { permissions: ['sell', 'open_close_cash', 'view_reports'] })
    expect((await f.s.call('GET', `/sales/${f.sale1a.id}`, { token: f.e1b.token })).status).toBe(200)
    expect((await f.s.call('GET', `/sales/${f.sale2.id}`, { token: f.e1b.token })).status).toBe(403)
    expect((await fugas(f, f.e1b.token, { venta2: f.sale2.id, turno2: f.shift2.id, gasto2: 'Luz sucursal 2' }))).toEqual([])
  })
})

describe('puestos: no se salta el control cambiando branchId ni identificadores', () => {
  it('branchId, fromBranch, toBranch y los identificadores manipulados se rechazan en consulta y en cuerpo', async () => {
    const f = await dosSucursales()
    for (const u of [f.enc2, f.e2]) {
      for (const p of [`/reports/summary?branchId=${f.b1}`, `/sales?branchId=${f.b1}`, `/expenses?branchId=${f.b1}`, `/reports/board?branchId=${f.b1}`, `/dashboard/panel?branchId=${f.b1}`, `/reports/daily?branchId=${f.b1}`]) {
        const r = await f.s.call('GET', p, { token: u.token })
        expect(r.status, `${u.id} ${p}`).toBe(403)
      }
      const cuerpo = await f.call(u.token, 'POST', '/shifts/open', { openingFloat: 100, branchId: f.b1 })
      expect(cuerpo.status).toBe(403)
    }
    // Un identificador de la sucursal 1 puesto en cualquier parte de la petición.
    expect((await f.call(f.enc2.token, 'POST', '/sales', { id: f.s.uuid(), paymentMethod: 'efectivo', shiftId: f.shift1a.id, items: [{ productId: f.prod.id, quantity: 1 }] })).status).toBe(403)
    expect((await f.s.call('GET', `/reports/board?cashierId=${f.e1a.id}`, { token: f.enc2.token })).status).toBe(403)
    // Un empleado no puede elegir a otra persona como filtro, ni por su identificador ni cambiando el número.
    expect((await f.s.call('GET', `/reports/board?cashierId=${f.e1a.id}`, { token: f.e1b.token })).status).toBe(403)
    expect((await f.s.call('GET', `/sales/${f.sale1a.id.toUpperCase()}`, { token: f.e1b.token })).status).not.toBe(200)
    // Su propia sucursal, escrita a mano, sí se acepta.
    expect((await f.s.call('GET', `/sales?branchId=${f.b2}`, { token: f.enc2.token })).status).toBe(200)
  })

  it('la sucursal del usuario sale de su cuenta, no de lo que mande el navegador', async () => {
    const f = await dosSucursales()
    const venta = await f.call(f.e2.token, 'POST', '/sales', { id: f.s.uuid(), paymentMethod: 'efectivo', items: [{ productId: f.prod.id, quantity: 1 }], branchId: f.b2 })
    expect(venta.status).toBe(201)
    const fila = f.s.db.prepare('SELECT branch_id FROM sales WHERE id = ?').get(venta.json.sale.id) as { branch_id: string }
    expect(fila.branch_id).toBe(f.b2)
    // Un encargado no puede subirse el puesto ni cambiar su sucursal.
    expect((await f.call(f.enc2.token, 'PATCH', `/users/${f.enc2.id}`, { branchId: f.b1 })).status).toBeGreaterThanOrEqual(403)
    expect((await f.call(f.enc2.token, 'POST', '/users', { username: 'jefe2', name: 'Jefe', password: 'Clave12345', template: 'encargado' })).status).toBe(403)
    const yo = (await f.s.call('GET', '/auth/me', { token: f.enc2.token })).json.user
    expect(yo.branchId).toBe(f.b2)
    expect(yo.position).toBe('encargado')
  })
})

describe('puestos: el dueño ve y administra todas las sucursales', () => {
  it('lee ventas, turnos, compras, gastos y personal de ambas, y puede filtrar por sucursal', async () => {
    const f = await dosSucursales()
    const T = f.T
    const ids = ((await f.s.call('GET', '/sales', { token: T })).json.sales as { id: string }[]).map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining([f.sale1a.id, f.sale1b.id, f.sale2.id]))
    expect(((await f.s.call('GET', `/sales?branchId=${f.b2}`, { token: T })).json.sales as { id: string }[]).map((x) => x.id)).toEqual([f.sale2.id])
    for (const p of [`/sales/${f.sale1a.id}`, `/sales/${f.sale2.id}`, `/shifts/${f.shift1a.id}`, `/shifts/${f.shift2.id}`, '/expenses', '/purchases', '/reports/board', '/accounting/balance', '/branches']) expect((await f.s.call('GET', p, { token: T })).status, p).toBe(200)
    const gastos = JSON.stringify((await f.s.call('GET', '/expenses', { token: T })).json)
    expect(gastos).toContain('Luz sucursal 1'); expect(gastos).toContain('Luz sucursal 2')
    const equipo = (await f.s.call('GET', '/users', { token: T })).json.users as { id: string }[]
    expect(equipo.map((x) => x.id)).toEqual(expect.arrayContaining([f.enc1.id, f.enc2.id, f.e1a.id, f.e1b.id, f.e2.id]))
  })

  it('administra las dos: crea personal, gastos, compras y traspasos en cualquiera', async () => {
    const f = await dosSucursales()
    const T = f.T
    expect((await f.call(T, 'POST', '/expenses', { branchId: f.b2, concept: 'Agua', amount: 300, kind: 'variable', method: 'efectivo' })).status).toBe(201)
    expect((await f.call(T, 'POST', '/purchases', { branchId: f.b2, payment: 'contado', items: [{ productId: f.prod.id, quantity: 2, cost: 2000 }] })).status).toBe(201)
    expect((await f.call(T, 'PATCH', `/users/${f.e2.id}`, { name: 'Renombrada' })).status).toBe(200)
    expect((await f.call(T, 'POST', `/users/${f.e1a.id}/reset-password`, { newPassword: 'OtraClave1234' })).status).toBe(200)
    const tr = await f.call(T, 'POST', '/inventory/transfers', { fromBranchId: f.b1, toBranchId: f.b2, items: [{ productId: f.prod.id, quantity: 1 }] })
    expect(tr.status).toBe(201)
    // Cierra el turno de un empleado y anula una venta en la sucursal 2.
    const anul = await f.call(T, 'POST', `/sales/${f.sale2.id}/cancel`, { reason: 'prueba del dueño', authCode: '4321' })
    expect(anul.status, JSON.stringify(anul.json)).toBe(200)
  })

  it('puede dar el puesto de encargado o empleado; un encargado solo crea empleados de su sucursal', async () => {
    const f = await dosSucursales()
    const nuevo = await f.call(f.T, 'POST', '/users', { username: 'jefa3', name: 'Jefa', password: 'Clave12345', position: 'encargado', template: 'encargado', branchId: f.b2 })
    expect(nuevo.status).toBe(201)
    expect(nuevo.json.user.position).toBe('encargado')
    await f.call(f.T, 'PATCH', `/users/${f.enc2.id}`, { permissions: ['sell', 'open_close_cash', 'customers_credit', 'cancel_discount', 'view_reports', 'create_employees'] })
    const emp = await f.call(f.enc2.token, 'POST', '/users', { username: 'nuevo2', name: 'Nuevo', password: 'Clave12345', template: 'cajero' })
    expect(emp.status).toBe(201)
    expect(emp.json.user.position).toBe('empleado')
    expect(emp.json.user.branchId).toBe(f.b2)
  })
})

describe('puestos: «Mi día» del empleado', () => {
  it('muestra solo sus ventas y su caja, aunque no tenga «ver reportes»', async () => {
    const f = await dosSucursales()
    const a = (await f.s.call('GET', '/dashboard/mine', { token: f.e1a.token })).json
    const b = (await f.s.call('GET', '/dashboard/mine', { token: f.e1b.token })).json
    expect(a.total).toBe(6000); expect(b.total).toBe(9000)
    expect(JSON.stringify(a)).not.toContain(f.sale1b.id)
    expect(a.shift.id).toBe(f.shift1a.id)
  })
})

describe('puestos: usuarios que ya existían (sin puesto guardado) conservan su comportamiento', () => {
  it('sin puesto: con «cancelar/descuento» es encargado; si no, empleado', async () => {
    const f = await dosSucursales()
    f.s.db.prepare('UPDATE users SET position = NULL').run()
    expect((await f.s.call('GET', '/auth/me', { token: f.enc2.token })).json.user.position).toBe('encargado')
    expect((await f.s.call('GET', '/auth/me', { token: f.e2.token })).json.user.position).toBe('empleado')
    expect((await f.s.call('GET', `/sales/${f.sale1a.id}`, { token: f.enc2.token })).status).toBe(403)
    expect((await f.s.call('GET', `/sales/${f.sale1a.id}`, { token: f.e1b.token })).status).toBe(403)
  })
})
