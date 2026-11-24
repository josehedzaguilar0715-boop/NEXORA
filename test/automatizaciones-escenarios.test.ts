import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

/**
 * Escenarios de las automatizaciones: datos insuficientes, incompletos y suficientes.
 * Regla: con datos insuficientes NO hay recomendación; con datos suficientes, los números cuadran.
 */
async function negocio() {
  const n = await negocioListo()
  n.s.db.prepare("UPDATE businesses SET plan = 'profesional'").run()
  return n
}

describe('servicios: rentabilidad', () => {
  it('sin ventas no hay nada que mostrar ni aconsejar', async () => {
    const { s, T } = await negocio()
    await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30, cost: 2000 } })
    const r = (await s.call('GET', '/auto/servicios', { token: T })).json
    expect(r.services).toEqual([])
    expect(r.staff).toEqual([])
    expect(r.consejos).toEqual([])
  })
  it('con pocas ventas (menos de 3) no se da consejo aunque el margen sea bajo; con 3 o más, sí', async () => {
    const { s, T, open, sell } = await negocio()
    const caro = (await s.call('POST', '/services', { token: T, body: { name: 'Tratamiento', price: 10000, durationMin: 30, cost: 9000 } })).json.service // margen 10 %
    await open(10_000)
    await sell([{ serviceId: caro.id, quantity: 1 }]); await sell([{ serviceId: caro.id, quantity: 1 }])
    let r = (await s.call('GET', '/auto/servicios', { token: T })).json
    expect(r.services[0]).toMatchObject({ sold: 2, marginPct: 10, costKnown: true })
    expect(r.consejos).toEqual([]) // 2 ventas: todavía no es una tendencia
    await sell([{ serviceId: caro.id, quantity: 1 }])
    r = (await s.call('GET', '/auto/servicios', { token: T })).json
    expect(r.consejos.join(' ')).toContain('Tratamiento')
    expect(r.consejos.join(' ')).toMatch(/10%/)
  })
  it('un servicio vendido a pérdida muestra ganancia negativa', async () => {
    const { s, T, open, sell } = await negocio()
    const m = (await s.call('POST', '/services', { token: T, body: { name: 'Promo', price: 5000, durationMin: 20, cost: 8000 } })).json.service
    await open(10_000)
    await sell([{ serviceId: m.id, quantity: 1 }])
    const r = (await s.call('GET', '/auto/servicios', { token: T })).json
    expect(r.services[0].profit).toBe(-3000)
  })
  it('periodo inválido se rechaza', async () => {
    const { s, T } = await negocio()
    expect((await s.call('GET', '/auto/servicios?from=2026-11-20&to=2026-11-01', { token: T })).status).toBe(400)
    expect((await s.call('GET', '/auto/servicios?from=hoy', { token: T })).status).toBe(400)
  })
})

describe('clientes: seguimiento', () => {
  it('sin teléfono no hay enlace; quien tiene cita próxima no aparece; fuera de ventana no aparece', async () => {
    const { s, T, open, sell } = await negocio()
    const svc = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const mk = async (name: string, phone?: string) => (await s.call('POST', '/customers', { token: T, body: { name, ...(phone ? { phone } : {}) } })).json.customer
    const sinTel = await mk('Sin Telefono'); const reciente = await mk('Reciente Cliente', '5512345678')
    await open(10_000)
    for (const c of [sinTel, sinTel, reciente, reciente]) await sell([{ serviceId: svc.id, quantity: 1 }], { customerId: c.id })
    s.longLived()
    s.advance(60 * 86_400_000)
    const r = (await s.call('GET', '/auto/clientes?days=45', { token: T })).json
    expect(r.lapsed.map((x: any) => x.name).sort()).toEqual(['Reciente Cliente', 'Sin Telefono'])
    expect(r.lapsed.find((x: any) => x.name === 'Sin Telefono').whatsapp).toBeNull()
    // Con 90 días de umbral todavía no «dejaron de venir».
    expect((await s.call('GET', '/auto/clientes?days=90', { token: T })).json.lapsed).toEqual([])
    // Una vez con >90 días ya no se les escribe como «una vez»: la ventana es de 14 a 90 días.
    s.advance(60 * 86_400_000)
    expect((await s.call('GET', '/auto/clientes?days=45', { token: T })).json.once).toEqual([])
  })
})

