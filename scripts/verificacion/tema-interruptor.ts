// Verifica el interruptor de tema en navegador real: claro por defecto, cambia con un toque, se recuerda al recargar
// y al volver a entrar, y cada producto conserva su identidad. Solo datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/tema-interruptor.ts
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const login = async (giro: string) => {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  return own.json.token as string
}
const browser = await chromium.launch()
for (const [giro, native] of [['barberia', 'dark'], ['unas', 'light'], ['taqueria', 'dark'], ['abarrotes', 'light']] as const) {
  const token = await login(giro)
  for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((t: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, token)
    const page = await ctx.newPage()
    const st = () => page.evaluate(() => ({ mode: document.documentElement.dataset.mode, native: document.documentElement.dataset.native, prod: document.documentElement.dataset.product, saved: localStorage.getItem('nx_modo'), bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name=theme-color]')?.getAttribute('content') }))
    await page.goto(base + '/#/inicio'); await page.waitForTimeout(1200)
    const a = await st()
    ok(a.mode === 'light' && a.saved === null, `[${giro}/${dev}] arranca en modo claro por defecto (sin preferencia guardada)`)
    const abrirMenu = async () => { if (dev === 'celular') await page.getByRole('button', { name: 'Más' }).click(); else await page.getByRole('button', { name: /^Cuenta de/ }).click(); await page.waitForTimeout(300) }
    await abrirMenu()
    await page.getByRole('button', { name: 'Modo oscuro' }).click(); await page.waitForTimeout(300)
    const b = await st()
    ok(b.mode === 'dark' && b.saved === 'oscuro' && b.bg !== a.bg && b.meta !== a.meta, `[${giro}/${dev}] un toque cambia a oscuro, guarda la preferencia y cambia fondo y barra del navegador`)
    await page.reload(); await page.waitForTimeout(1200)
    const c = await st()
    ok(c.mode === 'dark' && c.prod === a.prod && c.bg === b.bg, `[${giro}/${dev}] tras recargar sigue oscuro y conserva su identidad («${c.prod}»)`)
    // Volver a entrar (cerrar sesión y entrar) conserva la preferencia del equipo.
    await page.evaluate(() => localStorage.removeItem('nx_token')); await page.reload(); await page.waitForTimeout(800)
    ok((await st()).mode === 'dark', `[${giro}/${dev}] en la pantalla de acceso también se respeta el modo`)
    await page.evaluate((t: string) => localStorage.setItem('nx_token', t), token); await page.goto(base + '/#/inicio'); await page.reload(); await page.waitForTimeout(1200)
    await abrirMenu()
    await page.getByRole('button', { name: 'Modo claro' }).click(); await page.waitForTimeout(300)
    const d = await st()
    ok(d.mode === 'light' && d.saved === 'claro' && d.bg === a.bg, `[${giro}/${dev}] vuelve a claro y queda igual que al inicio`)
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
