import { describe, expect, it } from 'vitest'
import { applyPlan } from '../src/finanzas.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db-node.js'
import { negocioListo } from './helpers.js'

const item = (name: string, kind: string, mode: 'pct' | 'monto', value: number) => ({ name, kind, mode, value }) as any

describe('reparto: cálculo puro', () => {
  it('porcentajes que suman 100 cuadran al centavo (el redondeo no se pierde)', () => {
    const r = applyPlan(10_001, [item('A', 'operacion', 'pct', 33), item('B', 'retiro', 'pct', 33), item('C', 'ahorro', 'pct', 34)])
    expect(r.assigned).toBe(10_001)
    expect(r.ok).toBe(true)
  })
  it('montos fijos primero, el resto por porcentaje', () => {
    const r = applyPlan(100_000, [item('Renta', 'gastos', 'monto', 30_000), item('Dueño', 'retiro', 'pct', 50), item('Ahorro', 'ahorro', 'pct', 50)])
    expect(r.lines.map((l) => l.amount)).toEqual([30_000, 35_000, 35_000])
  })
  it('avisa cuando la suma no es 100 % o los montos no alcanzan; base negativa reparte 0', () => {
    expect(applyPlan(1000, [item('A', 'otro', 'pct', 60)]).notes[0]).toMatch(/Faltan 40/)
    expect(applyPlan(1000, [item('A', 'otro', 'pct', 70), item('B', 'otro', 'pct', 50)]).notes[0]).toMatch(/pasas por 20/)
    expect(applyPlan(1000, [item('A', 'otro', 'monto', 5000)]).ok).toBe(false)
    expect(applyPlan(-500, [item('A', 'otro', 'pct', 100)]).assigned).toBe(0)
  })
})

async function negocioConVentas() {
  const n = await negocioListo()
  const p = await n.product({ name: 'Refresco', unit: 'pieza', price: 2000 })
  await n.buy([{ productId: p.id, quantity: 10, cost: 10_000 }]) // $100 de contado: $10 cada una
  await n.open(10_000)
  await n.sell([{ productId: p.id, quantity: 10 }]) // $200 de venta
  return { ...n, p }
}

