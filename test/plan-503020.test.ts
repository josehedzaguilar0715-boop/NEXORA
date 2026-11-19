import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('costos, ganancia y plan 50/30/20', () => {
  it('el costo del servicio y del producto entran al costo de lo vendido; el retiro no deja el negocio en 0', async () => {
    const { s, T, product, open } = await negocioListo()
    s.setGiro('barberia')
    // Servicio con costo de material y producto con costo y % de ganancia sin haber compra.
    const corte = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 20000, durationMin: 30, cost: 2000 } })).json.service
    expect(corte.cost).toBe(2000)
    const cera = await product({ name: 'Cera', unit: 'pieza', price: 15000, cost: 9000, marginBp: 5000 })
    const pv = (await s.call('GET', `/products/${cera.id}`, { token: T })).json.product
    expect(pv).toMatchObject({ lastCost: 9000, suggestedPrice: 13500 })
    // Cambiar el costo después queda en la bitácora.
    await s.call('PATCH', `/products/${cera.id}`, { token: T, body: { cost: 8000 } })
    expect((await s.call('GET', `/products/${cera.id}`, { token: T })).json.product.lastCost).toBe(8000)
    expect(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'producto.costo'").get()).toMatchObject({ n: 1 })

    await open(0)
    for (let i = 0; i < 10; i++) await s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ serviceId: corte.id, quantity: 1 }] } })
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.costOfSales).toBe(20000) // 10 cortes × $20 de material
    expect(sum.grossProfit).toBe(180000)

    // Plan: 50/30/20 de la utilidad bruta ($1,800).
    let p = (await s.call('GET', '/finance/plan', { token: T })).json
    expect(p.buckets).toMatchObject({ ops: { pct: 50, target: 90000 }, owner: { pct: 30, target: 54000 }, savings: { pct: 20, target: 36000 } })
    expect(p.suggested).toBe(54000) // sin gastos fijos: su 30% completo

    // Con renta de $3,000 al mes y 15 días de reserva: el retiro baja para no descapitalizar.
    await s.call('POST', '/fixed-expenses', { token: T, body: { concept: 'Renta', monthlyAmount: 300000 } })
    await s.call('PUT', '/reserve-days', { token: T, body: { days: 15 } })
    p = (await s.call('GET', '/finance/plan', { token: T })).json
    expect(p.reserve).toBe(150000)
    expect(p.safeMax).toBe(30000) // 1,800 − 1,500
    expect(p.suggested).toBe(30000)
    expect(p.reasons.join(' ')).toContain('reserva de 15 días')
    expect(p.keeps).toBe(150000)

    // Con muchos gastos: el retiro es 0 y avisa.
    await s.call('POST', '/expenses', { token: T, body: { concept: 'Compostura', amount: 200000, kind: 'variable', method: 'transferencia' } })
    p = (await s.call('GET', '/finance/plan', { token: T })).json
    expect(p.suggested).toBe(0)
    expect(p.reasons.join(' ')).toContain('no deja ganancia')

    // Los porcentajes se pueden cambiar, pero deben sumar 100.
    expect((await s.call('PUT', '/finance/plan/rule', { token: T, body: { ops: 60, owner: 30, savings: 20 } })).status).toBe(400)
    expect((await s.call('PUT', '/finance/plan/rule', { token: T, body: { ops: 60, owner: 25, savings: 15 } })).status).toBe(200)
    expect((await s.call('GET', '/finance/plan', { token: T })).json.rule).toEqual({ ops: 60, owner: 25, savings: 15 })
  })

  it('platillo sin inventario ni receta: el costo capturado sí baja la ganancia', async () => {
    const { s, T, product, open, sell } = await negocioListo()
    s.setGiro('comedor')
    const corrida = await product({ name: 'Comida corrida', unit: 'pieza', price: 9500, trackStock: false, cost: 4000 })
    await open(0)
    await sell([{ productId: corrida.id, quantity: 3 }])
    const sum = (await s.call('GET', '/reports/summary', { token: T })).json
    expect(sum.costOfSales).toBe(12000)
    expect(sum.grossProfit).toBe(28500 - 12000)
  })
})
