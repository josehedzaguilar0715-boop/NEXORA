import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

async function negocio() {
  const s = setup()
  const o = await s.registerOwner()
  await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false, phone: '5511112222' } })
  await s.call('PUT', `/users/${(await s.call('GET', '/users', { token: o.token })).json.users[0].id}/auth-code`, { token: o.token, body: { code: '4321' } })
  const cajero = await s.createStaff(o.token, o.business.code, 'caja1', 'cajero')
  return { s, o, cajero }
}
const venta = (s: ReturnType<typeof setup>, extra = {}) => ({
  id: s.uuid(), paymentMethod: 'efectivo', items: [{ description: 'Refresco', quantity: 2, unitPrice: 1850 }], ...extra,
})

describe('caja, ventas y corte', () => {
  it('sin fondo inicial no se vende', async () => {
    const { s, cajero } = await negocio()
    const r = await s.call('POST', '/sales', { token: cajero.token, body: venta(s) })
    expect(r.status).toBe(409)
    expect(r.json.error.code).toBe('caja_cerrada')
  })

  it('corte: fondo + efectivo − retiros + depósitos; diferencia pide motivo', async () => {
    const { s, cajero } = await negocio()
    const sh = await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 50000 } })
    const id = sh.json.shift.id
    expect((await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 1 } })).status).toBe(409)
    await s.call('POST', '/sales', { token: cajero.token, body: venta(s) }) // 3700 efectivo
    await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { paymentMethod: 'tarjeta' }) }) // no es efectivo
    await s.call('POST', `/shifts/${id}/movements`, { token: cajero.token, body: { type: 'retiro', amount: 10000, reason: 'Pago proveedor' } })
    await s.call('POST', `/shifts/${id}/movements`, { token: cajero.token, body: { type: 'deposito', amount: 2000, reason: 'Cambio' } })
    const cur = await s.call('GET', '/shifts/current', { token: cajero.token })
    expect(cur.json.totals.expectedCash).toBe(50000 + 3700 - 10000 + 2000)
    const noReason = await s.call('POST', `/shifts/${id}/close`, { token: cajero.token, body: { countedCash: 45000 } })
    expect(noReason.status).toBe(400)
    const closed = await s.call('POST', `/shifts/${id}/close`, { token: cajero.token, body: { countedCash: 45000, reason: 'Faltó cambio' } })
    expect(closed.json.difference).toBe(45000 - 45700)
    expect((await s.call('POST', '/sales', { token: cajero.token, body: venta(s) })).status).toBe(409)
  })

  it('una venta repetida (mismo id) no se cobra dos veces', async () => {
    const { s, cajero } = await negocio()
    await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 0 } })
    const v = venta(s)
    const a = await s.call('POST', '/sales', { token: cajero.token, body: v })
    const b = await s.call('POST', '/sales', { token: cajero.token, body: v })
    expect(a.json.duplicate).toBe(false)
    expect(b.json.duplicate).toBe(true)
    expect(b.json.sale.folio).toBe(a.json.sale.folio)
    expect((s.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(1)
  })

  it('descuento y cancelación exigen código; todo queda en bitácora con quién autorizó', async () => {
    const { s, o, cajero } = await negocio()
    // el cajero necesita el permiso visible para descontar/cancelar
    await s.call('PATCH', `/users/${cajero.id}`, { token: o.token, body: { permissions: ['sell', 'open_close_cash', 'cancel_discount'] } })
    await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 10000 } })
    const sinCodigo = await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { discount: 500 }) })
    expect(sinCodigo.json.error.code).toBe('codigo_requerido')
    const malo = await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { discount: 500, authCode: '9999' }) })
    expect(malo.status).toBe(403)
    const v = await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { discount: 500, authCode: '4321' }) })
    expect(v.json.sale.total).toBe(3700 - 500)
    const c1 = await s.call('POST', `/sales/${v.json.sale.id}/cancel`, { token: cajero.token, body: { reason: 'Cliente se arrepintió', authCode: '4321' } })
    expect(c1.json.sale.status).toBe('cancelada')
    const cur = await s.call('GET', '/shifts/current', { token: cajero.token })
    expect(cur.json.totals.expectedCash).toBe(10000) // la cancelada no cuenta
    const log = await s.call('GET', '/audit', { token: o.token })
    const cancel = log.json.entries.find((e: any) => e.action === 'venta.cancelacion')
    expect(cancel.authorized_by).toBeTruthy()
    expect(cancel.reason).toBe('Cliente se arrepintió')
    expect(log.json.entries.some((e: any) => e.action === 'codigo.fallido')).toBe(true)
  })

  it('el código se bloquea tras varios intentos fallidos', async () => {
    const { s, o, cajero } = await negocio()
    await s.call('PATCH', `/users/${cajero.id}`, { token: o.token, body: { permissions: ['sell', 'open_close_cash', 'cancel_discount'] } })
    await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 0 } })
    for (let i = 0; i < 5; i++) await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { discount: 100, authCode: '0000' }) })
    const r = await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { discount: 100, authCode: '4321' }) })
    expect(r.status).toBe(423)
    s.advance(16 * 60_000)
    expect((await s.call('POST', '/sales', { token: cajero.token, body: venta(s, { discount: 100, authCode: '4321' }) })).status).toBe(201)
  })

  it('cierre del día consolida turnos y exige que estén cerrados', async () => {
    const { s, o, cajero } = await negocio()
    const sh = await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 1000 } })
    await s.call('POST', '/sales', { token: cajero.token, body: venta(s) })
    const date = sh.json.shift.opened_date
    const early = await s.call('POST', '/day-close', { token: o.token, body: { date } })
    expect(early.status).toBe(409)
    expect(early.json.error.code).toBe('turnos_abiertos')
    await s.call('POST', `/shifts/${sh.json.shift.id}/close`, { token: cajero.token, body: { countedCash: 4700 } })
    const ok = await s.call('POST', '/day-close', { token: o.token, body: { date } })
    expect(ok.status).toBe(201)
    expect(ok.json.summary.cashSales).toBe(3700)
    expect((await s.call('POST', '/day-close', { token: o.token, body: { date } })).status).toBe(409)
  })

  it('ticket con logo, teléfono, folio, productos, pago y cajero', async () => {
    const { s, cajero } = await negocio()
    await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 0 } })
    const v = await s.call('POST', '/sales', { token: cajero.token, body: venta(s) })
    const t = await s.call('GET', `/sales/${v.json.sale.id}/ticket`, { token: cajero.token })
    expect(t.json.ticket.phone).toBe('5511112222')
    expect(t.json.ticket.folio).toBe('000001')
    expect(t.json.text).toContain('Refresco')
    expect(t.json.text).toContain('$37.00')
    expect(t.json.text).toContain('Atendió: caja1')
  })

  it('la bitácora y las ventas no se pueden borrar ni editar', async () => {
    const { s, cajero } = await negocio()
    await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 0 } })
    await s.call('POST', '/sales', { token: cajero.token, body: venta(s) })
    expect(() => s.db.prepare('DELETE FROM audit_log').run()).toThrow()
    expect(() => s.db.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow()
    expect(() => s.db.prepare('DELETE FROM sales').run()).toThrow()
  })
})
