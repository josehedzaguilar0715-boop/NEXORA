// Matriz de acceso a rutas de lectura por puesto (dueño / encargado / empleado), con datos de prueba en memoria.
// Lista qué rutas GET (sin parámetros) responde 200 a cada puesto, para auditar qué ve cada quien.
// Uso: npx tsx scripts/verificacion/permisos-rutas.ts
import { readdirSync, readFileSync } from 'node:fs'
import { dosSucursales } from '../../test/sucursales-fixture.js'

const f = await dosSucursales()
const rutas = new Set<string>()
for (const file of readdirSync('src').filter((x) => x.endsWith('.ts') && !['admin.ts', 'assets.gen.ts'].includes(x)))
  for (const m of readFileSync(`src/${file}`, 'utf8').matchAll(/\.get\('(\/[^':]*)'/g)) rutas.add(m[1]!)
const lista = [...rutas].filter((x) => !x.startsWith('/public/') && !x.startsWith('/admin') && x !== '/health').sort()
const quien = { dueno: f.T, encargado: f.enc1.token, empleado: f.e1a.token }
const res: Record<string, Record<string, number>> = {}
for (const r of lista) {
  res[r] = {}
  for (const [k, t] of Object.entries(quien)) res[r]![k] = (await f.s.app.request(r, { headers: { authorization: `Bearer ${t}` } })).status
}
const abiertas = (p: string) => lista.filter((r) => res[r]![p] === 200)
console.log(`Rutas de lectura: ${lista.length}`)
for (const p of ['dueno', 'encargado', 'empleado']) console.log(`${p}: 200 en ${abiertas(p).length}`)
console.log('\nEMPLEADO puede leer (200):\n' + abiertas('empleado').join('\n'))
console.log('\nENCARGADO puede leer y EMPLEADO no:\n' + lista.filter((r) => res[r]!.encargado === 200 && res[r]!.empleado !== 200).join('\n'))
