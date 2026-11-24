// Fase 3: dashboards (Inicio): «Requiere tu atención» arriba, secciones con el color de su módulo, selector de periodo.
// Solo datos de prueba en memoria. Uso: npm run build && npx tsx scripts/verificacion/dashboards.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-dash'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const browser = await chromium.launch()
for (const giro of ['abarrotes', 'barberia', 'restaurante', 'ferreteria']) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['tableta', { width: 768, height: 1024 }], ['celular', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((t: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, own.json.token)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/inicio'); await page.waitForTimeout(1500)
    const pos = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')]; const y = (t: string) => h.find((x) => x.textContent?.includes(t))?.getBoundingClientRect().top ?? -1; return { atencion: y('Requiere tu atención') + y('Todo al día') + 1, real: y('Ganancia real') } })
    const sec = await page.locator('.seccion').count()
    const colores = await page.evaluate(() => [...document.querySelectorAll('.seccion')].map((e) => getComputedStyle(e).borderTopColor))
    ok(sec >= 3 && new Set(colores).size >= 2, `[${giro}/${dev}] secciones con el color de su módulo (${sec}, ${new Set(colores).size} colores)`)
    const titulos = await page.locator('h2').allInnerTexts()
    ok(titulos.some((t: string) => /Requiere tu atención|Todo al día/.test(t)) || (await page.locator('.tasks-empty').count()) > 0, `[${giro}/${dev}] bloque «Requiere tu atención» o «Todo al día» visible`)
    ok(pos.real < 0 || pos.atencion - 1 < pos.real || pos.atencion < 0, `[${giro}/${dev}] la atención va antes de la ganancia real`)
    await page.screenshot({ path: `${shots}/${dev}-${giro}.png` })
    await page.getByRole('button', { name: '30 días' }).click(); await page.waitForTimeout(700)
    const barras = await page.locator('svg.chart rect').count()
    ok(barras >= 25 && /30 días/.test(await page.locator('h2', { hasText: 'Ventas de 30' }).innerText()), `[${giro}/${dev}] el selector cambia a 30 días (${barras} barras)`)
    await page.getByRole('button', { name: '7 días' }).click(); await page.waitForTimeout(500)
    ok((await page.locator('svg.chart rect').count()) <= 8, `[${giro}/${dev}] y vuelve a 7 días`)
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) && !errs.length, `[${giro}/${dev}] sin desborde ni errores${errs[0] ? ' ' + errs[0] : ''}`)
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
