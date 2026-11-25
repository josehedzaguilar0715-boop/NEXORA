// Etapa 1: menú esencial + «Otras herramientas», subtítulos de Acceso y Mercado. Datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/menu-simplificado.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-menu'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const browser = await chromium.launch()
const GIROS = ['barberia', 'unas', 'abarrotes', 'ferreteria', 'papeleria', 'perfumeria', 'banos', 'turistico', 'palapa', 'restaurante', 'comedor', 'taqueria', 'verduleria']
for (const giro of GIROS) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const [vn, vp] of [['pc', { width: 1366, height: 900 }], ['cel', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((tk: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', tk) }, own.json.token)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/inicio'); await page.waitForTimeout(900)
    if (vn === 'cel') { await page.getByRole('button', { name: 'Más' }).click(); await page.waitForTimeout(300) }
    const nav = vn === 'pc' ? page.locator('.rail') : page.locator('.hoja')
    const visibles = await nav.locator('.rail-item:visible').count()
    const mas = nav.locator('details.rail-mas')
    const hayMas = await mas.count()
    ok(hayMas === 1, `[${giro}/${vn}] hay «Otras herramientas» (${visibles} entradas a la vista)`)
    ok(visibles <= 16, `[${giro}/${vn}] menú diario ≤ 16 entradas (${visibles})`)
    await mas.locator('summary').click(); await page.waitForTimeout(200)
    ok(await mas.locator('.rail-item:visible').count() >= 2, `[${giro}/${vn}] al abrirlo se ven Soporte/Importar/Ajustes`)
    const sub = vn === 'pc' ? await page.locator('.brand2-txt small').first().innerText().catch(() => '') : ''
    if (vn === 'pc' && giro === 'verduleria') ok(sub.includes('Frutas y verduras'), `[${giro}/${vn}] subtítulo «Frutas y verduras»`)
    if (vn === 'pc' && giro === 'banos') ok(sub.includes('Baños y accesos'), `[${giro}/${vn}] subtítulo «Baños y accesos»`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `[${giro}/${vn}] sin desborde horizontal`)
    ok(errs.length === 0, `[${giro}/${vn}] sin errores de JS ${errs[0] ?? ''}`)
    if (['banos', 'verduleria', 'restaurante'].includes(giro)) await page.screenshot({ path: `${shots}/${giro}-${vn}.png` })
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log(fails ? `✗ ${fails} fallas` : 'Todo en orden'); process.exit(fails ? 1 : 0)
