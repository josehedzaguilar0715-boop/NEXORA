import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function barberia() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.setGiro('barberia')
  const juan = await s.createStaff(T, o.business.code, 'juan', 'barbero')
  const enc = await s.createStaff(T, o.business.code, 'encargada', 'encargado')
  for (const x of [juan, enc]) await s.call('POST', '/auth/change-password', { token: x.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
  const corte = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000 } })).json.service
  await s.call('PUT', '/commission-rules', { token: T, body: { rules: [{ targetType: 'all', rateBp: 4000 }] } })
  const corteDe = (staffId: string, extra: object = {}) => n.sell([{ serviceId: corte.id, quantity: 1, staffId }], extra)
  return { ...n, juan, enc, corteDe }
}

describe('pago de comisiones y propinas al personal', () => {
  it('paga lo pendiente desde la caja, una sola vez; queda en historial, bitácora y libro de dinero', async () => {
    const { s, T, juan, corteDe, open } = await barberia()
    const sh = (await open(10000)).json.shift
    await corteDe(juan.id, { tips: [{ staffId: juan.id, amount: 3000 }] }) // comisión 60, propina 30 en efectivo
    await corteDe(juan.id, { paymentMethod: 'tarjeta', tips: [{ staffId: juan.id, amount: 2000, method: 'tarjeta' }] }) // comisión 60, propina 20 con tarjeta
    const pend = (await s.call('GET', '/staff-payouts/pending', { token: T })).json.staff
    expect(pend).toEqual([expect.objectContaining({ name: 'juan', commission: 12000, tips: 5000, adjustments: 0, amount: 17000 })])
    // Fondo 100 + corte 150 + propina 30 = 280 en caja; se le pagan 170.
    const pay = await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'efectivo' } })
    expect(pay.status).toBe(201)
    expect(pay.json.payout.amount).toBe(17000)
    expect((await s.call('GET', `/shifts/${sh.id}`, { token: T })).json.totals.expectedCash).toBe(10000 + 15000 + 3000 - 17000)
    // No se paga dos veces.
    expect((await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'efectivo' } })).json.error.code).toBe('nada_pendiente')
    expect((await s.call('GET', '/staff-payouts/pending', { token: T })).json.staff).toHaveLength(0)
    // El barbero ve su pago.
    const mine = (await s.call('GET', '/staff-payouts', { token: juan.token })).json.payouts
    expect(mine).toHaveLength(1)
    expect((await s.call('GET', '/audit', { token: T })).json.entries.some((e: any) => e.action === 'personal.pago')).toBe(true)
    // Libro: sale solo la comisión (la propina no es dinero del negocio).
    const lg = (await s.call('GET', '/accounting/ledger', { token: T })).json.entries
    expect(lg.find((e: any) => e.type === 'Pago a personal')).toMatchObject({ outflow: 12000 })
    // Corte Z cuadra.
    expect((await s.call('POST', `/shifts/${sh.id}/close`, { token: T, body: { countedCash: 11000 } })).json.difference).toBe(0)
  })

  it('si no alcanza el efectivo se rechaza; por transferencia sí', async () => {
    const { s, T, juan, corteDe, open } = await barberia()
    await open(0)
    await corteDe(juan.id, { paymentMethod: 'tarjeta' })
    expect((await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'efectivo' } })).json.error.code).toBe('efectivo_insuficiente')
    expect((await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'transferencia' } })).status).toBe(201)
  })

  it('venta cancelada después de pagada: se descuenta en el siguiente pago', async () => {
    const { s, T, juan, corteDe, open } = await barberia()
    await open(100000)
    const v = (await corteDe(juan.id)).json.sale
    await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'transferencia' } })
    await s.call('POST', `/sales/${v.id}/cancel`, { token: T, body: { reason: 'No se hizo', authCode: '4321' } })
    let pend = (await s.call('GET', '/staff-payouts/pending', { token: T })).json.staff[0]
    expect(pend).toMatchObject({ commission: 0, adjustments: -6000, amount: -6000 })
    expect((await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'transferencia' } })).json.error.code).toBe('nada_pendiente')
    await corteDe(juan.id); await corteDe(juan.id)
    pend = (await s.call('GET', '/staff-payouts/pending', { token: T })).json.staff[0]
    expect(pend).toMatchObject({ commission: 12000, adjustments: -6000, amount: 6000 })
    expect((await s.call('POST', '/staff-payouts', { token: T, body: { staffId: juan.id, method: 'transferencia' } })).json.payout.amount).toBe(6000)
    expect((await s.call('GET', '/staff-payouts/pending', { token: T })).json.staff).toHaveLength(0)
  })

  it('solo dueño o encargado (con código del dueño); el barbero no puede pagarse', async () => {
    const { s, T, juan, enc, corteDe, open } = await barberia()
    await open(100000)
    await corteDe(juan.id)
    expect((await s.call('POST', '/staff-payouts', { token: juan.token, body: { staffId: juan.id, method: 'transferencia' } })).status).toBe(403)
    expect((await s.call('POST', '/staff-payouts', { token: enc.token, body: { staffId: juan.id, method: 'transferencia' } })).json.error.code).toBe('codigo_requerido')
    expect((await s.call('POST', '/staff-payouts', { token: enc.token, body: { staffId: juan.id, method: 'transferencia', authCode: '4321' } })).status).toBe(201)
    // Reenvío con el mismo id (sin señal) no paga dos veces.
    const id = s.uuid()
    await corteDe(juan.id)
    const a = await s.call('POST', '/staff-payouts', { token: T, body: { id, staffId: juan.id, method: 'transferencia' } })
    const b = await s.call('POST', '/staff-payouts', { token: T, body: { id, staffId: juan.id, method: 'transferencia' } })
    expect(a.status).toBe(201)
    expect(b.json.duplicate).toBe(true)
  })
})
