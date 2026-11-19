import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function papeleria() {
  const n = await negocioListo()
  const { s, T } = n
  const copiadora = (await s.call('POST', '/machines', { token: T, body: { name: 'Copiadora Ricoh' } })).json.id
  const toner = await n.product({ name: 'Tóner negro', unit: 'pieza', price: 0, sellable: false })
  const papel = await n.product({ name: 'Papel carta (hoja)', unit: 'pieza', price: 0, sellable: false })
  await n.buy([{ productId: toner.id, quantity: 2, cost: 180000 }, { productId: papel.id, quantity: 5000, cost: 50000 }])
  const svc = async (body: object) => (await s.call('POST', '/services', { token: T, body })).json.service
  const copiaBN = await svc({ name: 'Copia carta B/N', category: 'copias', price: 100, attrs: { size: 'carta', color: false }, machineId: copiadora, sheetsPerUnit: 1 })
  const copiaColor = await svc({ name: 'Copia carta color', category: 'copias', price: 500, attrs: { size: 'carta', color: true }, machineId: copiadora, sheetsPerUnit: 1 })
  const copiaOficio = await svc({ name: 'Copia oficio B/N', category: 'copias', price: 150, attrs: { size: 'oficio', color: false }, machineId: copiadora, sheetsPerUnit: 1 })
  const engargolado = await svc({ name: 'Engargolado', category: 'encuadernado', price: 3500 })
  // Consumibles: cada copia gasta 1 hoja y 1/20 000 de tóner.
  await s.call('PUT', `/recipes/${copiaBN.id}`, { token: T, body: { items: [{ productId: papel.id, quantity: 1 }, { productId: toner.id, quantity: 0.00005 }] } })
  return { ...n, copiadora, toner, papel, copiaBN, copiaColor, copiaOficio, engargolado }
}

