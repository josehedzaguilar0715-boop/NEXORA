// Páginas públicas de cara al cliente final (reservar cita, boletos, tarjeta de sellos) con la identidad única de NEXORA:
// contraste, letra ≥ 18 px en celular, desborde, encimados y nombres accesibles, en claro/oscuro y 3 tamaños.
// Datos de demostración en memoria. Uso: npm run build && npx tsx scripts/verificacion/publicas.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-publicas'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const rutas: [string, string][] = []
for (const [giro, ruta] of [['barberia', 'reservar'], ['unas', 'reservar'], ['turistico', 'boletos']] as const) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  const id = (s.db.prepare('SELECT id FROM businesses WHERE giro = ?').get(giro) as { id: string }).id
  // Las páginas públicas son un extra de pago: se activa en el negocio de prueba (como en la verificación de los 14 productos).
  await s.call('POST', `/admin/businesses/${id}/addons`, { token: at, body: { addon: 'reservas', installationFee: 0, note: 'verificación de páginas públicas' } })
  const mods = (await s.call('GET', '/modules', { token: own.json.token })).json.active as string[]
  if (!mods.includes('reservas')) await s.call('PUT', '/modules', { token: own.json.token, body: { active: [...mods, 'reservas'] } })
  const slug = (await s.call('GET', '/business/public-link', { token: own.json.token })).json.slug as string
  const biz = { public_slug: slug, code: slug }
  rutas.push([`${giro}/${ruta}`, `/${ruta}/${biz.public_slug ?? biz.code}`])
}
const browser = await chromium.launch(); let fails = 0, n = 0
const VP = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } }
for (const [vp, size] of Object.entries(VP)) for (const modo of ['claro', 'oscuro']) for (const [nombre, ruta] of rutas) {
  const ctx = await browser.newContext({ viewport: size })
  await ctx.addInitScript((m: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_modo', m) }, modo)
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + ruta); await page.waitForTimeout(1100); n++
  const a = await page.evaluate(auditoria)
  const bad = errs.length || a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length || a.cortados.length
  if (bad) { fails++; console.log(`✗ [${vp}/${modo}] ${nombre}: ${errs[0] ?? ''}${a.overflow ? ' DESBORDA' : ''}${a.bad.length ? ` contraste(${a.bad.length}): ${a.bad.slice(0, 2).join(' | ')}` : ''}${a.small.length ? ` letra<18(${a.small.length}): ${a.small.slice(0, 2).join(' | ')}` : ''}${a.encimados.length ? ` ENCIMADOS: ${a.encimados.slice(0, 2).join(' | ')}` : ''}${a.sinNombre.length ? ` SIN NOMBRE: ${[...new Set(a.sinNombre)].slice(0, 3).join(',')}` : ''}${a.cortados.length ? ` TEXTO CORTADO(${a.cortados.length}): ${a.cortados.slice(0, 3).join(' | ')}` : ''}`) }
  if (modo === 'claro') await page.screenshot({ path: `${shots}/${vp}-${nombre.replace('/', '-')}.png` })
  await ctx.close()
}
await browser.close(); server.close()
console.log(`\n${n} páginas públicas (3 negocios × claro/oscuro × 3 tamaños) · con hallazgos: ${fails}`)
process.exit(fails ? 1 : 0)
