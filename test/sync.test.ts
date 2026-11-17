import { describe, expect, it } from 'vitest'
import { Outbox, type Transport } from '../src/client/outbox.js'
import { openDb } from '../src/db.js'
import { setup } from './helpers.js'

async function negocio() {
  const s = setup()
  const o = await s.registerOwner()
  await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
  const cajero = await s.createStaff(o.token, o.business.code, 'caja1', 'cajero')
  const encargado = await s.createStaff(o.token, o.business.code, 'enc1', 'encargado')
  return { s, o, cajero, encargado }
}

/** Transporte que habla con la app en memoria; `online` simula la señal. */
function transport(s: ReturnType<typeof setup>, token: string, state: { online: boolean }): Transport {
  return async (r) => {
    if (!state.online) throw new Error('sin red')
    const res = await s.app.request(r.path, {
      method: r.method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': r.id },
      body: JSON.stringify(r.body),
    })
    return { status: res.status, json: await res.json() }
  }
}

describe('sin internet', () => {
  it('opera varios días sin señal y al volver sincroniza sin duplicar', async () => {
    const { s, o, cajero } = await negocio()
    const outbox = new Outbox(openDb(':memory:'))
    const net = { online: false }
    const send = transport(s, cajero.token, net)
    const shiftId = s.uuid()
    const day1 = '2026-11-14T15:00:00.000Z'
    const day2 = '2026-11-15T15:00:00.000Z'

    outbox.enqueue('POST', '/shifts/open', { id: shiftId, at: day1, openingFloat: 10000 })
    const saleA = s.uuid()
    const saleB = s.uuid()
    outbox.enqueue('POST', '/sales', { id: saleA, shiftId, createdAt: '2026-11-14T16:00:00.000Z', paymentMethod: 'efectivo', items: [{ description: 'Leche', quantity: 1, unitPrice: 2500 }] })
    outbox.enqueue('POST', '/sales', { id: saleB, shiftId, createdAt: day2, paymentMethod: 'efectivo', items: [{ description: 'Pan', quantity: 2, unitPrice: 1000 }] })
    outbox.enqueue('POST', `/shifts/${shiftId}/close`, { at: '2026-11-15T22:00:00.000Z', countedCash: 14500 })
    expect(outbox.pending()).toBe(4)

    expect(await outbox.flush(send)).toMatchObject({ sent: 0, stopped: true }) // sin señal
    expect(outbox.pending()).toBe(4)

    net.online = true
    expect(await outbox.flush(send)).toEqual({ sent: 4, rejected: 0, stopped: false })
    expect(outbox.pending()).toBe(0)
    const sh = s.db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as any
    expect(sh.status).toBe('cerrado')
    expect(sh.opened_at).toBe(day1) // conserva la hora real, no la del reenvío
    expect(sh.difference).toBe(0)
    expect((s.db.prepare('SELECT created_at FROM sales WHERE id = ?').get(saleA) as any).created_at).toBe('2026-11-14T16:00:00.000Z')

    // Reenvío completo (p. ej. la respuesta se perdió): nada se duplica.
    const again = new Outbox(openDb(':memory:'))
    again.enqueue('POST', '/shifts/open', { id: shiftId, at: day1, openingFloat: 10000 })
    again.enqueue('POST', '/sales', { id: saleA, shiftId, createdAt: day1, paymentMethod: 'efectivo', items: [{ description: 'Leche', quantity: 1, unitPrice: 2500 }] })
    expect(await again.flush(send)).toMatchObject({ sent: 2 })
    expect((s.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(2)
    expect((s.db.prepare('SELECT COUNT(*) n FROM shifts').get() as any).n).toBe(1)

    // El dueño lo ve en la nube.
    const dash = await s.call('GET', '/dashboard', { token: o.token })
    expect(dash.status).toBe(200)
  })

  it('misma llave de idempotencia devuelve la respuesta original sin ejecutar otra vez', async () => {
    const { s, cajero } = await negocio()
    await s.call('POST', '/shifts/open', { token: cajero.token, body: { openingFloat: 0 } })
    const call = async (key: string) =>
      s.app.request('/sales', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cajero.token}`, 'idempotency-key': key },
        body: JSON.stringify({ id: s.uuid(), paymentMethod: 'efectivo', items: [{ description: 'X', quantity: 1, unitPrice: 100 }] }),
      })
    const a = await call('k1')
    const b = await call('k1') // otro id de venta, misma llave → se ignora
    expect(b.headers.get('idempotent-replay')).toBe('true')
    expect(await b.json()).toEqual(await a.json())
    expect((s.db.prepare('SELECT COUNT(*) n FROM sales').get() as any).n).toBe(1)
  })

  it('un rechazo definitivo se marca para revisión y no se pierde', async () => {
    const { s, cajero } = await negocio()
    const outbox = new Outbox(openDb(':memory:'))
    const send = transport(s, cajero.token, { online: true })
    outbox.enqueue('POST', '/sales', { id: s.uuid(), paymentMethod: 'efectivo', items: [{ description: 'X', quantity: 1, unitPrice: 100 }] }) // sin caja abierta
    expect(await outbox.flush(send)).toMatchObject({ rejected: 1 })
    expect(outbox.pending()).toBe(0)
    expect(outbox.rejected()[0]!.error).toContain('caja')
  })
})

describe('conflictos entre equipos', () => {
  const change = (s: ReturnType<typeof setup>, data: object, updatedAt: string, baseVersion: number) => ({
    opId: s.uuid(), entity: 'producto', entityId: 'p1', data, updatedAt, baseVersion,
  })

  it('gana el movimiento más reciente y el conflicto queda para revisión', async () => {
    const { s, o, encargado } = await negocio()
    const push = (device: string, c: any) => s.call('POST', '/sync/changes', { token: encargado.token, body: { deviceId: device, changes: [c] } })
    expect((await push('caja-A', change(s, { precio: 1000 }, '2026-11-17T10:00:00.000Z', 0))).json.results[0].version).toBe(1)
    // Ambas cajas parten de la versión 1 sin verse
    const b = await push('caja-B', change(s, { precio: 1200 }, '2026-11-17T11:00:00.000Z', 1))
    expect(b.json.results[0].status).toBe('aplicado')
    const a = await push('caja-A', change(s, { precio: 1100 }, '2026-11-17T10:30:00.000Z', 1)) // más viejo que B
    expect(a.json.results[0].status).toBe('conflicto_pierde')
    const state = s.db.prepare("SELECT data FROM sync_state WHERE entity_id = 'p1'").get() as any
    expect(JSON.parse(state.data).precio).toBe(1200)

    const pend = await s.call('GET', '/sync/conflicts', { token: o.token })
    expect(pend.json.conflicts).toHaveLength(1)
    expect(pend.json.conflicts[0].loser.precio).toBe(1100)
    await s.call('POST', `/sync/conflicts/${pend.json.conflicts[0].id}/reviewed`, { token: o.token })
    expect((await s.call('GET', '/sync/conflicts', { token: o.token })).json.conflicts).toHaveLength(0)
    // el perdedor sigue guardado (nada se borra)
    expect((s.db.prepare('SELECT COUNT(*) n FROM sync_changes').get() as any).n).toBe(3)
  })

  it('un cambio nuevo más reciente sobre versión vieja también gana, marcado', async () => {
    const { s, encargado } = await negocio()
    const push = (device: string, c: any) => s.call('POST', '/sync/changes', { token: encargado.token, body: { deviceId: device, changes: [c] } })
    await push('A', change(s, { precio: 1 }, '2026-11-17T10:00:00.000Z', 0))
    await push('B', change(s, { precio: 2 }, '2026-11-17T10:10:00.000Z', 1))
    const r = await push('A', change(s, { precio: 3 }, '2026-11-17T12:00:00.000Z', 1))
    expect(r.json.results[0].status).toBe('conflicto_gana')
  })

  it('reenviar el mismo cambio no hace nada y los demás equipos lo descargan', async () => {
    const { s, encargado } = await negocio()
    const c1 = change(s, { precio: 5 }, '2026-11-17T10:00:00.000Z', 0)
    const body = { deviceId: 'A', changes: [c1] }
    await s.call('POST', '/sync/changes', { token: encargado.token, body })
    const dup = await s.call('POST', '/sync/changes', { token: encargado.token, body })
    expect(dup.json.results[0].status).toBe('duplicado')
    const pull = await s.call('GET', '/sync/changes?since=0', { token: encargado.token })
    expect(pull.json.changes).toHaveLength(1)
    expect((await s.call('GET', `/sync/changes?since=${pull.json.next}`, { token: encargado.token })).json.changes).toHaveLength(0)
  })

  it('un negocio no ve cambios de otro', async () => {
    const { s, encargado } = await negocio()
    await s.call('POST', '/sync/changes', { token: encargado.token, body: { deviceId: 'A', changes: [change(s, { x: 1 }, '2026-11-17T10:00:00.000Z', 0)] } })
    const o2 = await s.registerOwner('5598765432')
    expect((await s.call('GET', '/sync/changes', { token: o2.token })).json.changes).toHaveLength(0)
  })
})
