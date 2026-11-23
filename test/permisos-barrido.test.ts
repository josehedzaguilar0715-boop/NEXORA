import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

/**
 * Barrido de permisos: se leen del código todas las rutas que piden un permiso o ser dueño, y un empleado
 * que no tiene ese permiso debe recibir 403 en cada una (si se agrega una ruta nueva, entra sola a la prueba).
 */
type R = { method: string; path: string; owner: boolean; perms: string[] }
const routes: R[] = []
for (const f of readdirSync('src').filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(`src/${f}`, 'utf8')
  for (const m of src.matchAll(/^[a-zA-Z]+\.(get|post|put|patch|delete)\('([^']+)', (ownerOnly|requirePerm\(([^)]*)\))/gm)) {
    routes.push({ method: m[1]!.toUpperCase(), path: m[2]!, owner: m[3] === 'ownerOnly', perms: m[4] ? [...m[4].matchAll(/'([^']+)'/g)].map((x) => x[1]!) : [] })
  }
}
// Lo que tiene el puesto «Cocina» (el más limitado), más lo que todos tienen.
const HAS = ['kitchen', 'attendance', 'view_reports']

describe('barrido de permisos', () => {
  it(`${routes.length} rutas con permiso: un empleado sin ese permiso recibe 403 en todas`, async () => {
    const { s, o, T } = await negocioListo()
    const k = await s.createStaff(T, o.business.code, 'cocina1', 'cocina')
    await s.call('POST', '/auth/change-password', { token: k.token, body: { currentPassword: 'inicial123', newPassword: 'nueva12345' } })
    const fake = '00000000-0000-4000-8000-000000000000'
    const wrong: string[] = []
    let checked = 0
    for (const r of routes) {
      const denied = r.owner || (r.perms.length > 0 && !r.perms.some((p) => HAS.includes(p)))
      if (!denied) continue
      const path = r.path.replace(/:[a-zA-Z]+/g, fake)
      const res = await s.call(r.method, path, { token: k.token, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} })
      checked++
      if (res.status !== 403) wrong.push(`${r.method} ${r.path} → ${res.status}`)
    }
    expect(wrong).toEqual([])
    expect(checked).toBeGreaterThan(100)
  }, 60_000)
})
