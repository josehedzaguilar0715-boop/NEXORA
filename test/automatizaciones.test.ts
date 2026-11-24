import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

/** Automatizaciones por giro: solo con datos registrados; si faltan, lo dicen y no recomiendan. */
async function salon() {
  const n = await negocioListo()
  const { s, T, o } = n
  s.db.prepare("UPDATE businesses SET plan = 'profesional'").run()
  const juan = await s.createStaff(T, o.business.code, 'juanb', 'barbero')
  const luis = await s.createStaff(T, o.business.code, 'luisb', 'barbero')
  const svc = async (body: object) => (await s.call('POST', '/services', { token: T, body })).json.service
  const corte = await svc({ name: 'Corte', price: 15000, durationMin: 30, cost: 2000 })
  const tinte = await svc({ name: 'Tinte', price: 30000, durationMin: 60 }) // sin costo ni materiales capturados
  const gel = await n.product({ name: 'Gel', unit: 'pieza', price: 5000 })
  await n.buy([{ productId: gel.id, quantity: 100, cost: 100_000 }]) // $10 c/u
  const barba = await svc({ name: 'Barba', price: 10000, durationMin: 20 })
  await s.call('PUT', `/recipes/${barba.id}`, { token: T, body: { items: [{ productId: gel.id, quantity: 0.5 }] } }) // media pieza de gel por barba
  await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ staffId: juan.id, targetType: 'all', rateBp: 3000 }] } })
  await n.open(10_000)
  return { ...n, juan, luis, corte, tinte, barba, gel }
}

describe('barbería y uñas: rentabilidad', () => {
  it('por servicio y por persona: ingreso − materiales/costo − comisión, y avisa lo que falta capturar', async () => {
    const { s, T, sell, juan, luis, corte, tinte, barba } = await salon()
    for (let i = 0; i < 3; i++) await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }])
    await sell([{ serviceId: barba.id, quantity: 2, staffId: luis.id }])
    await sell([{ serviceId: tinte.id, quantity: 1, staffId: luis.id }])
    const r = (await s.call('GET', '/auto/servicios', { token: T })).json
    const c = r.services.find((x: any) => x.name === 'Corte')
    // 3 cortes: ingreso 450, costo 3×20=60, comisión de Juan 30% de 450 = 135 → ganancia 255.
    expect(c).toMatchObject({ sold: 3, revenue: 45_000, cost: 6_000, commission: 13_500, profit: 25_500, costKnown: true })
    const b = r.services.find((x: any) => x.name === 'Barba')
    // 2 barbas: ingreso 200, materiales 2×0.5×$10 = $10 → ganancia 190 (Luis sin regla de comisión).
    expect(b).toMatchObject({ sold: 2, revenue: 20_000, cost: 1_000, commission: 0, profit: 19_000, costKnown: true })
    expect(b.materials).toEqual([expect.objectContaining({ name: 'Gel', qty: 0.5, cost: 500 })])
    // Tinte sin costo capturado: se avisa y NO se aconseja sobre él.
    expect(r.falta.join(' ')).toContain('Tinte')
    expect(r.consejos.join(' ')).not.toContain('Tinte')
    // Por persona (también quien no gana comisión).
    const j = r.staff.find((x: any) => x.name === 'juanb')
    const l = r.staff.find((x: any) => x.name === 'luisb')
    expect(j).toMatchObject({ services: 3, revenue: 45_000, commission: 13_500, profit: 25_500 })
    expect(l).toMatchObject({ services: 3, revenue: 50_000 })
    // Permiso: solo finanzas.
    const enc = await s.createStaff(T, (s.db.prepare('SELECT code FROM businesses').get() as any).code, 'encarx', 'encargado')
    expect((await s.call('GET', '/auto/servicios', { token: enc.token })).status).toBe(403)
  })
})

describe('seguimiento de clientes', () => {
  it('detecta a quien dejó de venir y a quien vino una sola vez, solo con clientes registrados en ventas', async () => {
    const { s, T, sell, juan, corte } = await salon()
    expect((await s.call('GET', '/auto/clientes', { token: T })).json.falta[0]).toMatch(/clientes registrados/i) // aún no hay datos
    const mk = async (name: string, phone: string) => (await s.call('POST', '/customers', { token: T, body: { name, phone } })).json.customer
    const fiel = await mk('Pedro Fiel', '5511111111'), nuevo = await mk('Nico Nuevo', '5522222222'), activo = await mk('Rita Reciente', '5533333333')
    await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }], { customerId: fiel.id })
    await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }], { customerId: fiel.id })
    await sell([{ serviceId: corte.id, quantity: 1, staffId: juan.id }], { customerId: nuevo.id })
    s.longLived()
    s.advance(50 * 86_400_000)
    await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 0 } }).catch(() => {})
    const r0 = (await s.call('GET', '/auto/clientes', { token: T })).json
    expect(r0.registered).toBe(3 - 1) // Rita aún no compró
    expect(r0.lapsed.map((x: any) => x.name)).toEqual(['Pedro Fiel'])
    expect(r0.lapsed[0].whatsapp).toContain('wa.me/525511111111')
    expect(r0.lapsed[0].message).toContain('Pedro')
    expect(r0.once.map((x: any) => x.name)).toEqual(['Nico Nuevo'])
    void activo
  })
})

