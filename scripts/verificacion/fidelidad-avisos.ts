// Aviso «te falta 1 sello» (Pendientes de hoy): tarjeta con cada cliente y su WhatsApp listo; escritorio y celular, claro y oscuro. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/fidelidad-avisos.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'
const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-fidelidad'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const r = await s.call('POST', '/admin/demos/barberia', { token: at })
let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
const T = own.json.token as string
const call = (m: string, p: string, b?: unknown) => s.call(m, p, { token: T, body: b })
const mods = (await call('GET', '/modules')).json.active as string[]
await call('PUT', '/modules', { active: [...new Set([...mods, 'fidelidad'])] })
await call('PUT', '/loyalty', { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 })
await call('POST', '/loyalty/rewards', { name: 'Facial', cost: 5 })
await call('POST', '/loyalty/rewards', { name: 'Corte gratis', cost: 10 })
const cli = async (name: string, phone: string, n: number) => { const c = (await call('POST', '/customers', { name, phone })).json.customer; if (n) await call('POST', `/customers/${c.id}/stamps/adjust`, { delta: n, reason: 'Sellos' }) }
await cli('Ana López', '5511111111', 4); await cli('Marcos Ruiz', '5522222222', 4); await cli('Beto Soto', '5533333333', 9); await cli('Carla Paz', '5544444444', 2)
const browser = await chromium.launch()
for (const modo of ['claro', 'oscuro']) for (const [vn, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 })
  await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [T, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + '/#/inicio'); await page.waitForTimeout(1500)
  const tarjeta = page.locator('text=a 1 sello de su premio').first()
  ok(await tarjeta.count() > 0, `[${vn}/${modo}] Inicio muestra «clientes a 1 sello de su premio»`)
  // abre el detalle de la tarea si está plegado
  const tarea = page.locator('.task', { hasText: 'a 1 sello de su premio' }).first()
  await tarea.getByRole('button', { name: 'Ver', exact: true }).click(); await page.waitForTimeout(500)
  await tarea.scrollIntoViewIfNeeded()
  const lista = await tarea.innerText()
  ok(lista.includes('Ana López') && lista.includes('Marcos Ruiz') && lista.includes('Beto Soto') && !lista.includes('Carla Paz'), `[${vn}/${modo}] lista a Ana, Marcos y Beto (no a Carla, que lleva 2)`)
  const wa = await tarea.locator('a[href^="https://wa.me/52"]').evaluateAll((els: HTMLAnchorElement[]) => els.map((e) => decodeURIComponent(e.href)))
  ok(wa.some((h: string) => h.includes('te falta solo 1 sello para tu Facial')) && wa.some((h: string) => h.includes('Corte gratis')), `[${vn}/${modo}] cada cliente tiene su WhatsApp listo con su premio (Facial y Corte gratis)`)
  const x = await page.evaluate(auditoria)
  ok(!x.overflow && !x.bad.length && !x.small.length && !x.encimados.length && !x.sinNombre.length, `[${vn}/${modo}] contraste, letra y desborde ${JSON.stringify([x.bad.slice(0, 2), x.small.slice(0, 2)])}`)
  ok(errs.length === 0, `[${vn}/${modo}] sin errores de JS ${errs[0] ?? ''}`)
  await page.screenshot({ path: `${shots}/${vn}-${modo}.png`, fullPage: false }); await ctx.close()
}
await browser.close(); server.close()
console.log(fails ? `\n✗ ${fails} fallas` : '\nTodo en orden'); process.exit(fails ? 1 : 0)
