// Capturas del panel administrativo central (datos de demostración en memoria).
// Uso: npx tsx scripts/verificacion/capturas-admin.ts <carpeta> <escritorio,tableta,celular> [claro|oscuro]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const [dir, vps, modo = 'claro'] = process.argv.slice(2)
mkdirSync(dir!, { recursive: true })
const s = setup(); const at = await s.adminToken()
for (const d of DEMOS.slice(0, 5)) await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const VP: Record<string, { width: number; height: number }> = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } }
const browser = await chromium.launch()
for (const vp of vps!.split(',')) {
  const ctx = await browser.newContext({ viewport: VP[vp] })
  await ctx.addInitScript(([t, m]: [string, string]) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_admin_token', t); localStorage.setItem('nx_modo', m) }, [at, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(`${base}/admin`); await page.waitForTimeout(1500)
  for (const tab of ['Resumen', 'Negocios', 'Buzón', 'Alta asistida', 'Demos', 'Ajustes']) {
    await page.getByRole('link', { name: tab, exact: true }).click(); await page.waitForTimeout(900)
    await page.screenshot({ path: `${dir}/${vp}-admin-${tab.toLowerCase().replace(/ /g, '-')}-${modo}.png` })
  }
  if (errs.length) console.log('✗', vp, errs[0])
  await ctx.close()
}
await browser.close(); server.close(); console.log('listo')
