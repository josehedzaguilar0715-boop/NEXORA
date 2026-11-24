// Capturas de las 12 pantallas de la última etapa (claro): computadora y celular. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/capturas-pendientes.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const dir = process.argv[2] ?? '/tmp/pend'; mkdirSync(dir, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const browser = await chromium.launch()
const CASOS: [string, string, string][] = [
  ['abarrotes', 'configurar', 'configurar'], ['abarrotes', 'usuarios', 'personal'], ['abarrotes', 'productos', 'productos'], ['ferreteria', 'devoluciones', 'devoluciones'],
  ['banos', 'entradas', 'entradas'], ['turistico', 'acceso', 'acceso'], ['abarrotes', 'importar', 'importar'], ['barberia', 'lealtad', 'lealtad'],
  ['ferreteria', 'cotizaciones', 'cotizaciones'], ['papeleria', 'encargos', 'encargos'], ['verduleria', 'precios', 'verduleria'], ['taqueria', 'carne', 'trompo'], ['comedor', 'menu', 'menu'],
]
for (const [giro, pantalla, nombre] of CASOS) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((t: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, own.json.token)
    const page = await ctx.newPage()
    await page.goto(`${base}/#/${pantalla}`); await page.waitForTimeout(1300)
    await page.screenshot({ path: `${dir}/${nombre}-${dev}.png` })
    await ctx.close()
  }
}
await browser.close(); server.close()
