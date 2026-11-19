import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('tarjeta de sellos (barbería)', () => {
  it('sellos al cobrar con cliente, tope por día, premios editables y tarjeta pública', async () => {
    const { s, T, product, buy, open, sell } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    // 1 sello por cobro, máximo 3 al día; premio a los 5 sellos.
    expect((await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })).status).toBe(200)
    const rw = (await s.call('POST', '/loyalty/rewards', { token: T, body: { name: 'Corte gratis', cost: 10 } })).json
    await s.call('PATCH', `/loyalty/rewards/${rw.id}`, { token: T, body: { cost: 5 } })
    const gel = await product({ name: 'Cera', unit: 'pieza', price: 15000 })
    await buy([{ productId: gel.id, quantity: 20, cost: 5000 }])
    await open(0)
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Juan Pérez' } })).json.customer

    const r1 = await sell([{ productId: gel.id, quantity: 1 }], { customerId: cli.id })
    expect(r1.json.loyalty).toMatchObject({ unit: 'sellos', earned: 1, balance: 1, next: { name: 'Corte gratis', cost: 5 } })
    await sell([{ productId: gel.id, quantity: 1 }], { customerId: cli.id })
    await sell([{ productId: gel.id, quantity: 1 }], { customerId: cli.id })
    // El cuarto cobro del día ya no suma: tope de 3.
    const r4 = await sell([{ productId: gel.id, quantity: 1 }], { customerId: cli.id })
    expect(r4.json.loyalty).toMatchObject({ earned: 0, balance: 3 })
    // Sin cliente no hay sellos.
    expect((await sell([{ productId: gel.id, quantity: 1 }])).json.loyalty).toBeUndefined()

    // Al día siguiente vuelve a sumar y llega al premio.
    s.advance(24 * 3600_000)
    await sell([{ productId: gel.id, quantity: 1 }], { customerId: cli.id })
    const r6 = await sell([{ productId: gel.id, quantity: 1 }], { customerId: cli.id })
    expect(r6.json.loyalty).toMatchObject({ earned: 1, balance: 5, ready: ['Corte gratis'] })

    // El cliente ve su tarjeta en su teléfono, sin iniciar sesión.
    const pub = await s.call('GET', `/public/loyalty/${cli.code}`)
    expect(pub.status).toBe(200)
    expect(pub.json).toMatchObject({ name: 'Juan', unit: 'sellos', balance: 5, dailyCap: 3, earnBy: 'venta', rewards: [{ name: 'Corte gratis', cost: 5 }] })
    expect(pub.json.history).toHaveLength(5)
    expect(JSON.stringify(pub.json)).not.toContain(cli.id)
    expect((await s.call('GET', '/public/loyalty/NXNOEXISTE')).status).toBe(404)

    // Canjea y la tarjeta queda en 0; un premio quitado ya no aparece.
    await s.call('POST', `/customers/${cli.id}/redeem`, { token: T, body: { rewardId: rw.id } })
    expect((await s.call('GET', `/public/loyalty/${cli.code}`)).json.balance).toBe(0)
    await s.call('PATCH', `/loyalty/rewards/${rw.id}`, { token: T, body: { active: false } })
    expect((await s.call('GET', `/public/loyalty/${cli.code}`)).json.rewards).toHaveLength(0)
    expect((await s.call('POST', `/customers/${cli.id}/redeem`, { token: T, body: { rewardId: rw.id } })).status).toBe(400)

    // Al apagar la tarjeta, la página pública ya no la muestra.
    await s.call('PUT', '/modules', { token: T, body: { active: [] } })
    expect((await s.call('GET', `/public/loyalty/${cli.code}`)).status).toBe(404)
  })

  it('los sellos de una cita cobrada desde la agenda también cuentan', async () => {
    const { s, T, open } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 2, scope: 'todos', dailyCap: 3 } })
    await open(0)
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Pedro' } })).json.customer
    const sv = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const r1 = await s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', customerId: cli.id, items: [{ serviceId: sv.id, quantity: 1 }] } })
    expect(r1.json.loyalty).toMatchObject({ earned: 2, balance: 2 })
    // 2 + 2 pasaría de 3: solo suma 1.
    const r2 = await s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', customerId: cli.id, items: [{ serviceId: sv.id, quantity: 1 }] } })
    expect(r2.json.loyalty).toMatchObject({ earned: 1, balance: 3 })
  })

  it('el barbero elige al cliente en la caja sin ver su teléfono ni notas', async () => {
    const { s, T, o } = await negocioListo()
    s.setGiro('barberia')
    await s.call('POST', '/customers', { token: T, body: { name: 'Luis', phone: '5512340000', notes: 'privado' } })
    const b = await s.createStaff(T, o.business.code, 'barbero1', 'barbero')
    const r = await s.call('GET', '/customers', { token: b.token })
    expect(r.status).toBe(200)
    expect(r.json.customers[0]).toEqual({ id: expect.any(String), name: 'Luis', loyaltyEnrolled: 0, active: 1 })
    expect((await s.call('POST', '/customers', { token: b.token, body: { name: 'Otro' } })).status).toBe(403)
  })

  it('dar sellos a mano: el dueño y a quien él le dé el permiso, respetando el tope del día', async () => {
    const { s, T, o } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Mario' } })).json.customer
    const b = await s.createStaff(T, o.business.code, 'barbero2', 'barbero')
    // Sin permiso, el barbero no puede.
    expect((await s.call('POST', `/customers/${cli.id}/stamps`, { token: b.token, body: { quantity: 1 } })).status).toBe(403)
    // El dueño sí.
    expect((await s.call('POST', `/customers/${cli.id}/stamps`, { token: T, body: { quantity: 2 } })).json.loyalty).toMatchObject({ earned: 2, balance: 2 })
    // El dueño le da el permiso al barbero.
    const perms = (await s.call('GET', '/users', { token: T })).json.users.find((x: any) => x.id === b.id).permissions
    expect((await s.call('PATCH', `/users/${b.id}`, { token: T, body: { permissions: [...perms, 'give_stamps'] } })).status).toBe(200)
    // Le pide 2 pero el tope del día es 3: solo da 1.
    expect((await s.call('POST', `/customers/${cli.id}/stamps`, { token: b.token, body: { quantity: 2 } })).json.loyalty).toMatchObject({ earned: 1, balance: 3 })
    expect((await s.call('GET', `/public/loyalty/${cli.code}`)).json.history[0]).toMatchObject({ reason: 'manual', delta: 1 })
  })

  it('escanear el QR da un sello por escaneo hasta el máximo del día', async () => {
    const { s, T, o } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Hugo' } })).json.customer
    const scan = (tok: string) => s.call('POST', '/scan', { token: tok, body: { code: cli.code, action: 'sello' } })
    for (let i = 1; i <= 3; i++) expect((await scan(T)).json.loyalty).toMatchObject({ earned: 1, balance: i })
    // El cuarto escaneo del día ya no suma.
    expect((await scan(T)).json.loyalty).toMatchObject({ earned: 0, balance: 3 })
    // Al día siguiente vuelve a sumar.
    s.advance(86_400_000); s.longLived()
    expect((await scan(T)).json.loyalty).toMatchObject({ earned: 1, balance: 4 })
    expect((await s.call('GET', `/public/loyalty/${cli.code}`)).json.history[0]).toMatchObject({ reason: 'escaneo', delta: 1 })
    // Un barbero sin el permiso no puede dar sellos con el QR; con el permiso sí.
    const b = await s.createStaff(T, o.business.code, 'barbero3', 'barbero')
    expect((await scan(b.token)).status).toBe(403)
    const perms = (await s.call('GET', '/users', { token: T })).json.users.find((x: any) => x.id === b.id).permissions
    await s.call('PATCH', `/users/${b.id}`, { token: T, body: { permissions: [...perms, 'give_stamps'] } })
    expect((await scan(b.token)).json.loyalty).toMatchObject({ earned: 1, balance: 5 })
    // Un código de otro negocio no sirve.
    expect((await s.call('POST', '/scan', { token: T, body: { code: 'NXNOEXISTE1234', action: 'sello' } })).status).toBe(404)
  })

  it('ajustar sellos en la ficha del cliente: agregar los que faltaron o quitar, con motivo y sin tope del día', async () => {
    const { s, T, o } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    const cli = (await s.call('POST', '/customers', { token: T, body: { name: 'Raúl' } })).json.customer
    const adj = (body: object, tok = T) => s.call('POST', `/customers/${cli.id}/stamps/adjust`, { token: tok, body })
    // Motivo obligatorio y la cantidad no puede ser 0.
    expect((await adj({ delta: 4 })).status).toBe(400)
    expect((await adj({ delta: 0, reason: 'nada' })).status).toBe(400)
    // El dueño agrega 4 de golpe (más que el máximo de 3 al día).
    expect((await adj({ delta: 4, reason: 'Sellos que no se registraron' })).json.balance).toBe(4)
    // Quitar más de lo que tiene no se puede; quitar 1 sí.
    expect((await adj({ delta: -5, reason: 'Error' })).json.error.code).toBe('saldo_insuficiente')
    expect((await adj({ delta: -1, reason: 'Se dio de más' })).json.balance).toBe(3)
    // El ajuste no gasta el máximo del día: escanear todavía suma.
    expect((await s.call('POST', '/scan', { token: T, body: { code: cli.code, action: 'sello' } })).json.loyalty).toMatchObject({ earned: 1, balance: 4 })
    // Queda en su historial con el motivo y en la bitácora.
    const led = (await s.call('GET', `/customers/${cli.id}/loyalty`, { token: T })).json.ledger
    expect(led.find((l: any) => l.reason === 'ajuste' && l.delta === -1)).toMatchObject({ note: 'Se dio de más' })
    expect(s.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'fidelidad.ajuste'").get()).toMatchObject({ n: 2 })
    // La nota es interna: no se muestra en la tarjeta del cliente.
    expect(JSON.stringify((await s.call('GET', `/public/loyalty/${cli.code}`)).json)).not.toContain('Se dio de más')
    // Un empleado con permiso necesita el código del dueño; sin permiso, no puede.
    const caj = await s.createStaff(T, o.business.code, 'cajero9', 'cajero')
    expect((await adj({ delta: 1, reason: 'Faltó' }, caj.token)).status).toBe(403)
    const perms = (await s.call('GET', '/users', { token: T })).json.users.find((x: any) => x.id === caj.id).permissions
    await s.call('PATCH', `/users/${caj.id}`, { token: T, body: { permissions: [...perms, 'give_stamps'] } })
    expect((await adj({ delta: 1, reason: 'Faltó' }, caj.token)).json.error.code).toBe('codigo_requerido')
    expect((await adj({ delta: 1, reason: 'Faltó', authCode: '4321' }, caj.token)).json.balance).toBe(5)
  })
})
