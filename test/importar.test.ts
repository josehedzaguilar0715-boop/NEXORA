import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('importar datos de otro sistema', () => {
  it('productos con existencia y costo, sin duplicar al repetir', async () => {
    const { s, T, stock } = await negocioListo()
    const rows = [
      { name: 'Refresco 600', barcode: '7501055300075', price: 2000, cost: 1300, stock: 24, minStock: 6, category: 'Bebidas' },
      { name: 'Frijol a granel', unit: 'kg', price: 3200, cost: 2500, stock: 12.5 },
      { name: '', price: 100 },
    ]
    const r = (await s.call('POST', '/import/products', { token: T, body: { rows } })).json
    expect(r).toMatchObject({ created: 2, updated: 0, failed: 1 })
    expect(r.results[2].message).toContain('nombre')
    const prods = (await s.call('GET', '/products', { token: T })).json.products
    const ref = prods.find((p: any) => p.name === 'Refresco 600')
    expect(await stock(ref.id)).toBe(24)
    expect((await s.call('GET', '/products/barcode/7501055300075', { token: T })).json.product.name).toBe('Refresco 600')
    // Repetir con precio nuevo y otra existencia: actualiza, no duplica.
    const again = (await s.call('POST', '/import/products', { token: T, body: { rows: [{ name: 'refresco 600', barcode: '7501055300075', price: 2200, stock: 20 }] } })).json
    expect(again).toMatchObject({ created: 0, updated: 1 })
    expect((await s.call('GET', '/products', { token: T })).json.products.filter((p: any) => p.name === 'Refresco 600')).toHaveLength(1)
    expect(await stock(ref.id)).toBe(20)
    // La mercancía importada cuenta en el balance a su costo: 20 × $13 + 12.5 × $25.
    expect((await s.call('GET', '/accounting/balance', { token: T })).json.inventory).toBe(20 * 1300 + 12.5 * 2500)
    // "Omitir" deja lo que ya existe.
    expect((await s.call('POST', '/import/products', { token: T, body: { rows: [{ name: 'Frijol a granel', price: 1 }], onExisting: 'omitir' } })).json.skipped).toBe(1)
  })

  it('clientes con su fiado y proveedores', async () => {
    const { s, T, o } = await negocioListo()
    const r = (await s.call('POST', '/import/customers', { token: T, body: { rows: [{ name: 'Doña Mari', phone: '55 1234 5678', balance: 35000 }, { name: 'Don Beto' }] } })).json
    expect(r.created).toBe(2)
    expect((await s.call('GET', '/receivables', { token: T })).json.total).toBe(35000)
    // Repetir no vuelve a cargar el saldo.
    const again = (await s.call('POST', '/import/customers', { token: T, body: { rows: [{ name: 'Mari', phone: '5512345678', balance: 35000 }] } })).json
    expect(again.updated).toBe(1)
    expect((await s.call('GET', '/receivables', { token: T })).json.total).toBe(35000)
    const sup = (await s.call('POST', '/import/suppliers', { token: T, body: { rows: [{ name: 'Coca-Cola FEMSA', phone: '800 123 4567' }, { name: 'coca-cola femsa' }] } })).json
    expect(sup).toMatchObject({ created: 1, updated: 1 })
    // Solo el dueño importa.
    const emp = await s.createStaff(T, o.business.code, 'cajera', 'cajero')
    expect((await s.call('POST', '/import/suppliers', { token: emp.token, body: { rows: [{ name: 'X proveedor' }] } })).status).toBe(403)
  })
})
