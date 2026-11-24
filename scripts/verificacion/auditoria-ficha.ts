// Ficha de producto (ventana con pestañas): auditoría de cada pestaña en claro/oscuro y 3 tamaños. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/auditoria-ficha.ts
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const r = await s.call('POST', '/admin/demos/abarrotes', { token: at })
let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
const browser = await chromium.launch()
let fails = 0
for (const modo of ['claro', 'oscuro']) for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['tableta', { width: 768, height: 1024 }], ['celular', { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [own.json.token, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(`${base}/#/productos`); await page.waitForTimeout(1200)
  await page.locator('.list.products tbody tr, .cards-sm tbody tr').first().click(); await page.waitForTimeout(700)
  const tabs: string[] = await page.locator('.modal .subtabs button, .sheet .subtabs button, [role=dialog] .subtabs button').allInnerTexts()
  const malos: string[] = []
  for (const t of ['(datos)', ...tabs]) {
    if (t !== '(datos)') await page.getByRole('button', { name: t, exact: true }).first().click().catch(() => {}); await page.waitForTimeout(400)
    const a = await page.evaluate(auditoria)
    const n = a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length || a.cortados.length
    if (n) malos.push(`${t}:${a.overflow ? ' DESBORDA' : ''}${a.bad.length ? ` contraste ${a.bad.slice(0, 2)}` : ''}${a.small.length ? ` letra ${a.small.slice(0, 2)}` : ''}${a.encimados.length ? ` encimados ${a.encimados.slice(0, 2)}` : ''}${a.sinNombre.length ? ` sin nombre ${a.sinNombre.slice(0, 2)}` : ''}${a.cortados.length ? ` cortados ${a.cortados.slice(0, 2)}` : ''}`)
  }
  const ok = malos.length === 0 && !errs.length
  if (!ok) fails++
  console.log(`${ok ? '✓' : '✗'} ficha de producto ${modo}/${dev} (${tabs.length + 1} vistas)${malos.length ? ': ' + malos.join(' || ') : ''}${errs[0] ? ' ' + errs[0] : ''}`)
  await ctx.close()
}
await browser.close(); server.close(); process.exit(fails ? 1 : 0)
