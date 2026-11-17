import { describe, expect, it } from 'vitest'
import { monthlyFee } from '../src/billing.js'
import { setup } from './helpers.js'

const DAY = 86_400_000

describe('planes y precios', () => {
  it('ejemplos de la especificación', () => {
    expect(monthlyFee({ plan: 'inicial', extraBranches: 0, extraUserPacks: 1 })).toBe(70000)
    expect(monthlyFee({ plan: 'profesional', extraBranches: 2, extraUserPacks: 0 })).toBe(150000)
  })
})

describe('super panel', () => {
  it('el super panel necesita su propio acceso; un dueño no entra', async () => {
    const s = setup()
    const o = await s.registerOwner()
    expect((await s.call('GET', '/admin/businesses')).status).toBe(401)
    expect((await s.call('GET', '/admin/businesses', { token: o.token })).status).toBe(401)
    const a = await s.adminToken()
    expect((await s.call('GET', '/businesses/x', { token: a })).status).toBe(401) // tampoco entra a rutas de negocio
  })

  it('prueba → vencido (sin operar, datos intactos) → pago → activo', async () => {
    const s = setup()
    const a = await s.adminToken()
    const o = await s.registerOwner()
    const biz = (await s.call('GET', '/admin/businesses', { token: a })).json.businesses[0]
    expect(biz.status).toBe('prueba')
    expect(biz.trialDays).toBe(14)
    await s.call('POST', '/shifts/open', { token: o.token, body: { openingFloat: 0 } })
    await s.call('POST', '/sales', { token: o.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ description: 'X', quantity: 1, unitPrice: 100 }] } })

    s.advance(15 * DAY)
    const blocked = await s.call('POST', '/sales', { token: o.token, body: { id: s.uuid(), paymentMethod: 'efectivo', items: [{ description: 'X', quantity: 1, unitPrice: 100 }] } })
    expect(blocked.status).toBe(402)
    expect(blocked.json.error.code).toBe('cuenta_vencida')
    expect((await s.call('GET', '/auth/me', { token: o.token })).json.business.status).toBe('vencido') // puede entrar y ver su estado
    expect((await s.call('POST', '/support/tickets', { token: o.token, body: { type: 'soporte', subject: 'Quiero pagar', message: '¿Cómo pago?' } })).status).toBe(201)
    expect((s.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(1) // datos intactos

    const paid = await s.call('POST', `/admin/businesses/${biz.id}/payments`, { token: await s.adminToken(), body: { months: 1 } })
    expect(paid.json.business.status).toBe('activo')
    expect(paid.json.business.monthlyFee).toBe(50000)
    expect((await s.call('GET', '/shifts/current', { token: o.token })).status).toBe(200)

    s.advance(32 * DAY) // vence la mensualidad
    const again = (await s.call('GET', `/admin/businesses/${biz.id}`, { token: await s.adminToken() })).json.business
    expect(again.status).toBe('vencido')
    expect(again.overdueDays).toBe(1)
  })

  it('suspender solo después de X días vencido; reactivar sin perder datos', async () => {
    const s = setup()
    const a = await s.adminToken()
    await s.registerOwner()
    const id = (await s.call('GET', '/admin/businesses', { token: a })).json.businesses[0].id
    s.advance(15 * DAY) // vencido desde el día 14
    const early = await s.call('POST', `/admin/businesses/${id}/suspend`, { token: await s.adminToken(), body: { reason: 'Sin pago' } })
    expect(early.json.error.code).toBe('muy_pronto')
    s.advance(30 * DAY)
    const sus = await s.call('POST', `/admin/businesses/${id}/suspend`, { token: await s.adminToken(), body: { reason: 'Sin pago' } })
    expect(sus.json.business.status).toBe('suspendido')
    const back = await s.call('POST', `/admin/businesses/${id}/payments`, { token: await s.adminToken(), body: { months: 2 } })
    expect(back.json.business.status).toBe('activo')
  })

  it('los días de prueba se definen por cliente', async () => {
    const s = setup()
    const a = await s.adminToken()
    const o = await s.registerOwner()
    const id = (await s.call('GET', '/admin/businesses', { token: a })).json.businesses[0].id
    s.advance(20 * DAY)
    expect((await s.call('GET', '/shifts/current', { token: o.token })).status).toBe(402)
    await s.call('PATCH', `/admin/businesses/${id}`, { token: await s.adminToken(), body: { trialDays: 30 } })
    expect((await s.call('GET', '/shifts/current', { token: o.token })).status).toBe(200)
  })

  it('alta asistida: el dueño entra con contraseña temporal y debe cambiarla', async () => {
    const s = setup()
    const a = await s.adminToken()
    const r = await s.call('POST', '/admin/businesses', { token: a, body: { businessName: 'Ferre Juan', ownerName: 'Juan', phone: '5544332211', tempPassword: 'temporal123', trialDays: 7 } })
    expect(r.status).toBe(201)
    expect(r.json.business.trialDays).toBe(7)
    const l = await s.call('POST', '/auth/owner/login', { body: { phone: '5544332211', password: 'temporal123' } })
    const v = await s.call('POST', '/auth/owner/verify', { body: { challengeId: l.json.challengeId, code: s.codes['5544332211'] } })
    expect(v.json.mustChangePassword).toBe(true)
    expect((await s.call('GET', '/users', { token: v.json.token })).status).toBe(403)
  })

  it('límite de usuarios y sucursales del plan; bajar de plan desactiva sobrantes sin borrar', async () => {
    const s = setup()
    const a = await s.adminToken()
    const o = await s.registerOwner()
    await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
    const id = (await s.call('GET', '/admin/businesses', { token: a })).json.businesses[0].id
    await s.createStaff(o.token, o.business.code, 'usr1', 'cajero')
    await s.createStaff(o.token, o.business.code, 'usr2', 'cajero')
    const over = await s.call('POST', '/users', { token: o.token, body: { name: 'usr3', username: 'usr3', password: 'inicial123' } })
    expect(over.json.error.code).toBe('limite_usuarios') // Inicial = 3 con el dueño
    expect((await s.call('POST', '/branches', { token: o.token, body: { name: 'Centro' } })).json.error.code).toBe('limite_sucursales')

    // En prueba el cambio aplica al momento.
    await s.call('PATCH', `/admin/businesses/${id}`, { token: a, body: { plan: 'crecimiento', extraBranches: 1 } })
    const u3 = await s.createStaff(o.token, o.business.code, 'usr3', 'cajero')
    await s.createStaff(o.token, o.business.code, 'usr4', 'cajero')
    expect((await s.call('POST', '/branches', { token: o.token, body: { name: 'Centro' } })).status).toBe(201)

    // Ya activo: bajar de plan queda pendiente hasta el siguiente pago.
    await s.call('POST', `/admin/businesses/${id}/payments`, { token: a, body: { months: 1 } })
    const pend = await s.call('PATCH', `/admin/businesses/${id}`, { token: a, body: { plan: 'inicial', extraBranches: 0 } })
    expect(pend.json.business.plan.plan).toBe('crecimiento')
    expect(pend.json.business.pendingPlan.plan).toBe('inicial')
    expect((await s.call('GET', '/auth/me', { token: u3.token })).status).toBe(200)

    const pay = await s.call('POST', `/admin/businesses/${id}/payments`, { token: a, body: { months: 1 } })
    expect(pay.json.business.plan.plan).toBe('inicial')
    expect(pay.json.business.usage).toEqual({ users: 3, branches: 1 })
    expect((await s.call('GET', '/auth/me', { token: u3.token })).status).toBe(401) // sobrante desactivado
    expect((s.db.prepare('SELECT COUNT(*) n FROM users').get() as any).n).toBe(5) // nada borrado
  })

  it('restablecer acceso del dueño desde el super panel', async () => {
    const s = setup()
    const a = await s.adminToken()
    const o = await s.registerOwner()
    const b = (await s.call('GET', '/admin/businesses', { token: a })).json.businesses[0]
    const r = await s.call('POST', `/admin/businesses/${b.id}/users/${b.owner.id}/reset-password`, { token: a, body: { newPassword: 'nuevaclave1', reason: 'Identidad verificada por videollamada' } })
    expect(r.status).toBe(200)
    expect((await s.call('GET', '/auth/me', { token: o.token })).status).toBe(401)
    expect((await s.call('POST', '/auth/owner/login', { body: { phone: o.phone, password: 'nuevaclave1' } })).status).toBe(200)
  })

  it('el super panel no tiene rutas a ventas internas', async () => {
    const s = setup()
    const a = await s.adminToken()
    for (const p of ['/admin/sales', '/admin/businesses/x/sales', '/sales']) expect((await s.call('GET', p, { token: a })).status).toBeGreaterThanOrEqual(401)
  })
})

