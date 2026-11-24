// Los 13 giros (14 productos con la base NEXORA) con «Respaldo y exportación de datos»: cada demo conserva su identidad
// visual, la sección existe y funciona, en escritorio y celular, sin errores. Solo datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/productos-datos.ts
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const EXPECT: Record<string, string> = { abarrotes: 'market', ferreteria: 'tools', papeleria: 'paper', barberia: 'barber', unas: 'nails', perfumeria: 'scent', banos: 'access', turistico: 'tour', palapa: 'beach', restaurante: 'dining', comedor: 'fonda', taqueria: 'taco', verduleria: 'greens' }
const s = setup()
const at = await s.adminToken()
const root = new Hono()
root.route('/api', s.app)
root.use('/*', serveStatic({ root: './web/dist' }))
root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 })
await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const browser = await chromium.launch()
const tokens: Record<string, string> = {}
for (const d of DEMOS) {
  const r = await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  tokens[d.giro] = own.json.token
}
for (const [device, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  for (const d of DEMOS) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((t: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, tokens[d.giro]!)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/configurar'); await page.waitForTimeout(1200)
    const product = await page.evaluate(() => document.documentElement.dataset.product)
    await page.getByRole('button', { name: 'Respaldo y exportación de datos' }).click()
    await page.waitForTimeout(500)
    const body = await page.innerText('body')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    ok(product === EXPECT[d.giro] && /Descargar mi información/.test(body) && /Qué contiene hoy/.test(body) && /Ventas/.test(body) && !errs.length && !overflow, `[${device}] ${d.giro}: identidad «${product}», sección completa, sin errores${overflow ? ', DESBORDA' : ''}${errs.length ? ' ' + errs[0] : ''}`)
    await ctx.close()
  }
}
// Producto base NEXORA: acceso sin sesión.
{ const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } }); await ctx.addInitScript(() => sessionStorage.setItem('nx_intro', '1')); const page = await ctx.newPage(); await page.goto(base); await page.waitForTimeout(1200); ok(!!(await page.evaluate(() => document.documentElement.dataset.product)), 'producto base NEXORA: el acceso conserva su identidad'); await ctx.close() }
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
