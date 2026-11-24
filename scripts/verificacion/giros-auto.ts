// Automatizaciones por giro en pantalla (Finanzas → «Qué deja ganancia», seguimiento en Clientes, recordatorios en Agenda) + auditoría visual.
// Datos de demostración en memoria. Uso: npm run build && npx tsx scripts/verificacion/giros-auto.ts
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const browser = await chromium.launch()
const esperado: Record<string, RegExp> = { barberia: /Ganancia por servicio/, unas: /Ganancia por servicio/, restaurante: /Costo y ganancia de cada platillo/, abarrotes: /Lo que más ganancia deja/ }
for (const giro of Object.keys(esperado)) {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  for (const modo of ['claro', 'oscuro']) for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [own.json.token, modo])
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/finanzas'); await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Qué deja ganancia' }).click(); await page.waitForTimeout(1200)
    const t = await page.locator('main').innerText()
    ok(esperado[giro]!.test(t), `[${giro}/${modo}/${dev}] «Qué deja ganancia» muestra su análisis`)
    const a = await page.evaluate(auditoria)
    const mal = a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length || a.cortados.length
    ok(!mal && !errs.length, `[${giro}/${modo}/${dev}] auditoría visual sin hallazgos${mal ? ` ${a.bad.slice(0, 2)} ${a.small.slice(0, 2)} ${a.encimados.slice(0, 2)} ${a.cortados.slice(0, 2)}${a.overflow ? ' DESBORDA' : ''}` : ''}${errs[0] ? ' ' + errs[0] : ''}`)
    if (['barberia', 'unas'].includes(giro) && modo === 'claro') {
      await page.goto(base + '/#/clientes'); await page.waitForTimeout(1200)
      ok(!(await page.evaluate(auditoria)).overflow, `[${giro}/${dev}] Clientes con seguimiento sin desborde`)
    }
    await ctx.close()
  }
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} FALLAS` : '\nTodo en orden'); process.exit(fails ? 1 : 0)
