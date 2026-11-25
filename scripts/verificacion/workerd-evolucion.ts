// Prueba de la evolución (escaparate, carta compartible, plano de mesas, primeros pasos) sobre el MOTOR REAL de Cloudflare
// (workerd + Durable Object con SQLite) en local, con un negocio nuevo de prueba. No toca producción.
// Uso: `npx wrangler dev --port 8799 > /tmp/dev.log` y luego: npx tsx scripts/verificacion/workerd-evolucion.ts http://localhost:8799 /tmp/dev.log
import { readFileSync } from 'node:fs'

const [base, logFile] = process.argv.slice(2)
if (!base || !logFile) throw new Error('Uso: tsx scripts/verificacion/workerd-evolucion.ts <url> <log>')
let token = ''
const raw = async (method: string, path: string, body?: unknown, tok = token) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let j: any = null; try { j = await r.json() } catch { /* sin cuerpo */ }
  return { status: r.status, json: j }
}
const call = async (method: string, path: string, body?: unknown, tok = token) => { const r = await raw(method, path, body, tok); if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`); return r.json }
let fails = 0
const ok = (c: unknown, what: string) => { console.log(`${c ? '✓' : '✗'} ${what}`); if (!c) fails++ }

const health = await (await fetch(`${base}/api/health`)).json() as { schema: number }
ok(health.schema === 48, `motor de Cloudflare: esquema ${health.schema} (esperado 48: esta evolución no agrega migraciones)`)
const phone = `55${String(Date.now()).slice(-8)}`
const reg = await call('POST', '/auth/register', { businessName: 'Negocio de prueba evolución', ownerName: 'Prueba', phone, password: 'secreto123' })
await new Promise((r) => setTimeout(r, 600))
if (reg.token) token = reg.token
else {
  const code = [...readFileSync(logFile, 'utf8').matchAll(new RegExp(`${phone}: (\\d{6})`, 'g'))].at(-1)?.[1]
  token = (await call('POST', '/auth/register/verify', { challengeId: reg.challengeId, code })).token
}
// Primeros pasos (existente, ahora con más giros)
const hoyTareas = await call('GET', '/today')
ok(hoyTareas.tasks.some((t: any) => t.key === 'primeros_pasos'), 'Primeros pasos aparecen en un negocio nuevo')
// Escaparate y carta
const slug = (await call('GET', '/business/public-link')).slug as string
await call('POST', '/products', { name: 'Tacos de pastor', unit: 'pieza', price: 3000, cost: 1000, attrs: { imagenUrl: 'https://ejemplo.com/t.jpg', descripcion: 'Con piña' } })
await call('POST', '/products', { name: 'Agua', unit: 'pieza', price: 2000, attrs: { imagenUrl: 'javascript:alert(1)' } })
ok((await raw('GET', `/public/carta/${slug}`, undefined, '')).status === 404, 'la carta no es pública por defecto')
ok((await raw('PUT', '/escaparate', { portadaUrl: 'http://inseguro.com/a.jpg' })).status === 400, 'portada http rechazada')
await call('PUT', '/escaparate', { publicarCarta: true, descripcion: 'Tacos y más', direccion: 'Centro', horario: 'Lun a Dom' })
const carta = await raw('GET', `/public/carta/${slug}`, undefined, '')
const txt = JSON.stringify(carta.json)
ok(carta.status === 200 && carta.json.profile.descripcion === 'Tacos y más', 'carta pública con perfil')
ok(carta.json.sections.flatMap((x: any) => x.items).find((i: any) => i.name === 'Agua')?.imageUrl === null, 'imagen insegura no sale')
ok(!/cost|stock|business_id/i.test(txt), 'la carta no expone costos, existencias ni ids internos')
await call('PUT', '/escaparate', { publicarCarta: false })
ok((await raw('GET', `/public/carta/${slug}`, undefined, '')).status === 404, 'al apagarla vuelve a no estar disponible')
// Plano de mesas
const t1 = (await call('POST', '/tables', { name: '1', area: 'salon', seats: 4 })).id as string
ok(Object.keys((await call('GET', '/tables/plan')).plan).length === 0, 'plano vacío al inicio')
const pl = await call('PUT', '/tables/plan', { [t1]: { x: 30, y: 40 }, ajena: { x: 1, y: 1 } })
ok(Object.keys(pl.plan).length === 1 && pl.plan[t1].x === 30, 'el plano guarda solo mesas propias')
ok((await raw('PUT', '/tables/plan', { [t1]: { x: 500, y: 0 } })).status === 400, 'posiciones fuera de rango rechazadas')
// Seguridad: sin sesión no hay acceso
ok((await raw('GET', '/escaparate', undefined, '')).status === 401 && (await raw('GET', '/tables/plan', undefined, '')).status === 401, 'sin sesión: 401 en escaparate y plano')
console.log(fails ? `\n✗ ${fails} fallas` : '\nTodo en orden en el motor de Cloudflare'); process.exit(fails ? 1 : 0)
