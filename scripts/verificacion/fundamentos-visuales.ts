// Verificación de los fundamentos visuales (diseno-v0): 14 productos × modo claro/oscuro × computadora, tableta y celular.
// Comprueba, en navegador real: sin errores de JS, sin desborde horizontal, contraste AA del texto realmente dibujado
// y letra mínima de 18 px en celular. Guarda capturas. Solo datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/fundamentos-visuales.ts [carpeta de capturas] [pantalla: guia-visual|inicio|caja]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-fundamentos'
const pantalla = process.argv[3] ?? 'guia-visual'
mkdirSync(shots, { recursive: true })
const EXPECT: Record<string, string> = { abarrotes: 'market', ferreteria: 'tools', papeleria: 'paper', barberia: 'barber', unas: 'nails', perfumeria: 'scent', banos: 'access', turistico: 'tour', palapa: 'beach', restaurante: 'dining', comedor: 'fonda', taqueria: 'taco', verduleria: 'greens' }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const tokens: Record<string, string> = {}
for (const d of DEMOS) {
  const r = await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  tokens[d.giro] = own.json.token
}

import { auditoria } from './auditoria-dom.js'

const browser = await chromium.launch()
const VP = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } } as const
const resumen: string[] = []; let fails = 0; let n = 0
const productos = [...DEMOS.map((d) => d.giro), 'base'].filter((p) => !process.env.SOLO || process.env.SOLO.split(',').includes(p))
for (const [vpName, vp] of Object.entries(VP).filter(([n]) => !process.env.VPS || process.env.VPS.split(',').includes(n))) for (const modo of ['claro', 'oscuro']) for (const giro of productos) {
  n++
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(([t, m]: [string | null, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_modo', m); if (t) localStorage.setItem('nx_token', t) }, [tokens[giro] ?? null, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(`${base}/#/${giro === 'base' ? '' : pantalla}`); await page.waitForTimeout(1300)
  if (giro === 'base') await page.evaluate(() => { /* acceso: identidad base */ })
  const prod = await page.evaluate(() => document.documentElement.dataset.product)
  const mode = await page.evaluate(() => document.documentElement.dataset.mode)
  const a = await page.evaluate(auditoria)
  const okProd = giro === 'base' ? prod === 'nexora' : prod === EXPECT[giro]
  const okModo = mode === (modo === 'claro' ? 'light' : 'dark')
  const falla = errs.length || a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length || !okProd || !okModo
  if (falla) {
    fails++
    resumen.push(`✗ [${vpName}] ${giro} ${modo}: ${errs[0] ?? ''}${a.overflow ? ' DESBORDA' : ''}${!okProd ? ` producto=${prod}` : ''}${!okModo ? ` modo=${mode}` : ''}${a.bad.length ? ` contraste(${a.bad.length}): ${a.bad.slice(0, 3).join(' | ')}` : ''}${a.small.length ? ` letra<18(${a.small.length}): ${a.small.slice(0, 3).join(' | ')}` : ''}${a.encimados.length ? ` ENCIMADOS: ${a.encimados.join(' | ')}` : ''}${a.sinNombre.length ? ` SIN NOMBRE(${a.sinNombre.length}): ${[...new Set(a.sinNombre)].slice(0, 3).join(', ')}` : ''}`)
  }
  if (pantalla === 'guia-visual' || vpName !== 'tableta') await page.screenshot({ path: `${shots}/${vpName}-${giro}-${modo}.png`, fullPage: false })
  await ctx.close()
}
writeFileSync(`${shots}/resumen.txt`, resumen.join('\n'))
console.log(resumen.join('\n') || 'Sin hallazgos')
console.log(`\n${n} combinaciones (${productos.length} productos × 2 modos × ${Object.keys(VP).filter((x) => !process.env.VPS || process.env.VPS.split(",").includes(x)).length} tamaños) · pantalla «${pantalla}» · con hallazgos: ${fails}`)
await browser.close(); server.close(); process.exit(fails ? 1 : 0)
