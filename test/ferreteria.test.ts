import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function ferre() {
  const n = await negocioListo()
  const tornillo = await n.product({ name: 'Tornillo 1/4', unit: 'pieza', price: 200, presentations: [{ name: 'Caja 100', factor: 100, price: 15000 }] })
  const cable = await n.product({ name: 'Cable calibre 12', unit: 'metro', price: 1500, presentations: [{ name: 'Rollo 100 m', factor: 100, price: 120000 }] })
  const pintura = await n.product({ name: 'Pintura vinílica', unit: 'litro', price: 9000 })
  await n.buy([{ productId: tornillo.id, quantity: 500, cost: 50000 }, { productId: cable.id, quantity: 200, cost: 160000 }, { productId: pintura.id, quantity: 19, cost: 114000 }])
  return { ...n, tornillo, cable, pintura }
}

describe('ferretería', () => {
  it('varias unidades con equivalencia: caja de 100 y rollo de 100 m descuentan lo correcto; granel por metro y litro', async () => {
    const { open, sell, tornillo, cable, pintura, stock } = await ferre()
    await open()
    const caja = tornillo.presentations[0].id
    const rollo = cable.presentations[0].id
    const v = await sell([{ productId: tornillo.id, presentationId: caja, quantity: 2 }, { productId: cable.id, presentationId: rollo, quantity: 1 }, { productId: cable.id, quantity: 7.5 }, { productId: pintura.id, quantity: 3.8 }])
    expect(v.json.sale.total).toBe(30000 + 120000 + 11250 + 34200)
    expect(await stock(tornillo.id)).toBe(300)
    expect(await stock(cable.id)).toBe(92.5)
    expect(await stock(pintura.id)).toBeCloseTo(15.2)
  })

  it('escalas de precio por volumen: la caja las aplica sola', async () => {
    const { s, T, open, sell, tornillo } = await ferre()
    await s.call('PUT', `/products/${tornillo.id}/price-tiers`, { token: T, body: { tiers: [{ minQuantity: 50, price: 170 }, { minQuantity: 200, price: 150 }] } })
    await open()
    expect((await sell([{ productId: tornillo.id, quantity: 10 }])).json.sale.total).toBe(2000)
    expect((await sell([{ productId: tornillo.id, quantity: 60 }])).json.sale.total).toBe(60 * 170)
    expect((await sell([{ productId: tornillo.id, quantity: 200 }])).json.sale.total).toBe(200 * 150)
  })

  it('cotización no aparta existencia; al convertirse en venta descuenta con el precio cotizado', async () => {
    const { s, T, open, tornillo, stock } = await ferre()
    const q = await s.call('POST', '/quotes', { token: T, body: { customerName: 'Constructora Ruiz', items: [{ productId: tornillo.id, quantity: 100 }, { description: 'Flete a obra', quantity: 1, unitPrice: 5000 }] } })
    expect(q.json.quote).toMatchObject({ folio: 1, total: 25000, status: 'abierta' })
    expect(await stock(tornillo.id)).toBe(500)
    // Sube el precio después de cotizar: la cotización respeta el suyo.
    await s.call('PATCH', `/products/${tornillo.id}`, { token: T, body: { price: 300, authCode: '4321' } })
    await open()
    const v = await s.call('POST', `/quotes/${q.json.quote.id}/convert`, { token: T, body: { paymentMethod: 'transferencia' } })
    expect(v.json.sale.total).toBe(25000)
    expect(await stock(tornillo.id)).toBe(400)
    expect((await s.call('POST', `/quotes/${q.json.quote.id}/convert`, { token: T, body: { paymentMethod: 'efectivo' } })).json.error.code).toBe('cotizacion_cerrada')
  })

  it('cotización con precio especial pide código; vencida no se convierte', async () => {
    const { s, T, open, tornillo } = await ferre()
    expect((await s.call('POST', '/quotes', { token: T, body: { items: [{ productId: tornillo.id, quantity: 10, unitPrice: 100 }] } })).json.error.code).toBe('codigo_requerido')
    const q = await s.call('POST', '/quotes', { token: T, body: { validDays: 1, authCode: '4321', items: [{ productId: tornillo.id, quantity: 10, unitPrice: 100 }] } })
    expect(q.json.quote.total).toBe(1000)
    s.advance(3 * 86_400_000)
    await open()
    expect((await s.call('POST', `/quotes/${q.json.quote.id}/convert`, { token: T, body: { paymentMethod: 'efectivo' } })).json.error.code).toBe('cotizacion_vencida')
  })

  it('clientes constructores: cuenta corriente; pasar el límite requiere código del dueño', async () => {
    const { s, T, open, sell, tornillo } = await ferre()
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Constructora Ruiz' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 50000 } })
    await open()
    expect((await sell([{ productId: tornillo.id, quantity: 200 }], { paymentMethod: 'fiado', customerId: cli.id })).status).toBe(201)
    expect((await sell([{ productId: tornillo.id, quantity: 200 }], { paymentMethod: 'fiado', customerId: cli.id })).json.error.code).toBe('codigo_requerido')
    expect((await sell([{ productId: tornillo.id, quantity: 200 }], { paymentMethod: 'fiado', customerId: cli.id, authCode: '4321' })).status).toBe(201)
  })

  it('clave del proveedor por producto: la compra se captura por clave', async () => {
    const { s, T, tornillo, stock } = await ferre()
    const sup = (await s.call('POST', '/suppliers', { token: T, body: { name: 'Truper' } })).json.id
    await s.call('PUT', `/products/${tornillo.id}/supplier-codes`, { token: T, body: { supplierId: sup, code: 'TR-1414' } })
    const r = await s.call('POST', '/purchases', { token: T, body: { supplierId: sup, payment: 'contado', items: [{ supplierCode: 'TR-1414', quantity: 100, cost: 9000 }] } })
    expect(r.status).toBe(201)
    expect(await stock(tornillo.id)).toBe(600)
    expect((await s.call('POST', '/purchases', { token: T, body: { supplierId: sup, payment: 'contado', items: [{ supplierCode: 'NOEXISTE', quantity: 1, cost: 1 }] } })).status).toBe(400)
  })

  it('devolución con ticket: pide código, regresa existencia y dinero de la caja; no más de lo vendido', async () => {
    const { s, T, open, sell, tornillo, stock } = await ferre()
    await open(0)
    const v = await sell([{ productId: tornillo.id, quantity: 10 }])
    const item = (await s.call('GET', `/sales/${v.json.sale.id}`, { token: T })).json.sale
    const saleItemId = (s.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(item.id) as any).id
    const body = { saleId: item.id, items: [{ saleItemId, quantity: 4 }], refundMethod: 'efectivo', reason: 'No le quedó' }
    expect((await s.call('POST', '/returns', { token: T, body })).json.error.code).toBe('codigo_requerido')
    const r = await s.call('POST', '/returns', { token: T, body: { ...body, authCode: '4321' } })
    expect(r.json.amount).toBe(800)
    expect(await stock(tornillo.id)).toBe(494)
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.expectedCash).toBe(2000 - 800)
    expect((await s.call('POST', '/returns', { token: T, body: { ...body, items: [{ saleItemId, quantity: 7 }], authCode: '4321' } })).json.error.code).toBe('devolucion_excede')
  })

  it('devolución sin ticket también requiere código; lo dañado no regresa al inventario', async () => {
    const { s, T, open, pintura, stock } = await ferre()
    await open(0)
    const body = { items: [{ productId: pintura.id, quantity: 1, amount: 9000, restock: false }], refundMethod: 'efectivo', reason: 'Cubeta golpeada' }
    expect((await s.call('POST', '/returns', { token: T, body })).json.error.code).toBe('codigo_requerido')
    expect((await s.call('POST', '/returns', { token: T, body: { ...body, authCode: '4321' } })).status).toBe(201)
    expect(await stock(pintura.id)).toBe(19)
    const log = (await s.call('GET', '/audit', { token: T })).json.entries
    expect(log.some((e: any) => e.action === 'devolucion.sin_ticket' && e.authorized_by)).toBe(true)
  })

  it('devolución de venta fiada baja la deuda', async () => {
    const { s, T, open, sell, tornillo } = await ferre()
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Don Pepe' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 100000 } })
    await open(0)
    const v = await sell([{ productId: tornillo.id, quantity: 10 }], { paymentMethod: 'fiado', customerId: cli.id })
    const saleItemId = (s.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(v.json.sale.id) as any).id
    expect((await s.call('POST', '/returns', { token: T, body: { saleId: v.json.sale.id, items: [{ saleItemId, quantity: 5 }], refundMethod: 'efectivo', reason: 'Sobró', authCode: '4321' } })).status).toBe(400)
    await s.call('POST', '/returns', { token: T, body: { saleId: v.json.sale.id, items: [{ saleItemId, quantity: 5 }], refundMethod: 'saldo', reason: 'Sobró', authCode: '4321' } })
    expect((await s.call('GET', `/customers/${cli.id}/credit`, { token: T })).json.balance).toBe(1000)
  })
})
