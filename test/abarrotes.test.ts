import { describe, expect, it } from 'vitest'
import { splitProportional } from '../src/inventory.js'
import { setup } from './helpers.js'

async function tienda() {
  const s = setup()
  const o = await s.registerOwner()
  const T = o.token
  await s.call('PATCH', '/business', { token: T, body: { forcePasswordChange: false, phone: '5511112222' } })
  const me = (await s.call('GET', '/auth/me', { token: T })).json.user
  await s.call('PUT', `/users/${me.id}/auth-code`, { token: T, body: { code: '4321' } })
  const cat = (await s.call('POST', '/categories', { token: T, body: { name: 'Bebidas', marginBp: 3000 } })).json.id
  const refresco = (await s.call('POST', '/products', { token: T, body: { name: 'Refresco 600', unit: 'pieza', price: 1500, categoryId: cat, barcode: '7501000000011', minStock: 5, presentations: [{ name: 'Paquete 6', factor: 6, price: 8000, barcode: '7501000000066' }] } })).json.product
  const jamon = (await s.call('POST', '/products', { token: T, body: { name: 'Jamón', unit: 'kg', price: 20000, trackExpiry: true } })).json.product
  const buy = (items: any[], extra: object = {}) => s.call('POST', '/purchases', { token: T, body: { payment: 'contado', items, ...extra } })
  const open = () => s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 10000 } })
  const sell = (items: any[], extra: object = {}) => s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', items, ...extra } })
  const product = async (id: string) => (await s.call('GET', `/products/${id}`, { token: T })).json.product
  return { s, o, T, me, cat, refresco, jamon, buy, open, sell, product }
}

describe('compras, fletes y costo real', () => {
  it('reparte fletes por pieza y por kilo; el costo del lote los incluye; sugiere precio con margen', async () => {
    const { buy, refresco, jamon, product } = await tienda()
    const r = await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }, { productId: jamon.id, quantity: 2, cost: 30000, expiresAt: '2026-11-25' }], { freight: [{ concept: 'Gasolina', amount: 800 }, { concept: 'Casetas', amount: 400 }] })
    expect(r.status).toBe(201)
    expect(r.json.freightTotal).toBe(1200)
    expect(r.json.items[0]).toMatchObject({ freightShare: 1000, realCost: 11000, unitCost: 1100, suggestedPrice: 1430 })
    expect(r.json.items[1]).toMatchObject({ freightShare: 200, unitCost: 15100, suggestedPrice: null }) // sin margen no hay sugerencia
    expect((await product(refresco.id)).stock).toBe(10)
  })

  it('reparto exacto: la suma de las partes es el total', () => {
    expect(splitProportional(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(splitProportional(0, [5, 5])).toEqual([0, 0])
  })

  it('agrega productos nuevos desde el ticket de compra', async () => {
    const { buy, s, T } = await tienda()
    const r = await buy([{ newProduct: { name: 'Galletas', unit: 'pieza', price: 1200 }, quantity: 24, cost: 19200 }])
    expect(r.status).toBe(201)
    const list = (await s.call('GET', '/products?q=Galletas', { token: T })).json.products
    expect(list[0]).toMatchObject({ name: 'Galletas', stock: 24, lastCost: 800 })
  })
})

