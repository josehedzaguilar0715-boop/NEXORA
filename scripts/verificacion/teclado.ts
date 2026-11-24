// Accesibilidad con teclado en navegador real: saltar al contenido, buscador con «/» y Esc, hoja «Más» con Esc, orden de foco.
// Datos de demostración en memoria. Uso: npm run build && npx tsx scripts/verificacion/teclado.ts
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
const browser = await chromium.launch()
for (const giro of ['abarrotes', 'barberia', 'restaurante']) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((t: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, own.json.token)
    const page = await ctx.newPage()
    await page.goto(`${base}/#/inicio`); await page.waitForTimeout(1200)
    await page.keyboard.press('Tab')
    const primero = await page.evaluate(() => document.activeElement?.textContent?.trim())
    ok(primero === 'Saltar al contenido', `[${giro}/${dev}] el primer Tab es «Saltar al contenido»`)
    const foco = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { visible: r.top >= 0 && r.top < 80, outline: s.outlineStyle !== 'none' || s.boxShadow !== 'none' } })
    ok(foco.visible, `[${giro}/${dev}] el enlace aparece a la vista al recibir el foco`)
    await page.keyboard.press('Enter'); await page.waitForTimeout(150)
    ok(await page.evaluate(() => document.activeElement?.id === 'contenido'), `[${giro}/${dev}] Enter lleva el foco al contenido`)
    // El foco siempre se ve: cada botón/enlace de la barra superior muestra contorno al tabular.
    await page.evaluate(() => (document.querySelector('.skip-link') as HTMLElement).focus())
    let conContorno = 0, total = 0
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); total++; if (await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 })) conContorno++ }
    ok(conContorno >= total - 1, `[${giro}/${dev}] el foco tiene contorno visible en los primeros controles (${conContorno}/${total})`)
    if (dev === 'celular') {
      await page.getByRole('button', { name: 'Más' }).click(); await page.waitForTimeout(250)
      ok((await page.locator('.hoja').count()) === 1, `[${giro}/${dev}] «Más» abre la hoja de módulos`)
      await page.keyboard.press('Escape'); await page.waitForTimeout(200)
      ok((await page.locator('.hoja').count()) === 0, `[${giro}/${dev}] Esc cierra la hoja`)
    } else {
      await page.locator('body').click({ position: { x: 700, y: 400 } }); await page.keyboard.press('/')
      ok(await page.evaluate(() => (document.activeElement as HTMLInputElement)?.type === 'search'), `[${giro}/${dev}] «/» enfoca el buscador`)
      await page.keyboard.type('caja'); await page.waitForTimeout(150); await page.keyboard.press('Escape')
      ok((await page.locator('.buscador-lista').count()) === 0, `[${giro}/${dev}] Esc cierra los resultados`)
      await page.getByRole('button', { name: /^Cuenta de/ }).click(); await page.keyboard.press('Escape'); await page.waitForTimeout(150)
      ok((await page.locator('.menu-usuario-pop').count()) === 0, `[${giro}/${dev}] Esc cierra el menú de la persona`)
    }
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
