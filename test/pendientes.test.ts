import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

const keys = (r: any) => r.json.tasks.map((t: any) => t.key)

describe('pendientes de hoy y pedido sugerido', () => {
  it('abarrotes: por surtir con pedido por proveedor, fiado por cobrar, apartado por vencer y caja sin corte', async () => {
    const { s, T, product, buy, open, sell } = await negocioListo()
    // Negocio nuevo: solo los primeros pasos (falta agregar productos y hacer la primera venta).
    expect(keys(await s.call('GET', '/today', { token: T }))).toEqual(['primeros_pasos'])
    const prov = (await s.call('POST', '/suppliers', { token: T, body: { name: 'Distribuidora Sur', phone: '9631112233' } })).json
    const coca = await product({ name: 'Coca 600', unit: 'pieza', price: 2000, minStock: 10 })
    const pan = await product({ name: 'Pan', unit: 'pieza', price: 500, minStock: 4 })
    await buy([{ productId: coca.id, quantity: 12, cost: 12000 }], { supplierId: prov.id })
    await buy([{ productId: pan.id, quantity: 3, cost: 900 }])
    await open(0)
    await sell([{ productId: coca.id, quantity: 9 }]) // quedan 3 de mínimo 10 (el apartado reserva 1, pero sigue en la tienda)
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari', phone: '9634445566' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 100000 } })
    await sell([{ productId: pan.id, quantity: 1 }], { paymentMethod: 'fiado', customerId: cli.id })
    await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: coca.id, quantity: 1 }], deposit: 500, method: 'efectivo', dueDate: '2026-11-18' } })

    const r = await s.call('GET', '/today', { token: T })
    expect(keys(r)).toEqual(expect.arrayContaining(['surtir', 'fiado', 'apartados']))
    const fiado = r.json.tasks.find((t: any) => t.key === 'fiado')
    expect(fiado.title).toContain('$5.00')
    expect(fiado.items[0]).toMatchObject({ label: 'Doña Mari', phone: '9634445566' })
    expect(fiado.items[0].message).toContain('$5.00')

    // Pedido sugerido: llegar al doble del mínimo, con el proveedor de la última compra.
    const ped = (await s.call('GET', '/inventory/reorder', { token: T })).json.items
    expect(ped.find((i: any) => i.name === 'Coca 600')).toMatchObject({ stock: 3, minStock: 10, suggested: 17, supplier: { name: 'Distribuidora Sur', phone: '9631112233' } })
    expect(ped.find((i: any) => i.name === 'Pan')).toMatchObject({ stock: 2, suggested: 6, supplier: null })

    // Al día siguiente, la caja que quedó abierta aparece como urgente y primero.
    s.advance(86_400_000); s.longLived()
    const r2 = await s.call('GET', '/today', { token: T })
    expect(r2.json.tasks[0]).toMatchObject({ key: 'corte', tone: 'urgente' })
  })

  it('barbería: citas por confirmar, recordatorio de mañana y clientes con premio listo; un cajero no ve inventario', async () => {
    const { s, T, o } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    await s.call('POST', '/loyalty/rewards', { token: T, body: { name: 'Corte gratis', cost: 3 } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Joel Zamorano', phone: '9632369624' } })).json.customer
    await s.call('POST', `/customers/${cli.id}/stamps/adjust`, { token: T, body: { delta: 3, reason: 'Sellos anteriores' } })
    const me = (await s.call('GET', '/auth/me', { token: T })).json.user
    await s.call('PUT', `/staff/${me.id}/agenda`, { token: T, body: { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: '00:00', end: '23:59' })) } })
    const sv = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const tomorrow = '2026-11-18' // el reloj de prueba está en el 17 de noviembre
    const a = await s.call('POST', '/appointments', { token: T, body: { staffId: me.id, serviceIds: [sv.id], customerName: 'Joel Zamorano', phone: '9632369624', startsAt: new Date(`${tomorrow}T16:00:00-06:00`).toISOString() } })
    expect(a.status).toBe(201)
    // Las del link de reservas llegan «por confirmar».
    s.db.prepare("UPDATE appointments SET status = 'pendiente' WHERE id = ?").run(a.json.appointment?.id ?? a.json.id)
    const r = await s.call('GET', '/today', { token: T })
    expect(keys(r)).toEqual(expect.arrayContaining(['citas_confirmar', 'citas_manana', 'premios']))
    const rec = r.json.tasks.find((t: any) => t.key === 'citas_manana')
    expect(rec.items[0].message).toContain('mañana a las 4:00 p.m.')
    expect(r.json.tasks.find((t: any) => t.key === 'premios').items[0]).toMatchObject({ label: 'Joel Zamorano', sub: '3 sellos' })
    // El barbero ve lo de la agenda pero no inventario ni dinero.
    const b = await s.createStaff(T, o.business.code, 'barbero7', 'barbero')
    const rb = keys(await s.call('GET', '/today', { token: b.token }))
    expect(rb).toEqual(expect.arrayContaining(['citas_confirmar']))
    expect(rb).not.toContain('surtir')
    expect(rb).not.toContain('fiado')
  })

  it('deuda anterior: se agrega a la cuenta del cliente con motivo, sin contar como venta', async () => {
    const { s, T, o } = await negocioListo()
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Don Beto' } })).json.customer
    expect((await s.call('POST', `/customers/${cli.id}/credit-charges`, { token: T, body: { amount: 35000 } })).status).toBe(400)
    const r = await s.call('POST', `/customers/${cli.id}/credit-charges`, { token: T, body: { amount: 35000, note: 'Deuda de la libreta' } })
    expect(r.json.balance).toBe(35000)
    const cr = (await s.call('GET', `/customers/${cli.id}/credit`, { token: T })).json
    expect(cr.ledger[0]).toMatchObject({ kind: 'cargo', note: 'Deuda de la libreta', delta: 35000 })
    expect((await s.call('GET', '/reports/summary', { token: T })).json.sales.total).toBe(0)
    expect((await s.call('GET', '/receivables', { token: T })).json.total).toBe(35000)
    // Un cajero necesita el código del dueño.
    const caj = await s.createStaff(T, o.business.code, 'cajero8', 'cajero')
    expect((await s.call('POST', `/customers/${cli.id}/credit-charges`, { token: caj.token, body: { amount: 1000, note: 'Faltó' } })).json.error.code).toBe('codigo_requerido')
    expect((await s.call('POST', `/customers/${cli.id}/credit-charges`, { token: caj.token, body: { amount: 1000, note: 'Faltó', authCode: '4321' } })).json.balance).toBe(36000)
  })

  it('fidelidad: avisa a quienes les falta 1 sello para cada premio, con su mensaje de WhatsApp (4 de 5 → facial)', async () => {
    const { s, T } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    await s.call('POST', '/loyalty/rewards', { token: T, body: { name: 'Facial', cost: 5 } })
    await s.call('POST', '/loyalty/rewards', { token: T, body: { name: 'Corte gratis', cost: 10 } })
    const dar = async (name: string, phone: string, n: number) => { const c = (await s.call('POST', '/customers', { token: T, body: { name, phone } })).json.customer; if (n) await s.call('POST', `/customers/${c.id}/stamps/adjust`, { token: T, body: { delta: n, reason: 'Sellos' } }); return c }
    await dar('Ana López', '5511111111', 4)      // 4 de 5 → falta 1 (Facial)
    await dar('Beto Ruiz', '5522222222', 9)      // 9 de 10 → falta 1 (Corte gratis)
    await dar('Carla Soto', '5533333333', 3)     // 3: aún no
    await dar('Diego Paz', '5544444444', 5)      // 5: ya puede canjear el Facial (otra tarea)
    const t = (await s.call('GET', '/today', { token: T })).json.tasks.find((x: any) => x.key === 'casi_premio')
    expect(t.items.map((i: any) => i.label).sort()).toEqual(['Ana López', 'Beto Ruiz'])
    const ana = t.items.find((i: any) => i.label === 'Ana López')
    expect(ana.sub).toContain('Facial'); expect(ana.sub).toContain('lleva 4 de 5')
    expect(ana.message).toContain('te falta solo 1 sello para tu Facial'); expect(ana.phone).toBe('5511111111')
    expect(t.items.find((i: any) => i.label === 'Beto Ruiz').message).toContain('Corte gratis')
    // Al dar el sello que faltaba, deja de salir en este aviso (y pasa a «puede canjear»).
    const c = (await s.call('GET', '/customers?q=Ana', { token: T })).json.customers[0]
    await s.call('POST', `/customers/${c.id}/stamps/adjust`, { token: T, body: { delta: 1, reason: 'Visita' } })
    const t2 = (await s.call('GET', '/today', { token: T })).json.tasks.find((x: any) => x.key === 'casi_premio')
    expect(t2.items.map((i: any) => i.label)).toEqual(['Beto Ruiz'])
    expect((await s.call('GET', '/today', { token: T })).json.tasks.find((x: any) => x.key === 'premios').items.map((i: any) => i.label).sort()).toEqual(['Ana López', 'Beto Ruiz', 'Diego Paz'])
  })
})