describe('ventas de abarrotes', () => {
  it('lotes con precio: se vende primero el lote viejo y el precio nuevo entra solo', async () => {
    const { buy, open, sell, refresco, product } = await tienda()
    await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }])
    await buy([{ productId: refresco.id, quantity: 10, cost: 12000, newPrice: 1800 }])
    expect((await product(refresco.id)).price).toBe(1500)
    await open()
    const v = await sell([{ productId: refresco.id, quantity: 12 }])
    expect(v.json.sale.total).toBe(10 * 1500 + 2 * 1800)
    expect((await product(refresco.id)).price).toBe(1800)
    expect((await product(refresco.id)).stock).toBe(8)
  })

  it('pieza, paquete y granel por kilo o por importe', async () => {
    const { buy, open, sell, refresco, jamon, product, s, T } = await tienda()
    await buy([{ productId: refresco.id, quantity: 24, cost: 24000 }, { productId: jamon.id, quantity: 3, cost: 45000 }])
    await open()
    const code = (await s.call('GET', '/products/barcode/7501000000066', { token: T })).json
    expect(code.presentationId).toBeTruthy()
    const v = await sell([
      { productId: refresco.id, presentationId: code.presentationId, quantity: 1 },
      { productId: refresco.id, quantity: 2 },
      { productId: jamon.id, quantity: 0.5 }, // báscula
      { productId: jamon.id, amount: 5000 }, // "dame $50 de jamón"
    ])
    expect(v.json.sale.items.map((i: any) => i.total)).toEqual([8000, 3000, 10000, 5000])
    expect(v.json.sale.total).toBe(26000)
    expect((await product(refresco.id)).stock).toBe(24 - 6 - 2)
    expect((await product(jamon.id)).stock).toBe(3 - 0.5 - 0.25)
    expect((await sell([{ productId: refresco.id, quantity: 1.5 }])).status).toBe(400) // pieza entera
    expect((await sell([{ productId: refresco.id, amount: 500 }])).status).toBe(400)
  })

  it('efectivo recibido y cambio en el ticket, con centavos exactos', async () => {
    const { buy, open, sell, jamon, s, T } = await tienda()
    await buy([{ productId: jamon.id, quantity: 1, cost: 15000 }])
    await open()
    const v = await sell([{ productId: jamon.id, quantity: 0.337 }], { cashReceived: 10000 })
    expect(v.json.sale.total).toBe(6740)
    expect(v.json.sale.change).toBe(3260)
    expect((await sell([{ productId: jamon.id, quantity: 0.5 }], { cashReceived: 100 })).json.error.code).toBe('efectivo_insuficiente')
    const t = await s.call('GET', `/sales/${v.json.sale.id}/ticket`, { token: T })
    expect(t.json.text).toContain('$67.40')
  })

  it('cambiar el precio en caja pide permiso y código, y queda en bitácora', async () => {
    const { buy, open, sell, refresco, s, T } = await tienda()
    await buy([{ productId: refresco.id, quantity: 5, cost: 5000 }])
    await open()
    expect((await sell([{ productId: refresco.id, quantity: 1, unitPrice: 1000 }])).json.error.code).toBe('codigo_requerido')
    const ok = await sell([{ productId: refresco.id, quantity: 1, unitPrice: 1000 }], { authCode: '4321' })
    expect(ok.json.sale.total).toBe(1000)
    const log = (await s.call('GET', '/audit', { token: T })).json.entries
    expect(log.some((e: any) => e.action === 'venta.cambio_precio' && e.authorized_by)).toBe(true)
  })

  it('cambiar el precio del producto pide código y aplica al lote en existencia', async () => {
    const { buy, refresco, s, T, product } = await tienda()
    await buy([{ productId: refresco.id, quantity: 5, cost: 5000 }])
    expect((await s.call('PATCH', `/products/${refresco.id}`, { token: T, body: { price: 1700 } })).json.error.code).toBe('codigo_requerido')
    await s.call('PATCH', `/products/${refresco.id}`, { token: T, body: { price: 1700, authCode: '4321' } })
    expect((await product(refresco.id)).price).toBe(1700)
  })

  it('cancelar devuelve la existencia a su lote', async () => {
    const { buy, open, sell, refresco, s, T, product } = await tienda()
    await buy([{ productId: refresco.id, quantity: 5, cost: 5000 }])
    await open()
    const v = await sell([{ productId: refresco.id, quantity: 3 }])
    await s.call('POST', `/sales/${v.json.sale.id}/cancel`, { token: T, body: { reason: 'Se equivocó', authCode: '4321' } })
    expect((await product(refresco.id)).stock).toBe(5)
    const lots = (await s.call('GET', `/products/${refresco.id}/lots`, { token: T })).json.lots
    expect(lots[0].remaining).toBe(5)
  })

  it('sin existencia registrada la venta no se rechaza (puede venir de una caja sin señal): queda en negativo', async () => {
    const { open, sell, refresco, product, s, T } = await tienda()
    await open()
    expect((await sell([{ productId: refresco.id, quantity: 2 }])).status).toBe(201)
    expect((await product(refresco.id)).stock).toBe(-2)
    expect((await s.call('GET', '/inventory/low-stock', { token: T })).json.products[0].name).toBe('Refresco 600')
  })
})

