import { describe, expect, it } from 'vitest'
import { ticketText } from '../src/sales.js'
import { dosSucursales } from './sucursales-fixture.js'
import { negocioListo } from './helpers.js'

describe('ticket: 58 mm y 80 mm, folio, reimpresión y «no es factura»', () => {
  it('ningún renglón pasa del ancho; los nombres largos pasan a otra línea sin perder el importe', () => {
    const t = { business: 'Abarrotes Doña Esperanza y Familia de la Colonia Centro', branch: 'Centro', phone: '5511112222', folio: '000007', date: '2026-11-24T18:30:00.000Z', items: [{ description: 'Aceite comestible vegetal de girasol botella familiar 946 ml', quantity: 2, total: 12_800 }, { description: 'Pan', quantity: 1, total: 500 }], subtotal: 13_300, discount: 300, total: 13_000, paymentMethod: 'efectivo', payments: [{ method: 'efectivo', amount: 13_000 }], cashReceived: 20_000, change: 7_000, cashier: 'Lupita Hernández Soto', cancelled: false }
    for (const W of [32, 48]) {
      const out = ticketText(t, W)
      for (const l of out.split('\n')) expect(l.length, `${W}: «${l}»`).toBeLessThanOrEqual(W)
      expect(out).toContain('$128.00')
      expect(out).toContain('Folio 000007')
      expect(out).toContain('Sucursal Centro')
      expect(out.replace(/\s+/g, ' ')).toMatch(/No es una factura \(CFDI\)/)
      expect(out).toContain('TOTAL')
      expect(out).toContain('Cambio')
      expect(out).toContain('Atendió: Lupita')
    }
    expect(ticketText(t, 48).split('\n').length).toBeLessThan(ticketText(t, 32).split('\n').length) // 80 mm necesita menos líneas
    expect(ticketText({ ...t, reprint: true }, 32)).toContain('REIMPRESIÓN')
    expect(ticketText({ ...t, cancelled: true }, 32)).toContain('CANCELADO')
  })

  it('el ticket de una venta trae folio consecutivo, ancho según el papel, reimpresión y sucursal solo si hay varias', async () => {
    const { s, T, product, buy, open, sell } = await negocioListo()
    const p = await product({ name: 'Refresco', unit: 'pieza', price: 2000 })
    await buy([{ productId: p.id, quantity: 10, cost: 10_000 }])
    await open(10_000)
    const v1 = (await sell([{ productId: p.id, quantity: 1 }])).json.sale
    const v2 = (await sell([{ productId: p.id, quantity: 2 }])).json.sale
    const t1 = (await s.call('GET', `/sales/${v1.id}/ticket`, { token: T })).json
    const t2 = (await s.call('GET', `/sales/${v2.id}/ticket?paper=80&reprint=1`, { token: T })).json
    expect(t1.ticket.folio).toBe('000001')
    expect(t2.ticket.folio).toBe('000002')
    expect(t1.ticket.paper).toBe(58)
    expect(t2.ticket.paper).toBe(80)
    expect(Math.max(...t1.text.split('\n').map((l: string) => l.length))).toBeLessThanOrEqual(32)
    expect(Math.max(...t2.text.split('\n').map((l: string) => l.length))).toBeLessThanOrEqual(48)
    expect(t2.text).toContain('REIMPRESIÓN')
    expect(t1.text).not.toContain('REIMPRESIÓN')
    expect(t1.text).not.toContain('Sucursal ') // una sola sucursal
    expect(t1.text.replace(/\s+/g, ' ')).toContain('No es una factura (CFDI)')
  })

  it('con varias sucursales el ticket nombra la sucursal y el folio es consecutivo por sucursal', async () => {
    const f = await dosSucursales()
    const t = (await f.s.call('GET', `/sales/${f.sale1a.id}/ticket`, { token: f.T })).json
    expect(t.text).toContain('Sucursal ')
    expect(t.ticket.branch).toBeTruthy()
  })

  it('comprobante digital: enlace privado reutilizable, sin datos del cliente, con leyenda de «no es factura»; otro empleado no puede crearlo', async () => {
    const f = await dosSucursales()
    const a = (await f.s.call('POST', `/sales/${f.sale1a.id}/receipt-link`, { token: f.e1a.token })).json
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect((await f.s.call('POST', `/sales/${f.sale1a.id}/receipt-link`, { token: f.T })).json.token).toBe(a.token) // se reutiliza
    const pub = await f.s.call('GET', `/public/receipt/${a.token}`) // sin sesión
    expect(pub.status).toBe(200)
    expect(pub.json.receipt.folio).toMatch(/^\d{6}$/)
    expect(pub.json.legend).toMatch(/No es una factura \(CFDI\)/)
    const txt = JSON.stringify(pub.json).toLowerCase()
    for (const k of ['customer', 'permissions', 'password', 'username', 'business_id', 'cashier_id']) expect(txt).not.toContain(k)
    expect((await f.s.call('GET', '/public/receipt/inventado')).status).toBe(404)
    // Un empleado no puede generar el comprobante de la venta de un compañero.
    expect((await f.s.call('POST', `/sales/${f.sale1a.id}/receipt-link`, { token: f.e1b.token })).status).toBe(403)
  })
})