describe('papelería', () => {
  it('servicios por hoja con precio por tamaño y color; descuentan consumibles con costo', async () => {
    const { s, T, open, sell, copiaBN, copiaColor, copiaOficio, engargolado, papel, stock } = await papeleria()
    await open(0)
    const v = await sell([{ serviceId: copiaBN.id, quantity: 40 }, { serviceId: copiaColor.id, quantity: 3 }, { serviceId: copiaOficio.id, quantity: 10 }, { serviceId: engargolado.id, quantity: 1 }])
    expect(v.json.sale.total).toBe(4000 + 1500 + 1500 + 3500)
    expect(await stock(papel.id)).toBe(4960)
    const r = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(r.costOfSales).toBe(400 + 180) // 40 hojas a $0.10 + tóner proporcional (40 × 0.00005 × $900)
  })

  it('el tóner y el papel son de uso interno: no se venden en caja', async () => {
    const { open, sell, toner } = await papeleria()
    await open(0)
    expect((await sell([{ productId: toner.id, quantity: 1 }])).status).toBe(400)
  })

  it('contador de la copiadora al inicio y fin del turno contra hojas vendidas', async () => {
    const { s, T, open, sell, copiadora, copiaBN, copiaColor } = await papeleria()
    const shift = (await open(0)).json.shift.id
    expect((await s.call('POST', `/machines/${copiadora}/readings`, { token: T, body: { type: 'fin', value: 10 } })).json.error.code).toBe('falta_inicio')
    await s.call('POST', `/machines/${copiadora}/readings`, { token: T, body: { type: 'inicio', value: 15000 } })
    await sell([{ serviceId: copiaBN.id, quantity: 120 }, { serviceId: copiaColor.id, quantity: 5 }])
    expect((await s.call('POST', `/machines/${copiadora}/readings`, { token: T, body: { type: 'fin', value: 14000 } })).status).toBe(400)
    await s.call('POST', `/machines/${copiadora}/readings`, { token: T, body: { type: 'fin', value: 15140 } })
    const rep = (await s.call('GET', `/shifts/${shift}/counters`, { token: T })).json.machines[0]
    expect(rep).toMatchObject({ counted: 140, sold: 125, difference: 15 }) // 15 copias sin cobrar
  })

  it('combo de temporada con un solo precio descuenta sus componentes', async () => {
    const { s, T, product, buy, open, sell, stock } = await papeleria()
    const cuaderno = await product({ name: 'Cuaderno profesional', unit: 'pieza', price: 4500 })
    const lapiz = await product({ name: 'Lápiz', unit: 'pieza', price: 800 })
    const paquete = await product({ name: 'Paquete 1° primaria', unit: 'pieza', price: 19900 })
    await s.call('PUT', `/products/${paquete.id}/combo`, { token: T, body: { items: [{ productId: cuaderno.id, quantity: 4 }, { productId: lapiz.id, quantity: 3 }] } })
    await buy([{ productId: cuaderno.id, quantity: 40, cost: 120000 }, { productId: lapiz.id, quantity: 30, cost: 9000 }])
    await open(0)
    const v = await sell([{ productId: paquete.id, quantity: 2 }])
    expect(v.json.sale.total).toBe(39800)
    expect(await stock(cuaderno.id)).toBe(32)
    expect(await stock(lapiz.id)).toBe(24)
    expect(await stock(paquete.id)).toBe(0)
    const cost = (s.db.prepare('SELECT cost FROM sale_items WHERE sale_id = ?').get(v.json.sale.id) as any).cost
    expect(cost).toBe(8 * 3000 + 6 * 300)
  })

  it('encargo con anticipo: el anticipo entra al corte y al entregar se cobra el saldo', async () => {
    const { s, T, open } = await papeleria()
    await open(0)
    const o = await s.call('POST', '/orders', { token: T, body: { customerName: 'Escuela Juárez', phone: '5512340000', description: '200 diplomas impresos en opalina', total: 120000, deposit: 50000, dueDate: '2026-11-25' } })
    expect(o.json.order).toMatchObject({ folio: 1, balance: 70000, status: 'pendiente' })
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.cashSales).toBe(50000)
    await s.call('POST', `/orders/${o.json.order.id}/ready`, { token: T })
    const d = await s.call('POST', `/orders/${o.json.order.id}/deliver`, { token: T, body: { paymentMethod: 'efectivo' } })
    expect(d.json.balance).toBe(70000)
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.cashSales).toBe(120000)
    expect((await s.call('POST', `/orders/${o.json.order.id}/deliver`, { token: T, body: {} })).json.error.code).toBe('encargo_cerrado')
  })

  it('devolver el anticipo lo decide el dueño con su código', async () => {
    const { s, o, T, open } = await papeleria()
    const enc = await s.createStaff(T, o.business.code, 'encargada', 'encargado')
    await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
    await open(0)
    const ord = (await s.call('POST', '/orders', { token: T, body: { customerName: 'Lupita', description: 'Tesis engargolada', total: 30000, deposit: 10000 } })).json.order
    const body = { refundDeposit: true, refundMethod: 'efectivo', reason: 'El cliente ya no lo quiere' }
    expect((await s.call('POST', `/orders/${ord.id}/cancel`, { token: T, body: { ...body, authCode: '7777' } })).status).toBe(403)
    expect((await s.call('POST', `/orders/${ord.id}/cancel`, { token: T, body: { ...body, authCode: '4321' } })).status).toBe(200)
    const t = (await s.call('GET', '/shifts/current', { token: T })).json.totals
    expect(t.expectedCash).toBe(10000 - 10000)
    expect((await s.call('GET', '/reports/summary', { token: T })).json.refunds).toBe(10000)
  })

  it('mayoreo a escuelas: escalas por volumen y crédito', async () => {
    const { s, T, product, buy, open, sell } = await papeleria()
    const hojas = await product({ name: 'Paquete hojas blancas 500', unit: 'pieza', price: 11000 })
    await buy([{ productId: hojas.id, quantity: 50, cost: 400000 }])
    await s.call('PUT', `/products/${hojas.id}/price-tiers`, { token: T, body: { tiers: [{ minQuantity: 10, price: 9500 }] } })
    const escuela = (await s.call('POST', '/customers', { token: T, body: { name: 'Primaria Hidalgo' } })).json.customer
    await s.call('PUT', `/customers/${escuela.id}/credit-limit`, { token: T, body: { limit: 200000 } })
    await open(0)
    const v = await sell([{ productId: hojas.id, quantity: 12 }], { paymentMethod: 'fiado', customerId: escuela.id })
    expect(v.json.sale.total).toBe(12 * 9500)
  })
})