describe('fiado', () => {
  it('límite, código del dueño para pasarlo, abonos que entran al corte', async () => {
    const { s, o, T, open, sell } = await tienda()
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 10000 } })
    // Un encargado con código no puede autorizar pasar el límite: solo el dueño.
    const enc = await s.createStaff(T, o.business.code, 'encargada', 'encargado')
    await s.call('PUT', `/users/${enc.id}/auth-code`, { token: T, body: { code: '7777' } })
    const shift = (await open()).json.shift
    expect((await sell([{ description: 'Despensa', quantity: 1, unitPrice: 8000 }], { paymentMethod: 'fiado' })).json.error.message).toContain('cliente')
    expect((await sell([{ description: 'Despensa', quantity: 1, unitPrice: 8000 }], { paymentMethod: 'fiado', customerId: cli.id })).status).toBe(201)
    expect((await sell([{ description: 'Leche', quantity: 1, unitPrice: 5000 }], { paymentMethod: 'fiado', customerId: cli.id })).json.error.code).toBe('codigo_requerido')
    expect((await sell([{ description: 'Leche', quantity: 1, unitPrice: 5000 }], { paymentMethod: 'fiado', customerId: cli.id, authCode: '7777' })).status).toBe(403)
    expect((await sell([{ description: 'Leche', quantity: 1, unitPrice: 5000 }], { paymentMethod: 'fiado', customerId: cli.id, authCode: '4321' })).status).toBe(201)
    let cr = (await s.call('GET', `/customers/${cli.id}/credit`, { token: T })).json
    expect(cr).toMatchObject({ balance: 13000, limit: 10000, available: 0 })
    await s.call('POST', `/customers/${cli.id}/credit-payments`, { token: T, body: { amount: 3000, method: 'efectivo' } })
    cr = (await s.call('GET', `/customers/${cli.id}/credit`, { token: T })).json
    expect(cr.balance).toBe(10000)
    const cur = (await s.call('GET', '/shifts/current', { token: T })).json.totals
    expect(cur.expectedCash).toBe(10000 + 3000) // fondo + abono; lo fiado no es efectivo
    expect(cur.creditSales).toBe(13000)
    expect((await s.call('POST', `/customers/${cli.id}/credit-payments`, { token: T, body: { amount: 999999, method: 'transferencia' } })).status).toBe(400)
    expect((await s.call('GET', '/receivables', { token: T })).json.total).toBe(10000)
    expect(shift).toBeTruthy()
  })
})

