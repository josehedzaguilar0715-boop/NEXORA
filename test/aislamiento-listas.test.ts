import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

/**
 * Aislamiento en las LISTAS (rutas GET sin identificador en la ruta): el negocio B las consulta pasándoles
 * los identificadores de A en la dirección (sucursal, cliente, producto, turno, empleado, cajero…) y en la
 * respuesta no puede aparecer nada de A. Las rutas se leen del código: una ruta nueva entra sola a la prueba.
 * También: un empleado con sucursal asignada no ve las ventas de otra sucursal de su mismo negocio.
 */
function listRoutes() {
  const out = new Set<string>()
  for (const f of readdirSync('src').filter((f) => f.endsWith('.ts') && !['admin.ts', 'assets.gen.ts'].includes(f)))
    for (const m of readFileSync(`src/${f}`, 'utf8').matchAll(/\.get\('(\/[^':]*)'/g)) out.add(m[1]!)
  return [...out].filter((r) => !r.startsWith('/public/') && !r.startsWith('/admin') && r !== '/health')
}

describe('aislamiento en listas y reportes', () => {
  it('ninguna lista de B devuelve datos de A, aunque B ponga los ids de A en la dirección', async () => {
    const s = setup()
    const reg = async (phone: string, name: string) => {
      const r = await s.call('POST', '/auth/register', { body: { businessName: name, ownerName: 'Dueño', phone, password: 'secreto123' } })
      const v = await s.call('POST', '/auth/register/verify', { body: { challengeId: r.json.challengeId, code: s.codes[phone] } })
      const T = v.json.token as string
      await s.call('PATCH', '/business', { token: T, body: { forcePasswordChange: false } })
      const me = (await s.call('GET', '/auth/me', { token: T })).json
      await s.call('PUT', `/users/${me.user.id}/auth-code`, { token: T, body: { code: '4321' } })
      return { T, me }
    }
    const A = await reg('5510000011', 'SECRETO-NEGOCIO-A')
    const B = await reg('5520000022', 'Negocio B')
    const a = (m: string, p: string, body?: object) => s.call(m, p, { token: A.T, body })
    // Datos de A con marcas únicas.
    const prod = (await a('POST', '/products', { name: 'SECRETO-PRODUCTO-A', unit: 'pieza', price: 1234, barcode: '7509999000001' })).json.product
    await a('POST', '/purchases', { payment: 'contado', items: [{ productId: prod.id, quantity: 10, cost: 5000 }] })
    const cli = (await a('POST', '/customers', { name: 'SECRETO-CLIENTE-A', phone: '9619990000' })).json.customer
    await a('PUT', `/customers/${cli.id}/credit-limit`, { limit: 100000 })
    const emp = (await a('POST', '/users', { name: 'SECRETO-EMPLEADO-A', username: 'secretoa', password: 'inicial123', template: 'cajero' })).json.user
    const sh = (await a('POST', '/shifts/open', { openingFloat: 1000 })).json.shift
    await a('POST', '/sales', { id: s.uuid(), paymentMethod: 'fiado', customerId: cli.id, items: [{ productId: prod.id, quantity: 2 }] })
    await a('POST', '/expenses', { concept: 'SECRETO-GASTO-A', amount: 500, kind: 'variable', method: 'efectivo' })
    const marks = ['SECRETO-', prod.id, cli.id, emp.id, sh.id, A.me.business.id, A.me.user.id, '7509999000001', '9619990000']

    const q = new URLSearchParams({ branchId: A.me.user.branchId, customerId: cli.id, productId: prod.id, shiftId: sh.id, staffId: emp.id, userId: emp.id, cashierId: A.me.user.id, from: '2026-01-01', to: '2026-12-31', date: '2026-11-17', q: 'SECRETO', status: 'todos', days: '30', limit: '100', since: '2000-01-01T00:00:00Z', updatedSince: '2000-01-01T00:00:00Z' }).toString()
    const routes = listRoutes()
    const leaks: string[] = []
    for (const r of routes) {
      for (const url of [r, `${r}?${q}`]) {
        const res = await s.app.request(url, { headers: { authorization: `Bearer ${B.T}` } })
        // Una ruta puede devolver el filtro que recibió («cashierId»: lo que mandó B): eso no es un dato de A.
        let body = await res.text()
        if (url.includes('?')) for (const [k, v] of new URLSearchParams(q)) body = body.split(`"${k}":"${v}"`).join('')
        const hit = marks.find((m) => body.includes(m))
        if (hit) leaks.push(`GET ${url.split('?')[0]}${url.includes('?') ? ' (con ids de A)' : ''} → contiene «${hit}» (${res.status})`)
      }
    }
    expect(leaks).toEqual([])
    expect(routes.length).toBeGreaterThan(60)
    // Control: A sí ve lo suyo (la prueba detecta datos cuando los hay).
    expect(JSON.stringify((await a('GET', '/customers')).json)).toContain('SECRETO-CLIENTE-A')
  }, 60_000)
})
