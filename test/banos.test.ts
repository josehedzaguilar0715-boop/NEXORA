import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function banos() {
  const n = await negocioListo()
  const { s, T } = n
  await s.call('PATCH', '/business', { token: T, body: { giro: 'banos' } })
  const svc = async (body: object) => (await s.call('POST', '/services', { token: T, body: { category: 'banos', ...body } })).json.service
  const sanitario = await svc({ name: 'Sanitario', price: 700 })
  const regadera = await svc({ name: 'Regadera', price: 3000 })
  const toalla = await svc({ name: 'Toalla', price: 1500 })
  const vapor = await svc({ name: 'Vapor (por tiempo)', price: 0, attrs: { timeRate: { blockMin: 30, blockPrice: 4000 } } })
  const papel = await n.product({ name: 'Rollo de papel', unit: 'pieza', price: 0, sellable: false })
  const jabon = await n.product({ name: 'Jabón líquido (L)', unit: 'litro', price: 0, sellable: false })
  await n.buy([{ productId: papel.id, quantity: 48, cost: 24000 }, { productId: jabon.id, quantity: 20, cost: 40000 }])
  return { ...n, sanitario, regadera, toalla, vapor, papel, jabon }
}

describe('baños públicos', () => {
  it('cobro al entrar: varias tarifas en una entrada, ticket con hora y conteo de accesos', async () => {
    const { s, T, open, sanitario, regadera, toalla } = await banos()
    await open(0)
    const e = await s.call('POST', '/baths/entry', { token: T, body: { services: [{ serviceId: regadera.id }, { serviceId: toalla.id }] } })
    expect(e.json.sale.total).toBe(4500)
    await s.call('POST', '/baths/entry', { token: T, body: { services: [{ serviceId: sanitario.id }] } })
    const t = await s.call('GET', `/sales/${e.json.sale.id}/ticket`, { token: T })
    expect(t.json.text).toMatch(/\d{1,2}:\d{2}/)
    const r = (await s.call('GET', '/reports/accesses', { token: T })).json
    expect(r.total).toBe(2)
    expect(r.byHour[9]).toBe(2) // 09:00 hora local
    expect(r.byService).toEqual({ Regadera: 1, Toalla: 1, Sanitario: 1 })
  })

  it('insumos de uso descontados por número de accesos con la referencia del dueño', async () => {
    const { s, T, open, sanitario, papel, stock } = await banos()
    await s.call('PUT', '/baths/access-supplies', { token: T, body: { items: [{ productId: papel.id, quantity: 0.025 }] } }) // 1 rollo cada 40 accesos
    await open(0)
    for (let i = 0; i < 80; i++) await s.call('POST', '/baths/entry', { token: T, body: { services: [{ serviceId: sanitario.id }] } })
    expect(await stock(papel.id)).toBe(46)
  })

  it('pase por semana con QR: valida vigencia, registra asistencia y cuenta el acceso; no reentra en la misma visita', async () => {
    const { s, T } = await banos()
    await s.call('PUT', '/modules', { token: T, body: { active: ['membresias', 'asistencia'] } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Trabajador del mercado' } })).json.customer
    const plan = (await s.call('POST', '/membership-plans', { token: T, body: { name: 'Pase semanal', kind: 'pase', usesPerPeriod: 1, period: 'semana', price: 15000 } })).json.id
    await s.call('POST', `/customers/${cli.id}/memberships`, { token: T, body: { planId: plan } })
    expect((await s.call('POST', '/baths/pass-entry', { token: T, body: { code: cli.code } })).status).toBe(201)
    expect((await s.call('POST', '/baths/pass-entry', { token: T, body: { code: cli.code } })).json.error.code).toBe('ya_registrado')
    s.advance(4 * 3600_000)
    expect((await s.call('POST', '/baths/pass-entry', { token: T, body: { code: cli.code } })).status).toBe(201)
    expect((await s.call('GET', '/visits', { token: T })).json.visits).toHaveLength(1) // asistencia: una por día
    expect((await s.call('GET', '/reports/accesses', { token: T })).json.byKind).toEqual({ pase: 2 })
    s.longLived()
    s.advance(8 * 86_400_000)
    expect((await s.call('POST', '/baths/pass-entry', { token: T, body: { code: cli.code } })).json.error.code).toBe('pase_no_vigente')
  })

  it('cobro por tiempo: activable por servicio, se cobra a la salida por bloques', async () => {
    const { s, T, open, vapor, toalla } = await banos()
    await open(0)
    const e = await s.call('POST', '/baths/entry', { token: T, body: { services: [{ serviceId: vapor.id }, { serviceId: toalla.id }] } })
    expect(e.json.sale.total).toBe(1500) // el vapor no se cobra al entrar
    s.advance(65 * 60_000)
    const x = await s.call('POST', `/baths/accesses/${e.json.accessId}/exit`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect(x.json).toMatchObject({ minutes: 65, blocks: 3 })
    expect(x.json.sale.total).toBe(12000)
    expect((await s.call('POST', `/baths/accesses/${e.json.accessId}/exit`, { token: T, body: {} })).json.error.code).toBe('ya_cobrado')
  })

  it('control de limpieza por turno: tareas, quién y a qué hora; interno', async () => {
    const { s, o, T, open } = await banos()
    const limpieza = await s.createStaff(T, o.business.code, 'limpieza1', 'empleado_piso')
    const task = (await s.call('POST', '/cleaning/tasks', { token: T, body: { name: 'Trapear sanitarios' } })).json.id
    await open(0)
    await s.call('POST', '/cleaning/log', { token: limpieza.token, body: { taskId: task } })
    const log = (await s.call('GET', '/cleaning/log', { token: T })).json.log
    expect(log[0]).toMatchObject({ task: 'Trapear sanitarios', who: 'limpieza1' })
    expect((await s.app.request('/cleaning/log')).status).toBe(401)
  })
})