describe('inventario', () => {
  it('merma con motivo, caducidad por lote y alerta de por vencer', async () => {
    const { buy, jamon, s, T, product } = await tienda()
    await buy([{ productId: jamon.id, quantity: 2, cost: 30000, expiresAt: '2026-11-20' }])
    const exp = (await s.call('GET', '/inventory/expiring?days=7', { token: T })).json.lots
    expect(exp[0]).toMatchObject({ name: 'Jamón', remaining: 2, expired: false })
    expect((await s.call('POST', '/inventory/waste', { token: T, body: { productId: jamon.id, quantity: 0.4 } })).status).toBe(400) // sin motivo
    const w = await s.call('POST', '/inventory/waste', { token: T, body: { productId: jamon.id, quantity: 0.4, reason: 'Se echó a perder' } })
    expect(w.json.cost).toBe(6000)
    expect((await product(jamon.id)).stock).toBe(1.6)
  })

  it('conteo físico ajusta la existencia', async () => {
    const { buy, refresco, s, T, product } = await tienda()
    await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }])
    const r = await s.call('POST', '/inventory/count', { token: T, body: { productId: refresco.id, counted: 8, reason: 'Conteo de cierre' } })
    expect(r.json.difference).toBe(-2)
    expect((await product(refresco.id)).stock).toBe(8)
  })

  it('traspaso entre sucursales conserva costo y precio', async () => {
    const { s, T, buy, refresco } = await tienda()
    const a = await s.adminToken()
    const bizId = (await s.call('GET', '/admin/businesses', { token: a })).json.businesses[0].id
    await s.call('PATCH', `/admin/businesses/${bizId}`, { token: a, body: { extraBranches: 1 } })
    const centro = (await s.call('POST', '/branches', { token: T, body: { name: 'Centro' } })).json.branch.id
    const principal = (await s.call('GET', '/branches', { token: T })).json.branches[0].id
    await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }])
    expect((await s.call('POST', '/inventory/transfers', { token: T, body: { fromBranchId: principal, toBranchId: centro, items: [{ productId: refresco.id, quantity: 20 }] } })).json.error.code).toBe('sin_existencia')
    await s.call('POST', '/inventory/transfers', { token: T, body: { fromBranchId: principal, toBranchId: centro, items: [{ productId: refresco.id, quantity: 4 }] } })
    const there = (await s.call('GET', `/products/${refresco.id}?branchId=${centro}`, { token: T })).json.product
    expect(there.stock).toBe(4)
    const lots = (await s.call('GET', `/products/${refresco.id}/lots?branchId=${centro}`, { token: T })).json.lots
    expect(lots[0]).toMatchObject({ unitCost: 1000, price: 1500 })
    expect((await s.call('GET', `/products/${refresco.id}`, { token: T })).json.product.stock).toBe(6)
  })

  it('código de barras único por negocio', async () => {
    const { s, T } = await tienda()
    const r = await s.call('POST', '/products', { token: T, body: { name: 'Otro', unit: 'pieza', price: 100, barcode: '7501000000066' } })
    expect(r.json.error.code).toBe('codigo_barras_repetido')
  })

  it('dos equipos cambian el mismo producto sin conexión: gana el más reciente y queda conflicto', async () => {
    const { s, T, refresco } = await tienda()
    const v = refresco.version
    const a = await s.call('PATCH', `/products/${refresco.id}`, { token: T, body: { name: 'Refresco A', baseVersion: v, updatedAt: '2026-11-17T10:00:00.000Z', deviceId: 'caja-1' } })
    expect(a.json.status).toBe('aplicado')
    const b = await s.call('PATCH', `/products/${refresco.id}`, { token: T, body: { name: 'Refresco B', baseVersion: v, updatedAt: '2026-11-17T09:00:00.000Z', deviceId: 'caja-2' } })
    expect(b.json.status).toBe('conflicto_pierde')
    expect(b.json.product.name).toBe('Refresco A')
    const conf = (await s.call('GET', '/sync/conflicts', { token: T })).json.conflicts
    expect(conf[0]).toMatchObject({ entity: 'producto', winner_device: 'caja-1', loser_device: 'caja-2' })
  })
})

