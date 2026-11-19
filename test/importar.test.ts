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

  it('clientes con los sellos que ya traían, sin duplicarlos al repetir', async () => {
    const { s, T } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    // Solo los inscritos: los importados con sellos (aunque sean 0) quedan inscritos.
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'por_persona', dailyCap: 3 } })
    const rows = [{ name: 'Yosmar Zamorano', phone: '529631725190', stamps: 2 }, { name: 'Alexis Zamorano', phone: '9631366514', stamps: 3 }, { name: 'Urizar Vazques', phone: '9632270744', stamps: 0 }]
    expect((await s.call('POST', '/import/customers', { token: T, body: { rows } })).json).toMatchObject({ created: 3 })
    expect((await s.call('POST', '/import/customers', { token: T, body: { rows } })).json).toMatchObject({ updated: 3 })
    const list = (await s.call('GET', '/customers', { token: T })).json.customers
    const y = list.find((c: any) => c.name === 'Yosmar Zamorano')
    expect(y.phone).toBe('9631725190')
    const pub = (await s.call('GET', `/public/loyalty/${y.code}`)).json
    expect(pub.balance).toBe(2)
    expect(pub.history[0]).toMatchObject({ reason: 'importado', delta: 2 })
    const u0 = list.find((c: any) => c.name === 'Urizar Vazques')
    expect(u0.loyaltyEnrolled).toBe(1)
    expect((await s.call('GET', `/public/loyalty/${u0.code}`)).json.balance).toBe(0)
    // Los sellos importados no cuentan para el tope del día.
    await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 0 } })
    const sv = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const r = await s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', customerId: y.id, items: [{ serviceId: sv.id, quantity: 1 }] } })
    expect(r.json.loyalty).toMatchObject({ earned: 1, balance: 3 })
  })

  it('historial de sellos con fechas originales: reemplaza el saldo cargado de golpe y no duplica', async () => {
    const { s, T } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'por_persona', dailyCap: 3 } })
    // Antes se importaron con su saldo de golpe: Miguel 2, Yosmar 1.
    await s.call('POST', '/import/customers', { token: T, body: { rows: [{ name: 'Miguel Zamorano', phone: '9631745279', stamps: 2 }, { name: 'Yosmar Zamorano', phone: '9631725190', stamps: 1 }] } })
    const rows = [
      { ref: 'S-1', name: 'Miguel Zamorano', phone: '529631745279', date: '2026-10-28T16:49:35.707Z', stamps: 1, note: 'Saldo anterior' },
      { ref: 'S-2', name: 'Miguel Zamorano', phone: '529631745279', date: '2026-10-28T16:49:35.707Z', stamps: 1, note: 'Saldo anterior' },
      { ref: 'S-3', name: 'Yosmar Zamorano', phone: '9631725190', date: '25/10/2026', stamps: 1, note: 'Servicio' },
      { ref: 'S-4', name: 'Cliente Nuevo', phone: '9630001111', date: '2026-11-05', stamps: 1, note: 'Compra de productos' },
      { ref: 'S-5', name: 'Mal Fecha', date: 'ayer', stamps: 1 },
    ]
    const r = (await s.call('POST', '/import/stamps', { token: T, body: { rows } })).json
    expect(r).toMatchObject({ created: 4, failed: 1 })
    const bal = async (name: string) => {
      const c = (await s.call('GET', '/customers', { token: T })).json.customers.find((x: any) => x.name === name)
      return (await s.call('GET', `/public/loyalty/${c.code}`)).json
    }
    // Los mismos totales, ahora con detalle y fechas (no 2 + 2).
    const mig = await bal('Miguel Zamorano')
    expect(mig.balance).toBe(2)
    expect(mig.history.map((h: any) => h.at.slice(0, 10))).toEqual(['2026-10-28', '2026-10-28'])
    expect((await bal('Yosmar Zamorano')).history[0].at.slice(0, 10)).toBe('2026-10-25')
    // Un cliente que no existía se crea inscrito.
    expect((await bal('Cliente Nuevo')).balance).toBe(1)
    // Repetir el archivo no duplica.
    expect((await s.call('POST', '/import/stamps', { token: T, body: { rows: rows.slice(0, 4) } })).json).toMatchObject({ created: 0, skipped: 4 })
    expect((await bal('Miguel Zamorano')).balance).toBe(2)
    // Los sellos del historial no cuentan para el máximo de hoy.
    const cid = (await s.call('GET', '/customers', { token: T })).json.customers.find((x: any) => x.name === 'Miguel Zamorano').code
    expect((await s.call('POST', '/scan', { token: T, body: { code: cid, action: 'sello' } })).json.loyalty).toMatchObject({ earned: 1, balance: 3 })
  })
})
