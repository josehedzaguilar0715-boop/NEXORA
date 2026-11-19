import { describe, expect, it } from 'vitest'
import { bestPromotions, type PromotionRow } from '../src/promotions.js'
import { periodStart } from '../src/common.js'
import { setup } from './helpers.js'

const DAY = 86_400_000

async function negocio(modules: string[] = ['membresias', 'promociones', 'fidelidad', 'asistencia']) {
  const s = setup()
  const o = await s.registerOwner()
  await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
  await s.call('PUT', '/modules', { token: o.token, body: { active: modules } })
  const cli = (await s.call('POST', '/customers', { token: o.token, body: { name: 'Carlos', phone: '5511111111' } })).json.customer
  return { s, o, cli }
}

describe('módulos activables', () => {
  it('un módulo apagado no se puede usar', async () => {
    const { s, o, cli } = await negocio([])
    expect((await s.call('GET', '/membership-plans', { token: o.token })).json.error.code).toBe('modulo_inactivo')
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'entrada' } })).json.error.code).toBe('modulo_inactivo')
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'consulta' } })).status).toBe(200)
  })
})

describe('QR', () => {
  it('código único, no consecutivo, descargable y validado por el servidor', async () => {
    const { s, o, cli } = await negocio()
    const otro = (await s.call('POST', '/customers', { token: o.token, body: { name: 'Lupe' } })).json.customer
    expect(cli.code).toMatch(/^NX[A-Z0-9]{18}$/)
    expect(otro.code).not.toBe(cli.code)
    const res = await s.app.request(`/public/qr/${cli.code}.svg`)
    expect(res.headers.get('content-type')).toContain('svg')
    expect(await res.text()).toContain('<svg')
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: 'NXNOEXISTE0000000000', action: 'consulta' } })).json.error.code).toBe('codigo_invalido')
    // Otro negocio no puede usar el código.
    const o2 = await s.registerOwner('5598765432')
    expect((await s.call('POST', '/scan', { token: o2.token, body: { code: cli.code, action: 'consulta' } })).status).toBe(404)
    // Código nuevo invalida el anterior.
    await s.call('POST', `/customers/${cli.id}/new-code`, { token: o.token })
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'consulta' } })).status).toBe(404)
  })
})

describe('asistencia', () => {
  it('cada entrada registra fecha y hora; no dos veces en la misma visita', async () => {
    const { s, o, cli } = await negocio()
    const a = await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'entrada' } })
    expect(a.json.visit.at).toBeTruthy()
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'entrada' } })).json.error.code).toBe('ya_registrado')
    s.advance(DAY)
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'entrada' } })).status).toBe(200)
  })

  it('personal: entrada y salida alternadas', async () => {
    const { s, o } = await negocio()
    expect((await s.call('POST', '/attendance/clock', { token: o.token, body: { type: 'salida' } })).status).toBe(409)
    await s.call('POST', '/attendance/clock', { token: o.token, body: { type: 'entrada' } })
    expect((await s.call('POST', '/attendance/clock', { token: o.token, body: { type: 'entrada' } })).status).toBe(409)
    await s.call('POST', '/attendance/clock', { token: o.token, body: { type: 'salida' } })
    expect((await s.call('GET', '/attendance', { token: o.token })).json.attendance).toHaveLength(2)
  })
})

describe('membresías', () => {
  it('4 usos por mes; cada escaneo descuenta uno; no dos en la misma visita; se renueva cada periodo', async () => {
    const { s, o, cli } = await negocio()
    const plan = (await s.call('POST', '/membership-plans', { token: o.token, body: { name: '4 cortes al mes', usesPerPeriod: 4, period: 'mes', price: 40000 } })).json.id
    s.longLived()
    const m = await s.call('POST', `/customers/${cli.id}/memberships`, { token: o.token, body: { planId: plan, periods: 2 } })
    expect(m.json.membership.remaining).toBe(4)
    for (let i = 0; i < 4; i++) {
      const r = await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'membresia' } })
      expect(r.json.membership.remaining).toBe(3 - i)
      if (i < 3) {
        expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'membresia' } })).json.error.code).toBe('ya_usado')
        s.advance(DAY)
      }
    }
    s.advance(DAY)
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'membresia' } })).json.error.code).toBe('sin_usos')
    s.advance(30 * DAY) // segundo mes
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'membresia' } })).json.membership.remaining).toBe(3)
    s.advance(40 * DAY) // fuera de vigencia
    expect((await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'membresia' } })).json.error.code).toBe('membresia_no_vigente')
  })

  it('editar el plan no altera membresías ya vendidas', async () => {
    const { s, o, cli } = await negocio()
    const plan = (await s.call('POST', '/membership-plans', { token: o.token, body: { name: 'Mensual', usesPerPeriod: 4, period: 'mes', price: 40000 } })).json.id
    await s.call('POST', `/customers/${cli.id}/memberships`, { token: o.token, body: { planId: plan } })
    await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'membresia' } })
    await s.call('PATCH', `/membership-plans/${plan}`, { token: o.token, body: { usesPerPeriod: 2 } })
    const st = await s.call('GET', `/customers/${cli.id}`, { token: o.token })
    expect(st.json.memberships[0]).toMatchObject({ usesPerPeriod: 4, remaining: 3 })
  })

  it('periodos de calendario desde el inicio', () => {
    const start = new Date('2026-01-31T12:00:00Z')
    expect(periodStart(start, 'semana', new Date('2026-02-08T00:00:00Z')).toISOString()).toBe('2026-02-07T12:00:00.000Z')
    expect(periodStart(start, 'mes', new Date('2026-01-31T13:00:00Z')).toISOString()).toBe(start.toISOString())
  })
})

