// Ticket en pantalla: ventas del turno → Reimprimir (58 y 80 mm). window.print se intercepta (no hay impresora): se revisa lo que se mandaría imprimir.
// Solo datos de prueba en memoria. Uso: npm run build && npx tsx scripts/verificacion/ticket.ts
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const r = await s.call('POST', '/admin/demos/abarrotes', { token: at })
let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
const T = own.json.token as string
const prod = (await s.call('GET', '/products', { token: T })).json.products[0]
if (!(await s.call('GET', '/shifts/current', { token: T })).json.shift) await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 10000 } })
await s.call('POST', '/sales', { token: T, body: { id: s.uuid(), items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'efectivo', cashReceived: 100000 } })
s.db.prepare("UPDATE businesses SET logo_url = 'http://localhost/logo.png'").run()
const saleId = (s.db.prepare('SELECT id FROM sales ORDER BY created_at DESC LIMIT 1').get() as { id: string }).id
const tok = (await s.call('POST', `/sales/${saleId}/receipt-link`, { token: T })).json
const browser = await chromium.launch()
for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript((t: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); (window as any).__impreso = []; window.print = () => { (window as any).__impreso.push(document.querySelector('.print-root pre')?.textContent ?? ''); (window as any).__logo = !!document.querySelector('.print-root img.ticket-logo') } }, T)
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + '/#/caja'); await page.waitForTimeout(1200)
  await page.keyboard.press('F9').catch(() => {}); await page.waitForTimeout(600)
  const re = page.getByRole('button', { name: 'Reimprimir' }).first()
  ok(await re.count() > 0, `[${dev}] «Ventas del turno» tiene botón Reimprimir`)
  await re.click(); await page.waitForTimeout(500)
  let imp: string[] = await page.evaluate(() => (window as any).__impreso)
  ok(imp.length === 1 && /REIMPRESIÓN/.test(imp[0]!) && /No es una\s+factura|No es una factura/.test(imp[0]!.replace(/\s+/g, ' ')) && Math.max(...imp[0]!.split('\n').map((l) => l.length)) <= 32, `[${dev}] reimpresión a 58 mm: marcada, sin pasar de 32 columnas y con «no es factura»`)
  await page.evaluate(() => localStorage.setItem('nx_papel', '80'))
  await page.getByRole('button', { name: 'Reimprimir' }).first().click(); await page.waitForTimeout(500)
  imp = await page.evaluate(() => (window as any).__impreso)
  ok(imp.length === 2 && Math.max(...imp[1]!.split('\n').map((l) => l.length)) <= 48 && Math.max(...imp[1]!.split('\n').map((l) => l.length)) > 32, `[${dev}] con papel de 80 mm usa hasta 48 columnas`)
  ok(await page.evaluate(() => (window as any).__logo === true), `[${dev}] el logotipo configurado va arriba del ticket impreso`)
  const pub = await ctx.newPage()
  await pub.goto(base + `/comprobante/${tok.token}`); await pub.waitForTimeout(1000)
  const pt = await pub.locator('body').innerText()
  ok(/Folio/.test(pt) && /No es una factura/.test(pt) && /Total/.test(pt), `[${dev}] el comprobante digital público muestra folio, total y «no es una factura»`)
  ok(!(await pub.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)), `[${dev}] el comprobante digital cabe en pantalla`)
  ok(!errs.length, `[${dev}] sin errores${errs[0] ? ' ' + errs[0] : ''}`)
  await ctx.close()
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} FALLAS` : '\nTodo en orden'); process.exit(fails ? 1 : 0)
