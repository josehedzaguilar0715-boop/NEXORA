// Auditoría de TODAS las pantallas de cada producto: recorre el menú real del dueño de cada demo (lo que ve ese giro)
// y revisa contraste AA, letra ≥ 18 px en celular, desborde horizontal, textos encimados y errores de JS.
// Uso: npx tsx scripts/verificacion/auditoria-pantallas.ts <carpeta> [claro|oscuro]   (SOLO=giro1,giro2  VPS=escritorio,celular)
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const [dir, modo = 'claro'] = process.argv.slice(2)
mkdirSync(dir!, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const VP: Record<string, { width: number; height: number }> = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } }
const vps = (process.env.VPS ?? 'escritorio,celular').split(',')
// SOLO=nexora audita el producto 14 (la base NEXORA, sin giro propio): un negocio de prueba con un giro desconocido.
const base14 = process.env.SOLO === 'nexora'
const giros = base14 ? ['abarrotes'] : DEMOS.map((d) => d.giro).filter((g) => !process.env.SOLO || process.env.SOLO.split(',').includes(g))
const browser = await chromium.launch()
const hallazgos: string[] = []; let total = 0
for (const giro of giros) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  if (base14) s.db.prepare("UPDATE businesses SET giro = 'base', extra_giros = '[]'").run()
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const vp of vps) {
    const ctx = await browser.newContext({ viewport: VP[vp] })
    await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [own.json.token, modo])
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(`${base}/#/inicio`); await page.waitForTimeout(1200)
    // Las pantallas del menú de ese negocio (en celular están todas en el menú «Más», que es el mismo componente).
    const keys: string[] = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail a[href^="#/"]')].map((a) => (a as HTMLAnchorElement).getAttribute('href')!.slice(2)))])
    for (const key of keys) {
      errs.length = 0
      await page.goto(`${base}/#/${key}`); await page.waitForTimeout(900); total++
      const a = await page.evaluate(auditoria)
      const mal = errs.length || a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length || a.cortados.length
      if (mal) hallazgos.push(`${giro}/${key}/${vp}/${modo}: ${errs[0] ?? ''}${a.overflow ? ' DESBORDA' : ''}${a.bad.length ? ` contraste(${a.bad.length}): ${a.bad.slice(0, 2).join(' | ')}` : ''}${a.small.length ? ` letra<18(${a.small.length}): ${a.small.slice(0, 2).join(' | ')}` : ''}${a.encimados.length ? ` ENCIMADOS: ${a.encimados.slice(0, 2).join(' | ')}` : ''}${a.sinNombre.length ? ` SIN NOMBRE(${a.sinNombre.length}): ${[...new Set(a.sinNombre)].slice(0, 3).join(', ')}` : ''}${a.cortados.length ? ` TEXTO CORTADO(${a.cortados.length}): ${a.cortados.slice(0, 3).join(' | ')}` : ''}`)
    }
    await ctx.close()
  }
}
await browser.close(); server.close()
writeFileSync(`${dir}/hallazgos-${modo}.txt`, hallazgos.join('\n'))
console.log(hallazgos.join('\n') || 'Sin hallazgos')
console.log(`\n${total} pantallas auditadas (${giros.length} productos × sus pantallas × ${vps.join('/')} · modo ${modo}) · con hallazgos: ${hallazgos.length}`)
process.exit(hallazgos.length ? 1 : 0)
