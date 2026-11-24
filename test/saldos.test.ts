import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function conVentas() {
  const n = await negocioListo()
  const p = await n.product({ name: 'Refresco', unit: 'pieza', price: 2000 })
  await n.buy([{ productId: p.id, quantity: 10, cost: 10_000 }])
  await n.open(10_000)
  await n.sell([{ productId: p.id, quantity: 10 }])
  return n
}
/** «Hoy» según el reloj del sistema (en las pruebas está simulado). */
const hoyDe = async (s: any, T: string) => (await s.call('GET', '/finanzas/resumen', { token: T })).json.to as string

describe('saldos iniciales, ajustes y conciliación', () => {
  it('sin saldos registrados no cambia nada: el disponible es lo registrado en NEXORA', async () => {
    const { s, T } = await conVentas()
    const r = (await s.call('GET', '/finanzas/resumen', { token: T })).json
    expect(r.disponible).toBe(10_000)
    const sal = (await s.call('GET', '/finanzas/saldos', { token: T })).json
    expect(sal.total).toBe(10_000)
    expect(sal.accounts).toEqual([])
  })

  it('el saldo inicial suma una vez, por separado efectivo y cada cuenta, sin duplicar ni mezclarse con ingresos', async () => {
    const { s, T } = await conVentas()
    const fecha = await hoyDe(s, T)
    const antes = (await s.call('GET', '/finanzas/resumen', { token: T })).json.disponible
    const post = (b: object) => s.call('POST', '/finanzas/saldos', { token: T, body: { date: fecha, ...b } })
    expect((await post({ accountType: 'efectivo', accountName: 'Efectivo', amount: 50_000, description: 'Efectivo al empezar' })).status).toBe(201)
    expect((await post({ accountType: 'banco', accountName: 'BBVA', amount: 120_000, description: 'Saldo de la cuenta' })).status).toBe(201)
    expect((await post({ accountType: 'banco', accountName: 'Santander', amount: 30_000, description: 'Otra cuenta' })).status).toBe(201)
    const sal = (await s.call('GET', '/finanzas/saldos', { token: T })).json
    expect(sal.accounts.map((a: any) => [a.name, a.balance]).sort()).toEqual([['BBVA', 120_000], ['Efectivo', 50_000], ['Santander', 30_000]])
    // Mismo día: el saldo inicial es de AL EMPEZAR el día, así que las ventas de hoy siguen contando y el saldo se suma una sola vez.
    expect((await s.call('GET', '/finanzas/resumen', { token: T })).json.disponible).toBe(antes + 200_000)
    // La misma cuenta no se registra dos veces como inicial.
    const dup = await post({ accountType: 'banco', accountName: 'BBVA', amount: 1, description: 'otra vez' })
    expect(dup.status).toBe(409)
    expect(dup.json.error.code).toBe('saldo_ya_registrado')
    // No se aceptan fechas futuras ni motivos vacíos.
    expect((await post({ accountType: 'efectivo', accountName: 'Caja chica', amount: 1, date: '2999-01-01', description: 'futuro' })).status).toBe(400)
    expect((await post({ accountType: 'efectivo', accountName: 'Caja chica', amount: 1, description: '' })).status).toBe(400)
  })

  it('los movimientos anteriores a la fecha del saldo inicial no se vuelven a contar', async () => {
    const n = await conVentas()
    const { s, T } = n
    s.longLived()
    s.advance(3 * 86_400_000) // pasan 3 días desde las ventas
    const hoyDia = await hoyDe(s, T)
    await s.call('POST', '/finanzas/saldos', { token: T, body: { accountType: 'efectivo', accountName: 'Efectivo', amount: 80_000, date: hoyDia, description: 'Conté la caja al empezar a usar el saldo' } })
    // Las ventas de hace 3 días ya están dentro de ese saldo: el efectivo es solo el saldo (más lo que entre desde hoy).
    const sal = (await s.call('GET', '/finanzas/saldos', { token: T })).json
    expect(sal.efectivo).toBe(80_000)
    // El banco no tiene saldo inicial: se cuenta lo registrado desde el principio (aquí, el pago al proveedor).
    expect(sal.total).toBe(sal.efectivo + sal.banco)
  })

  it('ajustes documentados y conciliación: lo esperado contra lo contado', async () => {
    const { s, T } = await conVentas()
    await s.call('POST', '/finanzas/saldos', { token: T, body: { accountType: 'efectivo', accountName: 'Efectivo', amount: 50_000, date: await hoyDe(s, T), description: 'Efectivo al empezar' } })
    const esperado = (await s.call('GET', '/finanzas/saldos', { token: T })).json.efectivo
    // Coincide: no se registra nada.
    const ok = await s.call('POST', '/finanzas/saldos/conciliar', { token: T, body: { accountType: 'efectivo', accountName: 'Efectivo', counted: esperado } })
    expect(ok.json).toMatchObject({ matches: true, difference: 0 })
    // No coincide y sin motivo: se rechaza explicando la diferencia.
    const sin = await s.call('POST', '/finanzas/saldos/conciliar', { token: T, body: { accountType: 'efectivo', accountName: 'Efectivo', counted: esperado - 1500 } })
    expect(sin.status).toBe(400)
    expect(sin.json.error.code).toBe('falta_motivo')
    // Con motivo: queda un ajuste y ahora lo esperado = lo contado.
    const con = await s.call('POST', '/finanzas/saldos/conciliar', { token: T, body: { accountType: 'efectivo', accountName: 'Efectivo', counted: esperado - 1500, description: 'Faltaron 15 pesos de cambio' } })
    expect(con.json).toMatchObject({ matches: false, difference: -1500 })
    const after = (await s.call('GET', '/finanzas/saldos', { token: T })).json
    expect(after.efectivo).toBe(esperado - 1500)
    expect(after.entries[0]).toMatchObject({ kind: 'ajuste', amount: -1500, description: 'Conciliación: Faltaron 15 pesos de cambio' })
    // Ajuste manual: exige motivo y no puede ser cero.
    expect((await s.call('POST', '/finanzas/saldos/ajuste', { token: T, body: { accountType: 'banco', accountName: 'BBVA', amount: 0, description: 'nada de nada' } })).status).toBe(400)
    expect((await s.call('POST', '/finanzas/saldos/ajuste', { token: T, body: { accountType: 'banco', accountName: 'BBVA', amount: 5000, description: 'x' } })).status).toBe(400)
    expect((await s.call('POST', '/finanzas/saldos/ajuste', { token: T, body: { accountType: 'banco', accountName: 'BBVA', amount: 5000, description: 'Intereses del mes' } })).status).toBe(201)
  })

  it('el historial no se edita ni se borra (solo ajustes nuevos)', async () => {
    const { s, T } = await conVentas()
    await s.call('POST', '/finanzas/saldos', { token: T, body: { accountType: 'efectivo', accountName: 'Efectivo', amount: 1000, date: await hoyDe(s, T), description: 'Efectivo al empezar' } })
    expect(() => s.db.prepare('UPDATE balance_entries SET amount = 1').run()).toThrow(/no se editan/)
    expect(() => s.db.prepare('DELETE FROM balance_entries').run()).toThrow(/no se borran/)
  })

  it('permisos: el encargado y el empleado no; el administrador ve con «ver finanzas» y registra con «registrar retiros y reparto»', async () => {
    const { s, T, o } = await conVentas()
    s.db.prepare("UPDATE businesses SET plan = 'profesional'").run()
    const enc = await s.createStaff(T, o.business.code, 'encsaldo', 'encargado')
    const adm = await s.createStaff(T, o.business.code, 'admsaldo', 'administrador')
    const body = { accountType: 'efectivo', accountName: 'Efectivo', amount: 1000, date: await hoyDe(s, T), description: 'Efectivo al empezar' }
    expect((await s.call('GET', '/finanzas/saldos', { token: enc.token })).status).toBe(403)
    expect((await s.call('POST', '/finanzas/saldos', { token: enc.token, body })).status).toBe(403)
    expect((await s.call('GET', '/finanzas/saldos', { token: adm.token })).status).toBe(403)
    await s.call('PATCH', `/users/${adm.id}`, { token: T, body: { permissions: ['view_finance'] } })
    expect((await s.call('GET', '/finanzas/saldos', { token: adm.token })).status).toBe(200)
    expect((await s.call('POST', '/finanzas/saldos', { token: adm.token, body })).status).toBe(403)
    await s.call('PATCH', `/users/${adm.id}`, { token: T, body: { permissions: ['view_finance', 'manage_finance'] } })
    expect((await s.call('POST', '/finanzas/saldos', { token: adm.token, body })).status).toBe(201)
  })
})