describe('Finanzas inteligentes (API)', () => {
  it('sin reparto activo no se impone nada en el resumen', async () => {
    const { s, T } = await negocioListo()
    expect((await s.call('GET', '/finanzas/resumen', { token: T })).json.plan).toBeNull()
    expect((await s.call('GET', '/finanzas/planes', { token: T })).json.plans).toEqual([])
  })

  it('el dueño crea su propio reparto: suma validada, activa uno, recalcula con datos reales', async () => {
    const { s, T } = await negocioConVentas()
    const mal = await s.call('POST', '/finanzas/planes', { token: T, body: { name: 'Mío', base: 'ganancia', items: [item('Operación', 'operacion', 'pct', 60), item('Yo', 'retiro', 'pct', 30)] } })
    expect(mal.status).toBe(400)
    expect(mal.json.error?.message ?? mal.json.message ?? JSON.stringify(mal.json)).toMatch(/suman 90/)
    const ok = await s.call('POST', '/finanzas/planes', { token: T, body: { name: 'Mío', base: 'ganancia', items: [item('Operación', 'operacion', 'pct', 60), item('Yo', 'retiro', 'pct', 25), item('Ahorro', 'ahorro', 'pct', 15)] } })
    expect(ok.status).toBe(201)
    const id = ok.json.plan.id
    expect((await s.call('POST', `/finanzas/planes/${id}/activar`, { token: T, body: {} })).status).toBe(200)
    const res = (await s.call('GET', '/finanzas/resumen', { token: T })).json
    expect(res.plan.name).toBe('Mío')
    expect(res.plan.assigned).toBe(res.plan.base)
    expect(res.gananciaReal).toBeGreaterThan(0)
    // Vista previa en vivo con otro reparto, sin guardar.
    const v = (await s.call('POST', '/finanzas/planes/vista', { token: T, body: { base: 'ventas', items: [item('Todo', 'otro', 'pct', 100)] } })).json
    expect(v.assigned).toBe(v.base)
  })

  it('el resumen distingue ventas, ganancia y dinero: entró, salió, disponible, por reservar y retirable', async () => {
    const { s, T } = await negocioConVentas()
    const r = (await s.call('GET', '/finanzas/resumen', { token: T })).json
    expect(r.vendido).toBe(20_000)
    expect(r.entro).toBe(20_000)
    expect(r.gananciaReal).toBe(10_000) // 10 × (2000 − 1000)
    expect(r.salio).toBe(10_000) // lo que se pagó al proveedor
    expect(r.disponible).toBe(10_000)
        expect(r.porReservar.partes.map((x: any) => x.key)).toEqual(['proveedores', 'personal', 'clientes', 'fijos', 'inventario'])
    expect(r.retirable).toBeLessThanOrEqual(Math.max(0, r.gananciaReal))
    expect(r.retirable).toBeLessThanOrEqual(r.libre)
    expect(r.sugerido.opcional).toBe(true)
  })

  it('cada retiro queda registrado con categoría, motivo y responsable; sacar más de lo conveniente pide confirmación', async () => {
    const { s, T } = await negocioConVentas()
    const antes = (await s.call('GET', '/finanzas/resumen', { token: T })).json
    const sinMotivo = await s.call('POST', '/finanzas/retiros', { token: T, body: { amount: 100, category: 'Sueldo', reason: '', method: 'efectivo' } })
    expect(sinMotivo.status).toBe(400)
    const grande = await s.call('POST', '/finanzas/retiros', { token: T, body: { amount: antes.retirable + 50_000, category: 'Sueldo', reason: 'Gasto personal', method: 'transferencia' } })
    expect(grande.status).toBe(409)
    expect(grande.json.code ?? grande.json.error?.code).toBe('excede_retirable')
    const ok = await s.call('POST', '/finanzas/retiros', { token: T, body: { amount: 1000, category: 'Sueldo', reason: 'Sueldo de la semana', method: 'efectivo' } })
    expect(ok.status).toBe(201)
    const lista = (await s.call('GET', '/finanzas/retiros', { token: T })).json
    expect(lista.withdrawals).toHaveLength(1)
    expect(lista.withdrawals[0]).toMatchObject({ amount: 1000, category: 'Sueldo', reason: 'Sueldo de la semana', method: 'efectivo' })
    expect(lista.withdrawals[0].responsible).toBeTruthy()
    // El efectivo salió de la caja abierta (el corte no marcará faltante) y se contó una sola vez.
    const despues = (await s.call('GET', '/finanzas/resumen', { token: T })).json
    expect(despues.disponible).toBe(antes.disponible - 1000)
    expect(despues.salio).toBe(antes.salio + 1000)
    expect(despues.retiradoPeriodo).toBe(1000)
    // Confirmando, se puede sacar de más y queda marcado.
    const forzado = await s.call('POST', '/finanzas/retiros', { token: T, body: { amount: antes.retirable + 50_000, category: 'Otro', reason: 'Imprevisto', method: 'transferencia', force: true } })
    expect(forzado.status).toBe(201)
    expect(forzado.json.withdrawal.exceeded).toBe(true)
  })

  it('permisos: empleado nunca; administrador solo lo que se le marcó; encargado actual puede ver pero no mover dinero', async () => {
    const { s, T, o } = await negocioConVentas()
    s.db.prepare("UPDATE businesses SET plan = 'profesional'").run()
    const emp = await s.createStaff(T, o.business.code, 'cajera', 'cajero', { permissions: ['sell', 'view_reports'] })
    const enc = await s.createStaff(T, o.business.code, 'encar', 'encargado')
    const adm = await s.createStaff(T, o.business.code, 'admin', 'administrador')
    const rutas: [string, string, object?][] = [['GET', '/finanzas/resumen'], ['GET', '/finanzas/planes'], ['GET', '/finanzas/retiros'], ['POST', '/finanzas/retiros', { amount: 100, category: 'Sueldo', reason: 'prueba', method: 'transferencia', force: true }], ['POST', '/finanzas/planes', { name: 'X', base: 'ganancia', items: [item('a', 'otro', 'pct', 100)] }]]
    for (const [m, p, b] of rutas) expect((await s.call(m, p, { token: emp.token, body: b })).status, `empleado ${m} ${p}`).toBe(403)
    for (const [m, p, b] of rutas) expect((await s.call(m, p, { token: adm.token, body: b })).status, `admin sin permisos ${m} ${p}`).toBe(403)
    await s.call('PATCH', `/users/${adm.id}`, { token: T, body: { permissions: ['view_finance'] } })
    expect((await s.call('GET', '/finanzas/resumen', { token: adm.token })).status).toBe(200)
    expect((await s.call('POST', '/finanzas/retiros', { token: adm.token, body: rutas[3]![2] })).status).toBe(403) // ver no es mover dinero
    await s.call('PATCH', `/users/${adm.id}`, { token: T, body: { permissions: ['view_finance', 'manage_finance'] } })
    expect((await s.call('POST', '/finanzas/retiros', { token: adm.token, body: rutas[3]![2] })).status).toBe(201)
    expect((await s.call('GET', '/finanzas/resumen', { token: enc.token })).status).toBe(200)
    expect((await s.call('POST', '/finanzas/retiros', { token: enc.token, body: rutas[3]![2] })).status).toBe(403)
  })
})

