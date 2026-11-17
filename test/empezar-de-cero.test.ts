import { describe, expect, it } from 'vitest'
import { STEPS } from '../src/reset.js'
import { negocioListo } from './helpers.js'

describe('empezar de cero (borrar datos de prueba)', () => {
  it('borra ventas y movimientos de prueba, regresa el inventario y no toca otros negocios', async () => {
    const { s, T, o, product, buy, open, sell, stock } = await negocioListo()
    const coca = await product({ name: 'Coca 600', unit: 'pieza', price: 2000 })
    await buy([{ productId: coca.id, quantity: 10, cost: 10000 }])
    const shift = (await open(50000)).json.shift
    await sell([{ productId: coca.id, quantity: 3 }])
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Doña Mari' } })).json.customer
    await s.call('PUT', `/customers/${cli.id}/credit-limit`, { token: T, body: { limit: 100000 } })
    await sell([{ productId: coca.id, quantity: 1 }], { paymentMethod: 'fiado', customerId: cli.id })
    await s.call('POST', '/layaways', { token: T, body: { customerId: cli.id, items: [{ productId: coca.id, quantity: 2 }], deposit: 1000, method: 'efectivo' } })
    await s.call('POST', '/expenses', { token: T, body: { concept: 'Bolsas', amount: 2500, kind: 'variable', method: 'efectivo', fromCash: true } })
    await s.call('POST', `/shifts/${shift.id}/cash-movements`, { token: T, body: { type: 'retiro', amount: 1000, reason: 'prueba' } })
    expect(await stock(coca.id)).toBe(6)

    // Otro negocio con su venta: no se toca.
    const otro = await s.registerOwner('5598881234')
    await s.call('PATCH', '/business', { token: otro.token, body: { forcePasswordChange: false } })
    const r2 = await s.call('POST', '/products', { token: otro.token, body: { name: 'Pan', unit: 'pieza', price: 500 } })
    const p2 = r2.json.product
    if (!p2) throw new Error(JSON.stringify(r2.json))
    await s.call('POST', '/purchases', { token: otro.token, body: { payment: 'contado', items: [{ productId: p2.id, quantity: 5, cost: 1000 }] } })
    await s.call('POST', '/shifts/open', { token: otro.token, body: { openingFloat: 0 } })
    await s.call('POST', '/sales', { token: otro.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ productId: p2.id, quantity: 1 }] } })

    // Solo el dueño, con su código y escribiendo BORRAR.
    const cajero = await s.createStaff(T, o.business.code, 'cajero1', 'cajero')
    expect((await s.call('POST', '/business/reset-demo', { token: cajero.token, body: { confirm: 'BORRAR', authCode: '4321' } })).status).toBe(403)
    expect((await s.call('POST', '/business/reset-demo', { token: T, body: { confirm: 'si', authCode: '4321' } })).status).toBe(400)
    expect((await s.call('POST', '/business/reset-demo', { token: T, body: { confirm: 'BORRAR', authCode: '0000' } })).status).toBe(403)
    const r = await s.call('POST', '/business/reset-demo', { token: T, body: { confirm: 'borrar', authCode: '4321' } })
    expect(r.status).toBe(200)
    expect(r.json.sales).toBe(2)

    // Sin ventas, sin caja abierta, sin fiado, sin gastos ni apartados; el inventario regresa a lo comprado.
    expect((await s.call('GET', '/reports/summary', { token: T })).json.sales.total).toBe(0)
    expect((await s.call('GET', '/receivables', { token: T })).json.total).toBe(0)
    expect((await s.call('GET', '/layaways', { token: T })).json.layaways).toHaveLength(0)
    expect(await stock(coca.id)).toBe(10)
    expect((await s.call('GET', `/products/${coca.id}`, { token: T })).json.product.reserved).toBe(0)
    // Se queda: productos, clientes y personal.
    expect((await s.call('GET', '/customers', { token: T })).json.customers.some((c: any) => c.id === cli.id)).toBe(true)
    // Se vuelve a abrir caja y el folio empieza en 1.
    expect((await open(20000)).status).toBe(201)
    const v = await sell([{ productId: coca.id, quantity: 1 }])
    expect(v.json.sale.folio).toBe(1)
    // Los candados siguen puestos: una venta no se puede borrar suelta.
    expect(() => s.db.prepare('DELETE FROM sales WHERE id = ?').run(v.json.sale.id)).toThrow(/no se pueden borrar/)
    // El otro negocio sigue igual.
    expect((await s.call('GET', '/reports/summary', { token: otro.token })).json.sales.total).toBe(500)
    // Queda en la bitácora.
    expect(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'negocio.empezar_de_cero'").get()).toMatchObject({ n: 1 })
  })

  it('cubre toda tabla que apunta a ventas o turnos (si se agrega una nueva, hay que incluirla)', async () => {
    const { s } = await negocioListo()
    const tables = (s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name)
    const covered = new Set(STEPS.map(([, sql]) => /^(?:DELETE FROM|UPDATE) (\w+)/.exec(sql)![1]))
    const missing = tables.filter((t) => (s.db.prepare(`SELECT "table" FROM pragma_foreign_key_list('${t}')`).all() as { table: string }[]).some((f) => ['sales', 'shifts', 'tabs', 'layaways', 'returns', 'customer_memberships'].includes(f.table)) && !covered.has(t))
    expect(missing).toEqual([])
  })

  it('soporte lo puede hacer desde el super panel con motivo', async () => {
    const { s, T, o, product, buy, open, sell } = await negocioListo()
    const p = await product({ name: 'Pan', unit: 'pieza', price: 500 })
    await buy([{ productId: p.id, quantity: 5, cost: 1000 }])
    await open(0)
    await sell([{ productId: p.id, quantity: 2 }])
    const at = await s.adminToken()
    expect((await s.call('POST', `/admin/businesses/${o.business.id}/reset-demo`, { token: at, body: { confirm: 'no', reason: 'demo' } })).status).toBe(400)
    const r = await s.call('POST', `/admin/businesses/${o.business.id}/reset-demo`, { token: at, body: { confirm: 'BORRAR', reason: 'Terminó la demostración' } })
    expect(r.json.sales).toBe(1)
    expect((await s.call('GET', '/reports/summary', { token: T })).json.sales.total).toBe(0)
  })
})
