// Auditoría del panel administrativo: 6 secciones × claro/oscuro × computadora/tableta/celular.
// Contraste, letra ≥ 18 px en celular, desborde, textos encimados y errores de JS. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/auditoria-admin.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-admin'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
for (const d of DEMOS.slice(0, 4)) await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const VP = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } } as const
const TABS = ['Resumen', 'Negocios', 'Buzón', 'Alta asistida', 'Demos', 'Ajustes']
const browser = await chromium.launch(); let fails = 0, n = 0
const ok = (c: unknown, m: string) => { if (!c) { fails++; console.log(`✗ ${m}`) } }
for (const [vp, size] of Object.entries(VP)) for (const modo of ['claro', 'oscuro']) {
  const ctx = await browser.newContext({ viewport: size })
  await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_admin_token', t); localStorage.setItem('nx_modo', m) }, [at, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(`${base}/admin`); await page.waitForTimeout(1300)
  const movil = size.width < 900
  for (const tab of TABS) {
    if (!movil) await page.locator('.rail').getByRole('button', { name: tab, exact: true }).click()
    else if (['Resumen', 'Negocios', 'Buzón'].includes(tab)) await page.locator('.bottom').getByRole('button', { name: tab, exact: true }).click()
    else { await page.locator('.bottom').getByRole('button', { name: 'Más' }).click(); await page.waitForTimeout(250); await page.locator('.hoja').getByRole('button', { name: tab, exact: true }).click() }
    await page.waitForTimeout(700); n++
    const a = await page.evaluate(auditoria)
    const bad = errs.length || a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length
    ok(!bad, `[${vp}/${modo}] ${tab}: ${errs[0] ?? ''}${a.overflow ? ' DESBORDA' : ''}${a.bad.length ? ` contraste(${a.bad.length}): ${a.bad.slice(0, 2).join(' | ')}` : ''}${a.small.length ? ` letra<18(${a.small.length}): ${a.small.slice(0, 2).join(' | ')}` : ''}${a.encimados.length ? ` ENCIMADOS: ${a.encimados.slice(0, 2).join(' | ')}` : ''}${a.sinNombre.length ? ` SIN NOMBRE(${a.sinNombre.length}): ${[...new Set(a.sinNombre)].slice(0, 3).join(', ')}` : ''}`)
    if (modo === 'claro' || tab === 'Resumen') await page.screenshot({ path: `${shots}/${vp}-${tab.toLowerCase().replace(/ /g, '-')}-${modo}.png` })
  }
  await ctx.close()
}
await browser.close(); server.close()
console.log(`\n${n} pantallas del panel (6 secciones × 2 modos × 3 tamaños) · con hallazgos: ${fails}`)
process.exit(fails ? 1 : 0)