describe('migración 44: «Plan anterior»', () => {
  it('cada negocio existente conserva su regla (o la 50/30/20) como histórico inactivo y no pierde datos', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nx-mig44-')), 'v42.db')
    let db = openDb(file)
    const mk = (d: typeof db) => createApp({ db: d, now: () => new Date(), notifier: { sendCode: () => false, smsEnabled: false } })
    const call = async (a: ReturnType<typeof mk>, m: string, p: string, token?: string, body?: unknown) => {
      const r = await a.request(p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
      return { status: r.status, json: (await r.json()) as any }
    }
    let a = mk(db)
    const r1 = await call(a, 'POST', '/auth/register', undefined, { businessName: 'Con regla propia', ownerName: 'Ana', phone: '5598765432', password: 'secreto123' })
    await call(a, 'POST', '/auth/register', undefined, { businessName: 'Sin regla', ownerName: 'Beto', phone: '5598765433', password: 'secreto123' })
    const ids = db.prepare('SELECT id, name FROM businesses ORDER BY name').all() as { id: string; name: string }[]
    db.prepare("INSERT INTO business_settings (business_id, key, value) VALUES (?, 'budgetRule', ?)").run(ids.find((x) => x.name === 'Con regla propia')!.id, JSON.stringify({ ops: 40, owner: 40, savings: 20 }))
    const antes = { users: db.prepare('SELECT id, name, permissions FROM users ORDER BY id').all(), settings: db.prepare('SELECT * FROM business_settings ORDER BY business_id, key').all() }
    // Regresa la base a la versión 42 (sin las migraciones 43 y 44).
    db.exec('DELETE FROM _migrations WHERE version IN (43, 44); ALTER TABLE users DROP COLUMN admin_authorized; DROP TABLE owner_withdrawals; DROP TABLE distribution_plans;')
    ;(db as any).close?.()
    db = openDb(file)
    const plans = db.prepare('SELECT b.name bname, p.name, p.base, p.items, p.active, p.legacy FROM distribution_plans p JOIN businesses b ON b.id = p.business_id ORDER BY b.name').all() as any[]
    expect(plans).toHaveLength(2)
    expect(plans.every((p) => p.name === 'Plan anterior' && p.active === 0 && p.legacy === 1 && p.base === 'ganancia_bruta')).toBe(true)
    expect(JSON.parse(plans.find((p) => p.bname === 'Con regla propia').items).map((i: any) => i.value)).toEqual([40, 40, 20])
    expect(JSON.parse(plans.find((p) => p.bname === 'Sin regla').items).map((i: any) => i.value)).toEqual([50, 30, 20])
    // Nada existente cambió.
    expect(db.prepare('SELECT id, name, permissions FROM users ORDER BY id').all()).toEqual(antes.users)
    expect(db.prepare('SELECT * FROM business_settings ORDER BY business_id, key').all()).toEqual(antes.settings)
    expect((db.prepare("SELECT COUNT(*) n FROM users WHERE admin_authorized <> 0").get() as any).n).toBe(0)
    // Y la API los muestra como históricos.
    a = mk(db)
    const login = await call(a, 'POST', '/auth/login', undefined, { phone: '5598765432', password: 'secreto123' })
    const tok = (login.json.token ?? r1.json.token) as string
    const lista = await call(a, 'GET', '/finanzas/planes', tok)
    expect(lista.json.plans).toHaveLength(1)
    expect(lista.json.plans[0]).toMatchObject({ name: 'Plan anterior', legacy: true, active: false })
    // Se conserva como historia: no se borra ni se edita.
    expect((await call(a, 'DELETE', `/finanzas/planes/${lista.json.plans[0].id}`, tok)).status).toBe(409)
    expect((await call(a, 'PUT', `/finanzas/planes/${lista.json.plans[0].id}`, tok, { name: 'X', base: 'ganancia', items: [{ name: 'a', kind: 'otro', mode: 'pct', value: 100 }] })).status).toBe(409)
  })
})
