import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

/**
 * Aislamiento entre negocios: con los identificadores de un negocio (A), otro negocio (B) no puede
 * leer ni cambiar nada. Se prueban TODAS las rutas con «:id» del servidor (se leen del código),
 * así una ruta nueva sin revisar el negocio hace fallar esta prueba.
 */

async function negocio(s: ReturnType<typeof setup>, phone: string) {
  const o = await s.registerOwner(phone)
  const T = o.token
  await s.call('PATCH', '/business', { token: T, body: { forcePasswordChange: false } })
  const me = (await s.call('GET', '/auth/me', { token: T })).json.user
  await s.call('PUT', `/users/${me.id}/auth-code`, { token: T, body: { code: '4321' } })
  return { T, o, me }
}

/** Rutas con identificador, tal como están escritas en src/*.ts (sin el super panel). */
function routesWithId() {
  const out = new Set<string>()
  for (const f of readdirSync('src').filter((f) => f.endsWith('.ts') && !['admin.ts', 'assets.gen.ts'].includes(f))) {
    for (const m of readFileSync(`src/${f}`, 'utf8').matchAll(/\.(get|post|patch|put|delete)\('(\/[^']*:[a-zA-Z]+[^']*)'/g)) out.add(`${m[1]!.toUpperCase()} ${m[2]}`)
  }
  return [...out].filter((r) => !r.includes('/public/'))
}

describe('aislamiento entre negocios', () => {
  it('B no puede leer ni modificar nada de A usando sus identificadores', async () => {
    const s = setup()
    s.setGiro('barberia')
    const A = await negocio(s, '5510000001')
    const B = await negocio(s, '5520000002')
    for (const x of [A, B]) await s.call('PUT', '/modules', { token: x.T, body: { active: ['fidelidad', 'membresias'] } })
    const call = (m: string, p: string, body?: object) => s.call(m, p, { token: A.T, body })

    // Datos de A.
    const product = (await call('POST', '/products', { name: 'Cera', unit: 'pieza', price: 15000 })).json.product
    const supplier = (await call('POST', '/suppliers', { name: 'Prov A' })).json
    const purchase = (await call('POST', '/purchases', { payment: 'credito', supplierId: supplier.id, items: [{ productId: product.id, quantity: 5, cost: 30000 }] })).json
    const customer = (await call('POST', '/customers', { name: 'Cliente A', phone: '9611112233' })).json.customer
    const service = (await call('POST', '/services', { name: 'Corte', price: 15000, durationMin: 30 })).json.service
    const category = (await call('POST', '/categories', { name: 'Ceras' })).json
    const shift = (await call('POST', '/shifts/open', { openingFloat: 0 })).json.shift
    const sale = (await call('POST', '/sales', { id: s.uuid(), paymentMethod: 'efectivo', customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] })).json.sale
    const staff = await s.createStaff(A.T, A.o.business.code, 'barberoa', 'barbero')
    await call('PUT', `/staff/${A.me.id}/agenda`, { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: '00:00', end: '23:59' })) })
    const appt = (await call('POST', '/appointments', { staffId: A.me.id, serviceIds: [service.id], customerName: 'Cliente A', phone: '9611112233', startsAt: new Date('2026-11-18T16:00:00-06:00').toISOString() })).json
    const reward = (await call('POST', '/loyalty/rewards', { name: 'Corte gratis', cost: 5 })).json

    const ids: Record<string, string> = {
      products: product.id, suppliers: supplier.id, purchases: purchase.id ?? purchase.purchase?.id, customers: customer.id, services: service.id,
      categories: category.id ?? category.category?.id, shifts: shift.id, sales: sale.id, users: staff.id, staff: A.me.id,
      appointments: appt.appointment?.id ?? appt.id, rewards: reward.id ?? reward.reward?.id,
    }
    const fake = s.uuid()
    const leaks: string[] = []
    const checked: string[] = []
    for (const r of routesWithId()) {
      const [method, path] = r.split(' ') as [string, string]
      const seg = path.split('/')[1]!
      const key = seg === 'loyalty' ? 'rewards' : seg
      const url = path.replace(/:id/, ids[key] ?? fake).replace(/:[a-zA-Z]+/g, fake)
      const res = await s.call(method, url, { token: B.T, body: method === 'GET' || method === 'DELETE' ? undefined : { reason: 'prueba de aislamiento', authCode: '4321', amount: 100, quantity: 1, name: 'X', active: false, method: 'efectivo', paymentMethod: 'efectivo', startsAt: new Date('2026-11-19T16:00:00-06:00').toISOString(), countedCash: 0 } })
      checked.push(r)
      // Un 2xx con un identificador de otro negocio es una fuga (lectura o cambio).
      if (res.status >= 200 && res.status < 300 && ids[key]) leaks.push(`${r} → ${res.status}`)
    }
    expect(checked.length).toBeGreaterThan(80)
    expect(leaks).toEqual([])

    // Los datos de A siguen intactos.
    expect((await call('GET', `/products/${product.id}`)).json.product).toMatchObject({ name: 'Cera', active: true })
    expect((await call('GET', `/customers/${customer.id}`)).json.customer.name).toBe('Cliente A')
    expect((await call('GET', `/sales/${sale.id}`)).json.sale.status).toBe('completada')
  })

  it('reagendar una cita no acepta personal de otro negocio', async () => {
    const s = setup()
    s.setGiro('barberia')
    const A = await negocio(s, '5510000003')
    const B = await negocio(s, '5520000004')
    const all = [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: '00:00', end: '23:59' }))
    await s.call('PUT', `/staff/${A.me.id}/agenda`, { token: A.T, body: { inAgenda: true, schedule: all } })
    await s.call('PUT', `/staff/${B.me.id}/agenda`, { token: B.T, body: { inAgenda: true, schedule: all } })
    const sv = (await s.call('POST', '/services', { token: A.T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const a = (await s.call('POST', '/appointments', { token: A.T, body: { staffId: A.me.id, serviceIds: [sv.id], customerName: 'Ana', phone: '9611112233', startsAt: new Date('2026-11-18T16:00:00-06:00').toISOString() } })).json
    const id = a.appointment?.id ?? a.id
    const r = await s.call('POST', `/appointments/${id}/reschedule`, { token: A.T, body: { startsAt: new Date('2026-11-18T17:00:00-06:00').toISOString(), staffId: B.me.id } })
    expect(r.status).toBe(400)
    expect(r.json.error.message).toContain('no es de este negocio')
  })
})