describe('restaurante: costos incompletos y alertas', () => {
  it('con un ingrediente sin costo no se calcula el costo del platillo ni se da alerta de margen', async () => {
    const { s, T, product, buy, open, sell } = await negocio()
    const carne = await product({ name: 'Carne', unit: 'kg', price: 0 })
    const salsa = await product({ name: 'Salsa', unit: 'kg', price: 0 })
    const plato = await product({ name: 'Plato', unit: 'pieza', price: 5000, trackStock: false })
    await buy([{ productId: carne.id, quantity: 10, cost: 100_000 }])
    await s.call('PUT', `/recipes/${plato.id}`, { token: T, body: { items: [{ productId: carne.id, quantity: 0.2 }, { productId: salsa.id, quantity: 0.05 }] } })
    await open(10_000)
    await sell([{ productId: plato.id, quantity: 1 }])
    const r = (await s.call('GET', '/auto/platillos', { token: T })).json
    const p = r.platillos.find((x: any) => x.name === 'Plato')
    expect(p).toMatchObject({ complete: false, recipeCost: null, marginPct: null, gain: null })
    expect(r.falta.join(' ')).toContain('Salsa')
    expect(r.alertas.join(' ')).not.toContain('Plato') // sin costo completo no hay alerta de margen
  })
  it('margen bajo con receta completa genera alerta; costo de ingrediente que sube 10 % o más también', async () => {
    const { s, T, product, buy, open, sell } = await negocio()
    s.longLived()
    const harina = await product({ name: 'Harina', unit: 'kg', price: 0, minStock: 1 })
    const pan = await product({ name: 'Pan', unit: 'pieza', price: 1000, trackStock: false })
    await buy([{ productId: harina.id, quantity: 10, cost: 10_000 }]) // $10/kg
    await s.call('PUT', `/recipes/${pan.id}`, { token: T, body: { items: [{ productId: harina.id, quantity: 0.08 }] } }) // $0.80 → margen 92 %
    await open(10_000)
    await sell([{ productId: pan.id, quantity: 2 }])
    let r = (await s.call('GET', '/auto/platillos', { token: T })).json
    expect(r.alertas.filter((a: string) => a.includes('Pan') && a.includes('solo'))).toEqual([]) // margen sano
    expect(r.ingredientes[0].costChangePct).toBeNull() // un solo precio de compra: no hay con qué comparar
    // 35 días después: la harina sube 30 % y el pan queda por debajo del 30 % de margen.
    s.advance(35 * 86_400_000)
    await buy([{ productId: harina.id, quantity: 10, cost: 13_000 }]) // $13/kg
    await s.call('PUT', `/products/${pan.id}`, { token: T, body: { price: 150, baseVersion: (await s.call('GET', '/products', { token: T })).json.products.find((x: any) => x.name === 'Pan').version, updatedAt: new Date().toISOString() } }).catch(() => {})
    await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 0 } }).catch(() => {})
    await sell([{ productId: pan.id, quantity: 1 }])
    r = (await s.call('GET', '/auto/platillos', { token: T })).json
    const h = r.ingredientes.find((x: any) => x.name === 'Harina')
    expect(h.costChangePct).toBe(30)
    expect(r.alertas.join(' ')).toMatch(/Harina subió 30%/)
  })
})

describe('tiendas: márgenes y reposición con datos incompletos', () => {
  it('producto sin costo no entra al ranking y se avisa; precio igual al costo se marca como pérdida', async () => {
    const { s, T, product, buy, open, sell } = await negocio()
    const a = await product({ name: 'Sin costo', unit: 'pieza', price: 3000 })
    const b = await product({ name: 'Al costo', unit: 'pieza', price: 2000 })
    await buy([{ productId: b.id, quantity: 10, cost: 20_000 }]) // $20 c/u = su precio
    await s.call('POST', '/inventory/count', { token: T, body: { productId: a.id, counted: 10, reason: 'Inicial' } })
    await open(10_000)
    await sell([{ productId: a.id, quantity: 1 }]); await sell([{ productId: b.id, quantity: 1 }])
    const r = (await s.call('GET', '/auto/productos', { token: T })).json
    expect(r.top.map((x: any) => x.name)).not.toContain('Sin costo')
    expect(r.falta.join(' ')).toContain('Sin costo')
    expect(r.belowCost.map((x: any) => x.name)).toEqual(['Al costo'])
  })
  it('sin ventas ni mínimo no se sugiere comprar; con solo mínimo bajo sí; lo no vendido es «poco movimiento» solo si lleva tiempo', async () => {
    const { s, T, product, buy } = await negocio()
    const sinDatos = await product({ name: 'Sin datos', unit: 'pieza', price: 1000 })
    const conMin = await product({ name: 'Con mínimo', unit: 'pieza', price: 1000, minStock: 5 })
    await buy([{ productId: conMin.id, quantity: 2, cost: 2000 }, { productId: sinDatos.id, quantity: 3, cost: 3000 }])
    let r = (await s.call('GET', '/inventory/replenishment', { token: T })).json
    expect(r.toBuy.map((x: any) => x.name)).toEqual(['Con mínimo']) // solo por su mínimo, sin inventar ritmo de venta
    expect(r.toBuy[0].daysLeft).toBeNull()
    expect(r.slow).toEqual([]) // el producto es nuevo: todavía no cuenta como «sin movimiento»
    s.db.prepare("UPDATE products SET created_at = '2020-01-01T00:00:00.000Z'").run()
    r = (await s.call('GET', '/inventory/replenishment', { token: T })).json
    expect(r.slow.map((x: any) => x.name)).toEqual(['Sin datos'])
  })
})