describe('restaurante: platillos, ingredientes, desperdicio', () => {
  it('costo real por platillo, consumo, desperdicio y alertas; sin costo o sin receta lo dice', async () => {
    const n = await negocioListo()
    const { s, T, product, buy, open, sell } = n
    const carne = await product({ name: 'Carne', unit: 'kg', price: 0, trackStock: true, minStock: 5 })
    const tortilla = await product({ name: 'Tortilla', unit: 'kg', price: 0, trackStock: true })
    const taco = await product({ name: 'Taco', unit: 'pieza', price: 2500, trackStock: false })
    const flauta = await product({ name: 'Flauta', unit: 'pieza', price: 3000, trackStock: false }) // sin receta
    await buy([{ productId: carne.id, quantity: 10, cost: 100_000 }, { productId: tortilla.id, quantity: 10, cost: 20_000 }]) // carne $100/kg, tortilla $20/kg
    await s.call('PUT', `/recipes/${taco.id}`, { token: T, body: { items: [{ productId: carne.id, quantity: 0.05 }, { productId: tortilla.id, quantity: 0.03 }] } })
    await open(10_000)
    await sell([{ productId: taco.id, quantity: 20 }])
    // Merma: se tiró 1 kg de carne.
    await s.call('POST', '/inventory/waste', { token: T, body: { productId: carne.id, quantity: 1, reason: 'Se echó a perder' } })
    const r = (await s.call('GET', '/auto/platillos', { token: T })).json
    const t = r.platillos.find((x: any) => x.name === 'Taco')
    // Receta: 0.05 kg × $100 + 0.03 kg × $20 = $5.60 por taco; precio $25 → ganancia $19.40 (77.6 %).
    expect(t).toMatchObject({ complete: true, recipeCost: 560, gain: 1940, sold: 20, revenue: 50_000 })
    expect(t.marginPct).toBeCloseTo(77.6, 1)
    expect(t.realCost).toBe(11_200) // 20 tacos × $5.60 consumidos de lotes
    // Consumo de ingredientes del periodo.
    const ic = r.ingredientes.find((x: any) => x.name === 'Carne')
    expect(ic.used).toBeCloseTo(1, 3)
    // Desperdicio registrado.
    expect(r.desperdicio.total).toBe(10_000)
    expect(r.desperdicio.items[0]).toMatchObject({ name: 'Carne', qty: 1 })
    // Reposición: la carne bajó de su mínimo (10 − 1 − 1 = 8… con 5 de mínimo no); verificamos que NO alerta de lo que no aplica.
    expect(r.alertas.join(' ')).not.toContain('por debajo de su mínimo')
    // Sin receta: se explica qué capturar.
    expect(r.falta.join(' ')).toContain('Flauta')
    expect(r.platillos.find((x: any) => x.name === 'Flauta')).toBeUndefined()
  })
})

describe('tiendas: margen real y alertas de precio', () => {
  it('detecta producto vendido bajo su costo y sin costo capturado', async () => {
    const { s, T, product, buy, open, sell } = await negocioListo()
    const mal = await product({ name: 'Aceite', unit: 'pieza', price: 3000 })
    const bien = await product({ name: 'Galletas', unit: 'pieza', price: 2000 })
    await buy([{ productId: mal.id, quantity: 10, cost: 40_000 }, { productId: bien.id, quantity: 10, cost: 10_000 }]) // aceite $40 c/u, galletas $10
    await open(10_000)
    await sell([{ productId: mal.id, quantity: 2 }])
    await sell([{ productId: bien.id, quantity: 5 }])
    const r = (await s.call('GET', '/auto/productos', { token: T })).json
    expect(r.belowCost.map((x: any) => x.name)).toEqual(['Aceite'])
    expect(r.top[0].name).toBe('Galletas')
    expect(r.consejos.join(' ')).toContain('perdiendo')
  })
})

describe('recordatorios de citas', () => {
  it('prepara el mensaje para mañana y recuerda a quién ya se avisó', async () => {
    const { s, T, juan, corte } = await salon()
    s.db.prepare("UPDATE businesses SET giro = 'barberia'").run()
    await s.call('PUT', `/staff/${juan.id}/agenda`, { token: T, body: { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '19:00' })) } })
    const manana = new Date(Date.now() + 0)
    void manana
    const r0 = (await s.call('GET', '/agenda/reminders?date=2026-11-18', { token: T })).json
    expect(r0.reminders).toEqual([])
    const a = (await s.call('POST', '/appointments', { token: T, body: { staffId: juan.id, serviceIds: [corte.id], startsAt: '2026-11-18T17:00:00.000Z', customerName: 'Ana López', phone: '5544332211' } })).json.appointment
    const r1 = (await s.call('GET', '/agenda/reminders?date=2026-11-18', { token: T })).json.reminders
    expect(r1).toHaveLength(1)
    expect(r1[0]).toMatchObject({ customerName: 'Ana López', reminded: false })
    expect(r1[0].whatsapp).toContain('wa.me/525544332211')
    expect(r1[0].message).toContain('Ana')
    expect(r1[0].message).toMatch(/11:00/)
    await s.call('POST', `/appointments/${a.id}/reminded`, { token: T })
    expect((await s.call('GET', '/agenda/reminders?date=2026-11-18', { token: T })).json.reminders[0].reminded).toBe(true)
  })
})
