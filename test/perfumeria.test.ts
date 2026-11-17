import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function perfumeria() {
  const n = await negocioListo()
  const { s, T } = n
  await s.call('PATCH', '/business', { token: T, body: { giro: 'perfumeria' } })
  const v = (name: string, attrs: object, price: number, extra: object = {}) => n.product({ name, unit: 'pieza', price, attrs, ...extra })
  const sauvage100 = await v('Sauvage EDT 100 ml', { brand: 'Dior', fragrance: 'Sauvage', sizeMl: 100, presentation: 'regular' }, 280000, { barcode: '3348901250153' })
  const sauvage10 = await v('Sauvage decant 10 ml', { brand: 'Dior', fragrance: 'Sauvage', sizeMl: 10, presentation: 'decant' }, 45000)
  const tester = await v('Sauvage tester 100 ml', { brand: 'Dior', fragrance: 'Sauvage', sizeMl: 100, presentation: 'tester' }, 0, { sellable: false })
  const goodGirl = await v('Good Girl 80 ml', { brand: 'Carolina Herrera', fragrance: 'Good Girl', sizeMl: 80, presentation: 'regular' }, 250000)
  const atomizador = await v('Atomizador 10 ml vacío', { presentation: 'envase' }, 0, { sellable: false })
  await n.buy([{ productId: sauvage100.id, quantity: 3, cost: 540000 }, { productId: tester.id, quantity: 1, cost: 150000 }, { productId: goodGirl.id, quantity: 2, cost: 300000 }, { productId: atomizador.id, quantity: 50, cost: 5000 }])
  return { ...n, sauvage100, sauvage10, tester, goodGirl, atomizador }
}

describe('perfumería', () => {
  it('variantes por marca, fragancia, tamaño y presentación; búsqueda por marca', async () => {
    const { s, T } = await perfumeria()
    const r = (await s.call('GET', '/products?q=Dior', { token: T })).json.products
    expect(r.map((p: any) => p.attrs.sizeMl).sort()).toEqual([10, 100, 100])
    const scan = (await s.call('GET', '/products/barcode/3348901250153', { token: T })).json.product
    expect(scan.attrs).toMatchObject({ brand: 'Dior', presentation: 'regular' })
  })

  it('decants: abre un frasco, descuenta ml y crea los chicos con costo proporcional más envase', async () => {
    const { s, T, sauvage100, sauvage10, atomizador, stock } = await perfumeria()
    const d = await s.call('POST', '/decants', { token: T, body: { sourceProductId: sauvage100.id, targetProductId: sauvage10.id, quantity: 4, containerProductId: atomizador.id } })
    expect(d.json).toMatchObject({ ml: 40, openedBottles: 1, unitCost: 18000 + 100 }) // $1 800/frasco ÷ 100 ml × 10 ml + envase $1
    expect(await stock(sauvage100.id)).toBe(2)
    expect(await stock(sauvage10.id)).toBe(4)
    expect((await s.call('GET', '/open-bottles', { token: T })).json.bottles[0].mlRemaining).toBe(60)
    // Otros 8 decants: usa los 60 ml que quedan y abre otro frasco por los 20 ml restantes.
    const d2 = await s.call('POST', '/decants', { token: T, body: { sourceProductId: sauvage100.id, targetProductId: sauvage10.id, quantity: 8 } })
    expect(d2.json.openedBottles).toBe(1)
    expect(await stock(sauvage100.id)).toBe(1)
    expect((await s.call('GET', '/open-bottles', { token: T })).json.bottles[0].mlRemaining).toBe(80)
  })

  it('testers y muestras son de uso: no se venden; su gasto se registra', async () => {
    const { s, T, open, sell, tester } = await perfumeria()
    await open(0)
    expect((await sell([{ productId: tester.id, quantity: 1 }])).status).toBe(400)
    const u = await s.call('POST', '/testers/use', { token: T, body: { productId: tester.id, quantity: 1, reason: 'Tester agotado' } })
    expect(u.json.cost).toBe(150000)
  })

  it('devoluciones: solo sellados, con ticket y código; abiertos no', async () => {
    const { s, T, open, sell, goodGirl, stock } = await perfumeria()
    await open(0)
    const v = await sell([{ productId: goodGirl.id, quantity: 2 }])
    const saleItemId = (s.db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(v.json.sale.id) as any).id
    const base = { saleId: v.json.sale.id, refundMethod: 'efectivo', reason: 'No le gustó', authCode: '4321' }
    expect((await s.call('POST', '/returns', { token: T, body: { ...base, items: [{ saleItemId, quantity: 1 }] } })).json.error.code).toBe('producto_abierto')
    expect((await s.call('POST', '/returns', { token: T, body: { items: [{ productId: goodGirl.id, quantity: 1, amount: 250000, sealed: true }], refundMethod: 'efectivo', reason: 'Sin ticket', authCode: '4321' } })).json.error.code).toBe('requiere_ticket')
    expect((await s.call('POST', '/returns', { token: T, body: { ...base, items: [{ saleItemId, quantity: 1, sealed: true }] } })).status).toBe(201)
    expect(await stock(goodGirl.id)).toBe(1)
  })

  it('set con un solo precio; el empaque se descuenta como consumible', async () => {
    const { s, T, product, buy, open, sell, sauvage10, stock } = await perfumeria()
    const caja = await product({ name: 'Caja de regalo', unit: 'pieza', price: 0, sellable: false })
    const crema = await product({ name: 'Crema corporal Dior', unit: 'pieza', price: 90000, attrs: { brand: 'Dior' } })
    await buy([{ productId: caja.id, quantity: 10, cost: 3000 }, { productId: crema.id, quantity: 5, cost: 200000 }, { productId: sauvage10.id, quantity: 5, cost: 90000 }])
    const set = await product({ name: 'Set Sauvage regalo', unit: 'pieza', price: 120000, attrs: { brand: 'Dior', presentation: 'set' } })
    await s.call('PUT', `/products/${set.id}/combo`, { token: T, body: { items: [{ productId: sauvage10.id, quantity: 1 }, { productId: crema.id, quantity: 1 }] } })
    await s.call('PUT', `/recipes/${set.id}`, { token: T, body: { items: [{ productId: caja.id, quantity: 1 }] } })
    await open(0)
    const v = await sell([{ productId: set.id, quantity: 1 }])
    expect(v.json.sale.total).toBe(120000)
    expect(await stock(caja.id)).toBe(9)
    expect(await stock(crema.id)).toBe(4)
  })

  it('comisiones por asesora y por marca, sin valores predeterminados', async () => {
    const { s, o, T, open, sell, sauvage100, goodGirl } = await perfumeria()
    const asesora = await s.createStaff(T, o.business.code, 'asesora1', 'cajero')
    await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ staffId: asesora.id, targetType: 'brand', targetId: 'Dior', rateBp: 800 }] } })
    await open(0)
    await sell([{ productId: sauvage100.id, quantity: 1, staffId: asesora.id }, { productId: goodGirl.id, quantity: 1, staffId: asesora.id }])
    const com = s.db.prepare('SELECT base, amount FROM sale_commissions').all()
    expect(com).toEqual([{ base: 280000, amount: 22400 }]) // Carolina Herrera sin regla: sin comisión
  })
})
