// Etapa 3: plano gráfico de mesas (lista/plano, sin encimarse, acomodar y conservar, desbordes). Datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/plano-mesas.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'
const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-plano'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const browser = await chromium.launch()
for (const giro of ['restaurante', 'palapa', 'taqueria', 'comedor']) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  const T = own.json.token as string
  if (((await s.call('GET', '/tables', { token: T })).json.tables as any[]).length === 0) for (const nm of ['1', '2', '3', '4']) await s.call('POST', '/tables', { token: T, body: { name: nm, area: 'salon', seats: 4 } })
  const n = ((await s.call('GET', '/tables', { token: T })).json.tables as any[]).length
  // Celular primero: después de acomodar en computadora el plano guardado ya no es el automático.
  for (const [vn, vp] of [['cel', { width: 390, height: 844 }], ['pc', { width: 1366, height: 900 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: vn === 'cel' })
    await ctx.addInitScript((tk: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', tk) }, T)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/mesas'); await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Plano', exact: true }).click(); await page.waitForTimeout(900)
    const cajas = await page.locator('.mesa-plano').evaluateAll((els: HTMLElement[]) => els.map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, zona: e.parentElement!.getAttribute('aria-label') } }))
    ok(cajas.length === n && n > 0, `[${giro}/${vn}] el plano muestra las ${n} mesas`)
    let choque = 0
    for (let i = 0; i < cajas.length; i++) for (let j = i + 1; j < cajas.length; j++) { const a = cajas[i]!, b = cajas[j]!; if (a.zona === b.zona && a.l < b.r - 2 && b.l < a.r - 2 && a.t < b.b - 2 && b.t < a.b - 2) choque++ }
    ok(choque === 0, `[${giro}/${vn}] ninguna mesa se encima con otra (${choque})`)
    if (choque) console.log(JSON.stringify(cajas.map((c: any) => [Math.round(c.l), Math.round(c.t), Math.round(c.r), Math.round(c.b), c.zona])))
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `[${giro}/${vn}] sin desborde horizontal`)
    if (vn === 'pc') {
      await page.getByRole('button', { name: 'Acomodar mesas' }).click()
      const m = page.locator('.mesa-plano').first(); const b = (await m.boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2 + 40, { steps: 6 }); await page.mouse.up()
      await page.getByRole('button', { name: 'Guardar plano' }).click(); await page.waitForTimeout(500)
      const plan = (await s.call('GET', '/tables/plan', { token: T })).json.plan as Record<string, unknown>
      ok(Object.keys(plan).length === n, `[${giro}/${vn}] el plano guardado conserva las ${n} mesas`)
      await page.reload(); await page.waitForTimeout(900)
      const antes = await page.locator('.mesa-plano').first().boundingBox()
      ok(!!antes && Math.abs(antes.x - (b.x + 120)) < 40, `[${giro}/${vn}] la mesa queda donde se acomodó tras recargar`)
      await page.getByRole('button', { name: 'Lista', exact: true }).click(); await page.waitForTimeout(200)
      ok(await page.locator('.mesa-plano').count() === 0 && await page.locator('.results button').count() >= n, `[${giro}/${vn}] la vista Lista sigue disponible`)
    }
    for (const modo of ['claro', 'oscuro']) {
      await page.evaluate((m: string) => { localStorage.setItem('nx_modo', m); document.documentElement.dataset.mode = m === 'claro' ? 'light' : 'dark' }, modo); await page.waitForTimeout(250)
      const a = await page.evaluate(auditoria)
      ok(!a.overflow && !a.bad.length && !a.small.length && !a.encimados.length && !a.sinNombre.length && !a.cortados.length, `[${giro}/${vn}/${modo}] auditoría de contraste, letra y nombres del plano ${JSON.stringify([a.bad.slice(0, 2), a.small.slice(0, 2), a.sinNombre.slice(0, 2)])}`)
    }
    ok(errs.length === 0, `[${giro}/${vn}] sin errores de JS ${errs[0] ?? ''}`)
    if (giro === 'restaurante' || giro === 'palapa') { await page.getByRole('button', { name: 'Plano', exact: true }).click().catch(() => {}); await page.waitForTimeout(200); await page.screenshot({ path: `${shots}/${giro}-${vn}.png`, fullPage: true }) }
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log(fails ? `✗ ${fails} fallas` : 'Todo en orden'); process.exit(fails ? 1 : 0)