describe('promociones', () => {
  const P = (o: Partial<PromotionRow>): PromotionRow => ({ id: o.name ?? 'p', name: 'p', kind: 'porcentaje', value: 1000, starts_at: '', ends_at: '', applies_to: '{"all":true}', combinable: 0, min_quantity: 0, ...o })
  const lines = [{ ref: 'a', category: 'bebidas', quantity: 2, total: 4000 }, { ref: 'b', category: 'pan', quantity: 1, total: 2000 }]

  it('no se combina, salvo que la regla lo permita; elige la mejor opción', () => {
    expect(bestPromotions([P({ name: 'x', value: 1000 }), P({ name: 'y', value: 2000 })], lines).total).toBe(1200) // solo la mejor
    expect(bestPromotions([P({ name: 'x', value: 1000, combinable: 1 }), P({ name: 'y', value: 2000, combinable: 1 })], lines).total).toBe(1800)
    expect(bestPromotions([P({ name: 'c', kind: 'monto', value: 500, applies_to: '{"categories":["pan"]}' })], lines).total).toBe(500)
    expect(bestPromotions([P({ name: 'r', applies_to: '{"refs":["a"]}', min_quantity: 3 })], lines).total).toBe(0)
    expect(bestPromotions([P({ name: 'm', kind: 'monto', value: 999999 })], lines).total).toBe(6000) // nunca más que el total
  })

  it('se aplica sola en la venta, dentro de su vigencia', async () => {
    const { s, o } = await negocio()
    const now = Date.parse('2026-11-17T15:00:00Z')
    await s.call('POST', '/promotions', { token: o.token, body: { name: 'Bebidas 10%', kind: 'porcentaje', value: 1000, startsAt: new Date(now - DAY).toISOString(), endsAt: new Date(now + DAY).toISOString(), appliesTo: { categories: ['bebidas'] } } })
    await s.call('POST', '/shifts/open', { token: o.token, body: { openingFloat: 0 } })
    const sale = (body: object = {}) => s.call('POST', '/sales', { token: o.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ description: 'Refresco', category: 'bebidas', quantity: 2, unitPrice: 2000 }, { description: 'Pan', quantity: 1, unitPrice: 1000 }], ...body } })
    const v = await sale()
    expect(v.json.sale).toMatchObject({ subtotal: 5000, promoDiscount: 400, total: 4600 })
    s.advance(2 * DAY)
    await s.call('POST', `/shifts/${(await s.call('GET', '/shifts/current', { token: o.token })).json.shift.id}/close`, { token: o.token, body: { countedCash: 4600 } })
    await s.call('POST', '/shifts/open', { token: o.token, body: { openingFloat: 0 } })
    expect((await sale()).json.sale.promoDiscount).toBe(0) // venció
  })
})

describe('fidelidad', () => {
  it('puntos por monto, canje y reversa al cancelar', async () => {
    const { s, o, cli } = await negocio()
    await s.call('PUT', '/loyalty', { token: o.token, body: { unit: 'puntos', earnBy: 'monto', earnAmount: 1000, earnPoints: 1, scope: 'todos' } })
    const reward = (await s.call('POST', '/loyalty/rewards', { token: o.token, body: { name: 'Refresco gratis', cost: 5 } })).json.id
    await s.call('PUT', `/users/${(await s.call('GET', '/auth/me', { token: o.token })).json.user.id}/auth-code`, { token: o.token, body: { code: '4321' } })
    await s.call('POST', '/shifts/open', { token: o.token, body: { openingFloat: 0 } })
    const v = await s.call('POST', '/sales', { token: o.token, body: { id: s.uuid(), customerId: cli.id, paymentMethod: 'efectivo', items: [{ description: 'Despensa', quantity: 1, unitPrice: 5550 }] } })
    expect((await s.call('GET', `/customers/${cli.id}/loyalty`, { token: o.token })).json.balance).toBe(5)
    expect((await s.call('POST', `/customers/${cli.id}/redeem`, { token: o.token, body: { rewardId: reward } })).json.balance).toBe(0)
    expect((await s.call('POST', `/customers/${cli.id}/redeem`, { token: o.token, body: { rewardId: reward } })).json.error.code).toBe('saldo_insuficiente')
    await s.call('POST', `/sales/${v.json.sale.id}/cancel`, { token: o.token, body: { reason: 'Error de cobro', authCode: '4321' } })
    const l = await s.call('GET', `/customers/${cli.id}/loyalty`, { token: o.token })
    expect(l.json.balance).toBe(-5) // queda registrado; nada se borra
    expect(l.json.ledger.map((x: any) => x.reason)).toEqual(['cancelacion', 'canje', 'venta'])
  })

  it('sellos por visita, solo para clientes inscritos cuando es por persona', async () => {
    const { s, o, cli } = await negocio()
    await s.call('PUT', '/loyalty', { token: o.token, body: { unit: 'sellos', earnBy: 'visita', earnPoints: 1, scope: 'por_persona' } })
    await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'entrada' } })
    expect((await s.call('GET', `/customers/${cli.id}/loyalty`, { token: o.token })).json.balance).toBe(0)
    await s.call('PATCH', `/customers/${cli.id}`, { token: o.token, body: { loyaltyEnrolled: true } })
    s.advance(DAY)
    const r = await s.call('POST', '/scan', { token: o.token, body: { code: cli.code, action: 'entrada' } })
    expect(r.json.loyaltyEarned).toBe(1)
  })
})
