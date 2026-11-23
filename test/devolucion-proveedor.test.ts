import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function conCompra(payment: 'contado' | 'credito') {
  const n = await negocioListo()
  const { s, T } = n
  const leche = await n.product({ name: 'Leche', unit: 'pieza', price: 3000 })
  const sup = (await s.call('POST', '/suppliers', { token: T, body: { name: 'Lácteos del Sur' } })).json
  const supId = sup.id ?? sup.supplier?.id
  const r = await s.call('POST', '/purchases', { token: T, body: { supplierId: supId, payment, items: [{ productId: leche.id, quantity: 20, cost: 40000 }] } })
  const purchase = (await s.call('GET', `/purchases/${r.json.id}`, { token: T })).json
  return { ...n, leche, purchaseId: r.json.id as string, itemId: purchase.items[0].id as string }
}

describe('devolución a proveedor', () => {
  it('a cuenta: baja existencia al costo del lote y lo que se debe; no más del saldo; con código; bitácora', async () => {
    const { s, o, T, leche, purchaseId, itemId, stock } = await conCompra('credito')
    expect((await s.call('GET', '/payables', { token: T })).json.total).toBe(40000)
    const enc = await s.createStaff(T, o.business.code, 'enc', 'encargado')
    await s.call('POST', '/auth/change-password', { token: enc.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
    const body = { items: [{ purchaseItemId: itemId, quantity: 5 }], refund: 'credito', reason: 'Venían caducadas' }
    expect((await s.call('POST', `/purchases/${purchaseId}/returns`, { token: enc.token, body })).json.error.code).toBe('codigo_requerido')
    const r = await s.call('POST', `/purchases/${purchaseId}/returns`, { token: enc.token, body: { ...body, authCode: '4321' } })
    expect(r.status).toBe(201)
    expect(r.json).toMatchObject({ amount: 10000, balance: 30000 })
    expect(await stock(leche.id)).toBe(15)
    expect((await s.call('GET', '/payables', { token: T })).json.total).toBe(30000)
    expect((await s.call('GET', '/accounting/balance', { token: T })).json.payables).toBe(30000)
    // No es merma: no baja la utilidad.
    expect((await s.call('GET', '/reports/summary', { token: T })).json.waste).toBe(0)
    expect((await s.call('GET', '/audit', { token: T })).json.entries.some((e: any) => e.action === 'compra.devolucion')).toBe(true)
  })

  it('no se devuelve más de lo que queda del lote (lo vendido ya no)', async () => {
    const { s, T, purchaseId, itemId, leche, open, sell } = await conCompra('credito')
    await open(0)
    await sell([{ productId: leche.id, quantity: 18 }])
    expect((await s.call('POST', `/purchases/${purchaseId}/returns`, { token: T, body: { items: [{ purchaseItemId: itemId, quantity: 3 }], refund: 'credito', reason: 'Dañadas' } })).json.error.code).toBe('sin_existencia')
  })

  it('compra de contado: el proveedor regresa efectivo a la caja; aparece en flujo y libro', async () => {
    const { s, T, purchaseId, itemId, open, stock, leche } = await conCompra('contado')
    const sh = (await open(5000)).json.shift
    expect((await s.call('POST', `/purchases/${purchaseId}/returns`, { token: T, body: { items: [{ purchaseItemId: itemId, quantity: 5 }], refund: 'credito', reason: 'x a cuenta' } })).json.error.code).toBe('excede_saldo')
    const r = await s.call('POST', `/purchases/${purchaseId}/returns`, { token: T, body: { items: [{ purchaseItemId: itemId, quantity: 5 }], refund: 'efectivo', reason: 'Venían caducadas' } })
    expect(r.status).toBe(201)
    expect(await stock(leche.id)).toBe(15)
    expect((await s.call('GET', `/shifts/${sh.id}`, { token: T })).json.totals.expectedCash).toBe(15000)
    const cf = (await s.call('GET', '/accounting/cash-flow', { token: T })).json
    expect(cf.inflows.find((x: any) => x.category === 'reembolsos_proveedor')).toMatchObject({ method: 'efectivo', amount: 10000 })
    expect((await s.call('GET', '/accounting/ledger', { token: T })).json.entries.some((e: any) => e.type === 'Reembolso de proveedor' && e.inflow === 10000)).toBe(true)
  })
})