describe('buzón y solicitudes', () => {
  it('soporte: el cliente pregunta, el super panel responde en el mismo buzón', async () => {
    const s = setup()
    const a = await s.adminToken()
    const o = await s.registerOwner()
    const t = await s.call('POST', '/support/tickets', { token: o.token, body: { type: 'soporte', subject: 'No imprime', message: 'La impresora no saca el ticket' } })
    expect(t.json.ticket.status).toBe('abierto')
    const unread = await s.call('GET', '/admin/tickets?unread=1', { token: a })
    expect(unread.json.tickets).toHaveLength(1)
    await s.call('POST', `/admin/tickets/${t.json.ticket.id}/messages`, { token: a, body: { message: 'Revisa el cable USB' } })
    const list = await s.call('GET', '/support/tickets', { token: o.token })
    expect(list.json.tickets[0]).toMatchObject({ status: 'respondido', unread: 1 })
    const view = await s.call('GET', `/support/tickets/${t.json.ticket.id}`, { token: o.token })
    expect(view.json.ticket.messages.map((m: any) => m.author)).toEqual(['cliente', 'soporte'])
  })

  it('solicitud de cambio indica módulo y el cliente ve su estado', async () => {
    const s = setup()
    const a = await s.adminToken()
    const o = await s.registerOwner()
    const noMod = await s.call('POST', '/support/tickets', { token: o.token, body: { type: 'cambio', subject: 'Agregar báscula', message: 'Quiero báscula' } })
    expect(noMod.status).toBe(400)
    const t = await s.call('POST', '/support/tickets', { token: o.token, body: { type: 'cambio', subject: 'Agregar báscula', module: 'abarrotes', message: 'Quiero báscula' } })
    expect(t.json.ticket.status).toBe('enviada')
    expect((await s.call('PATCH', `/admin/tickets/${t.json.ticket.id}`, { token: a, body: { status: 'cerrado' } })).status).toBe(400)
    await s.call('PATCH', `/admin/tickets/${t.json.ticket.id}`, { token: a, body: { status: 'aceptada' } })
    expect((await s.call('GET', `/support/tickets/${t.json.ticket.id}`, { token: o.token })).json.ticket.status).toBe('aceptada')
  })

  it('el buzón es privado: ni otro negocio ni los empleados lo ven', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const o2 = await s.registerOwner('5598765432')
    const t = await s.call('POST', '/support/tickets', { token: o.token, body: { type: 'soporte', subject: 'Duda', message: 'Hola' } })
    expect((await s.call('GET', `/support/tickets/${t.json.ticket.id}`, { token: o2.token })).status).toBe(404)
    expect((await s.call('GET', '/support/tickets', { token: o2.token })).json.tickets).toHaveLength(0)
    await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
    const e = await s.createStaff(o.token, o.business.code, 'ana', 'encargado')
    expect((await s.call('GET', '/support/tickets', { token: e.token })).status).toBe(403)
  })
})
