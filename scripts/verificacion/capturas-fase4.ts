// Capturas de las pantallas operativas rediseñadas (fase 4), claro y oscuro, computadora y celular. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/capturas-fase4.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const dir = process.argv[2] ?? 'docs/modernizacion/capturas'; mkdirSync(dir, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const browser = await chromium.launch()
const CASOS: [string, string, string][] = [
  ['abarrotes', 'caja', 'caja'], ['abarrotes', 'clientes', 'clientes'], ['abarrotes', 'compras', 'compras'], ['abarrotes', 'productos', 'productos'], ['abarrotes', 'apartados', 'apartados'],
  ['abarrotes', 'finanzas', 'finanzas-mi-dinero'],
  ['restaurante', 'mesas', 'mesas'], ['restaurante', 'cocina', 'cocina'],
  ['turistico', 'taquilla', 'taquilla'], ['barberia', 'agenda', 'agenda'], ['barberia', 'clientes', 'clientes-barberia'],
]
for (const [giro, pantalla, nombre] of CASOS) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const modo of ['claro', 'oscuro']) for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
    if (modo === 'oscuro' && dev === 'celular') continue
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [own.json.token, modo])
    const page = await ctx.newPage()
    await page.goto(`${base}/#/${pantalla}`); await page.waitForTimeout(1400)
    await page.screenshot({ path: `${dir}/${nombre}-${dev}-${modo}.png` })
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log('capturas listas en', dir)
