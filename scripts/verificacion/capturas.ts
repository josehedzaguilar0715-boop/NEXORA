// Capturas de pantallas reales (datos de demostración en memoria).
// Uso: npx tsx scripts/verificacion/capturas.ts <carpeta> <giros,separados> <pantallas,separadas> <escritorio,tableta,celular> [claro|oscuro]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const [dir, giros, pantallas, vps, modo = 'claro'] = process.argv.slice(2)
mkdirSync(dir!, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const VP: Record<string, { width: number; height: number }> = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } }
const browser = await chromium.launch()
for (const giro of giros!.split(',')) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const vp of vps!.split(',')) for (const pant of pantallas!.split(',')) {
    const ctx = await browser.newContext({ viewport: VP[vp] })
    await ctx.addInitScript(([t, m]: [string, string]) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [own.json.token, modo])
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(`${base}/#/${pant}`); await page.waitForTimeout(1400)
    await page.screenshot({ path: `${dir}/${vp}-${giro}-${pant}-${modo}.png` })
    if (errs.length) console.log(`✗ ${giro}/${pant}/${vp}: ${errs[0]}`)
    await ctx.close()
  }
}
await browser.close(); server.close(); console.log('listo')