describe('proveedores, cuentas por pagar y gastos', () => {
  it('compra a crédito, abono desde caja que baja el efectivo esperado', async () => {
    const { s, T, refresco, open } = await tienda()
    const sup = (await s.call('POST', '/suppliers', { token: T, body: { name: 'Distribuidora Norte' } })).json.id
    const p = await s.call('POST', '/purchases', { token: T, body: { supplierId: sup, payment: 'credito', dueDate: '2026-12-01', ticketRef: 'F-123', items: [{ productId: refresco.id, quantity: 12, cost: 12000 }] } })
    expect(p.json.balance).toBe(12000)
    expect((await s.call('GET', '/payables', { token: T })).json.total).toBe(12000)
    await open()
    await s.call('POST', `/purchases/${p.json.id}/payments`, { token: T, body: { amount: 5000, method: 'efectivo', fromCash: true } })
    expect((await s.call('GET', '/payables', { token: T })).json.total).toBe(7000)
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.expectedCash).toBe(10000 - 5000)
  })

  it('gasto pagado de la caja se descuenta del efectivo esperado', async () => {
    const { s, T, open } = await tienda()
    await open()
    await s.call('POST', '/expenses', { token: T, body: { concept: 'Bolsas', amount: 2500, kind: 'variable', method: 'efectivo', fromCash: true } })
    expect((await s.call('GET', '/shifts/current', { token: T })).json.totals.expectedCash).toBe(7500)
  })
})

describe('reportes y retiro sugerido', () => {
  it('utilidad = ventas − costo − mermas − gastos; retiro = utilidad − reserva − reposición', async () => {
    const { s, T, buy, open, sell, refresco } = await tienda()
    await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }]) // costo 1000 c/u, mínimo 5
    await open()
    await sell([{ productId: refresco.id, quantity: 8 }]) // 12000 venta, 8000 costo → queda 2, faltan 3
    await s.call('POST', '/expenses', { token: T, body: { concept: 'Luz', amount: 1000, kind: 'fijo', method: 'transferencia' } })
    const r = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(r).toMatchObject({ costOfSales: 8000, grossProfit: 4000, expenses: 1000, profit: 3000 })
    expect(r.sales.total).toBe(12000)
    expect(r.topProducts[0].description).toBe('Refresco 600')

    const noDays = (await s.call('GET', '/reports/suggested-withdrawal', { token: T })).json
    expect(noDays.suggested).toBeNull()
    await s.call('POST', '/fixed-expenses', { token: T, body: { concept: 'Renta', monthlyAmount: 3650 } })
    await s.call('PUT', '/reserve-days', { token: T, body: { days: 10 } })
    const w = (await s.call('GET', '/reports/suggested-withdrawal', { token: T })).json
    expect(w).toMatchObject({ profit: 3000, reserve: 1200, restock: 3000, suggested: 0 }) // 3000 − 1200 − 3000 < 0 → 0
  })
})

describe('cajas', () => {
  it('cada cajero en su caja asignada; una caja no abre dos turnos', async () => {
    const { s, o, T } = await tienda()
    const reg = (await s.call('POST', '/registers', { token: T, body: { name: 'Caja 1' } })).json.id
    const a = await s.createStaff(T, o.business.code, 'cajera1', 'cajero')
    const b = await s.createStaff(T, o.business.code, 'cajera2', 'cajero')
    await s.call('PUT', `/users/${a.id}/register`, { token: T, body: { registerId: reg } })
    await s.call('PUT', `/users/${b.id}/register`, { token: T, body: { registerId: reg } })
    expect((await s.call('POST', '/shifts/open', { token: a.token, body: { openingFloat: 0 } })).status).toBe(201)
    expect((await s.call('POST', '/shifts/open', { token: b.token, body: { openingFloat: 0 } })).json.error.code).toBe('caja_ocupada')
  })
})

describe('inicio (dashboard)', () => {
  it('ventas por día y movimientos recientes', async () => {
    const { s, T, buy, open, sell, refresco } = await tienda()
    await buy([{ productId: refresco.id, quantity: 10, cost: 10000 }])
    await open()
    await sell([{ productId: refresco.id, quantity: 2 }])
    const d = (await s.call('GET', '/reports/daily?days=7', { token: T })).json.days
    expect(d).toHaveLength(7)
    expect(d[6]).toMatchObject({ date: '2026-11-17', total: 3000, tickets: 1 })
    const m = (await s.call('GET', '/reports/recent', { token: T })).json.movements
    expect(m.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['venta', 'compra']))
  })
})
