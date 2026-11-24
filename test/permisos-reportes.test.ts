import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('reportes: solo con permiso del dueño, solo lectura, y arqueo antes del corte', () => {
  it('un empleado nuevo NO ve reportes ni finanzas; con «ver reportes» autorizado por el dueño ve, pero no modifica', async () => {
    const { s, T, o } = await negocioListo()
    const caj = await s.createStaff(T, o.business.code, 'cajera', 'cajero')
    const piso = await s.createStaff(T, o.business.code, 'piso', 'empleado_piso', { permissions: ['attendance'] })
    // Sin permiso: nada de reportes ni finanzas.
    for (const u of [caj, piso]) {
      expect((await s.call('GET', '/reports/summary', { token: u.token })).status).toBe(403)
      expect((await s.call('GET', '/accounting/balance', { token: u.token })).status).toBe(403)
      expect((await s.call('GET', '/dashboard/panel', { token: u.token })).status).toBe(403)
    }
    // Aunque el dueño le marque «ver reportes» a la cajera, un EMPLEADO nunca ve el panel general ni las finanzas (decisión del propietario).
    await s.call('PATCH', `/users/${caj.id}`, { token: T, body: { permissions: ['sell', 'open_close_cash', 'view_reports'] } })
    expect((await s.call('GET', '/reports/summary', { token: caj.token })).status).toBe(403)
    expect((await s.call('GET', '/accounting/income-statement', { token: caj.token })).status).toBe(403)
    // Quien sí puede: un administrador autorizado, con la función marcada por el dueño.
    s.db.prepare("UPDATE businesses SET plan = 'profesional'").run() // más cupo de usuarios
    const adm = await s.createStaff(T, o.business.code, 'admfin', 'administrador')
    await s.call('PATCH', `/users/${adm.id}`, { token: T, body: { permissions: ['view_dashboard', 'view_finance'] } })
    expect((await s.call('GET', '/reports/summary', { token: adm.token })).status).toBe(200)
    expect((await s.call('GET', '/accounting/income-statement', { token: adm.token })).status).toBe(200)
    // Ver no es modificar: no registra gastos ni cambia gastos fijos.
    expect((await s.call('POST', '/expenses', { token: adm.token, body: { concept: 'Luz', amount: 100, kind: 'fijo', method: 'efectivo' } })).status).toBe(403)
    expect((await s.call('POST', '/fixed-expenses', { token: adm.token, body: { concept: 'Renta', monthlyAmount: 100 } })).status).toBe(403)
    expect((await s.call('GET', '/reports/suggested-withdrawal', { token: caj.token })).status).toBe(403)
  })

  it('arqueo: cuenta por billete y moneda y compara contra lo registrado', async () => {
    const { s, T, open, sell } = await negocioListo()
    const shift = (await open(50000)).json.shift
    await sell([{ description: 'Varios', quantity: 1, unitPrice: 8200 }])
    const short = (await s.call('POST', `/shifts/${shift.id}/verify`, { token: T, body: { denominations: { 50000: 1 } } })).json
    expect(short).toMatchObject({ counted: 50000, expectedCash: 58200, difference: -8200, matches: false })
    const ok = (await s.call('POST', `/shifts/${shift.id}/verify`, { token: T, body: { denominations: { 50000: 1, 5000: 1, 2000: 1, 1000: 1, 200: 1 } } })).json
    expect(ok).toMatchObject({ counted: 58200, difference: 0, matches: true })
    expect((await s.call('POST', `/shifts/${shift.id}/verify`, { token: T, body: { denominations: { 300: 1 } } })).status).toBe(400)
    const audit = (await s.call('GET', '/audit', { token: T })).json
    expect(JSON.stringify(audit)).toContain('caja.arqueo')
    // El arqueo no cierra la caja.
    expect((await s.call('GET', '/shifts/current', { token: T })).json.shift.status).toBe('abierto')
  })
})
