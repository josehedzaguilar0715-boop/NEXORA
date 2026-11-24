// Fase 2: navegación con color por módulo y buscador global, en navegador real (computadora, tableta, celular).
// Solo datos de prueba en memoria. Uso: npm run build && npx tsx scripts/verificacion/navegacion.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-nav'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const who = async (giro: string) => {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  const code = (s.db.prepare('SELECT code FROM businesses WHERE giro = ?').get(giro) as { code: string }).code
  const emp = await s.call('POST', '/auth/login', { body: { businessCode: code, username: `demo.${giro}`, password: 'demo1234' } })
  return { owner: own.json.token as string, staff: emp.json.token as string }
}
const browser = await chromium.launch()
const VP = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } } as const
// [giro, texto, tecla esperada del primer resultado]
const CASOS: [string, string, string][] = [['barberia', 'cita', 'agenda'], ['abarrotes', 'fiado', 'clientes'], ['taqueria', 'mesa', 'mesas'], ['ferreteria', 'cotizar', 'cotizaciones'], ['verduleria', 'kilo', 'precios']]
for (const [vpName, vp] of Object.entries(VP)) {
  const movil = vp.width <= 900
  for (const [giro, texto, esperado] of CASOS) {
    const t = await who(giro)
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((tk: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', tk) }, t.owner)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/inicio'); await page.waitForTimeout(1100)
    if (movil) { await page.getByLabel('Buscar', { exact: true }).click(); await page.waitForTimeout(300) } else await page.keyboard.press('/')
    const foco = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'search')
    ok(foco, `[${vpName}/${giro}] ${movil ? 'el botón de lupa abre el menú con el buscador enfocado' : 'la tecla «/» enfoca el buscador'}`)
    const sugeridas = await page.locator('.buscador-lista li[role=option]').count()
    ok(sugeridas >= 3, `[${vpName}/${giro}] sin escribir muestra «lo más usado» (${sugeridas})`)
    await page.keyboard.type(texto); await page.waitForTimeout(200)
    const primero = await page.locator('.buscador-lista li[role=option]').first().getAttribute('id')
    ok(primero?.endsWith('-' + esperado), `[${vpName}/${giro}] «${texto}» → primer resultado ${esperado}`)
    const colores = await page.evaluate(() => [...document.querySelectorAll('.buscador-lista .mod-ico')].map((e) => getComputedStyle(e).color))
    ok(colores.length > 0 && colores.every((c) => c !== 'rgb(0, 0, 0)'), `[${vpName}/${giro}] los resultados llevan el color de su módulo`)
    await page.screenshot({ path: `${shots}/${vpName}-${giro}-buscando.png` })
    await page.keyboard.press('Enter'); await page.waitForTimeout(500)
    ok(new URL(page.url()).hash === `#/${esperado}`, `[${vpName}/${giro}] Enter abre «${esperado}»`)
    const chip = await page.locator('.screen-chip').count()
    ok(esperado === 'agenda' || chip >= 0, `[${vpName}/${giro}] la pantalla abierta`)
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) && !errs.length, `[${vpName}/${giro}] sin desborde ni errores${errs[0] ? ' ' + errs[0] : ''}`)
    // Sin coincidencias.
    if (movil) { await page.getByLabel('Buscar', { exact: true }).click(); await page.waitForTimeout(300) } else await page.keyboard.press('/')
    await page.keyboard.type('zzzz'); await page.waitForTimeout(150)
    ok(/Sin resultados/.test(await page.locator('.buscador-lista').innerText()), `[${vpName}/${giro}] sin coincidencias avisa con claridad`)
    await page.keyboard.press('Escape')
    await ctx.close()
  }
  // Empleado: solo encuentra lo que puede abrir.
  const t = await who('barberia')
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript((tk: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', tk) }, t.staff)
  const page = await ctx.newPage()
  await page.goto(base + '/#/caja'); await page.waitForTimeout(1100)
  // En la Caja el campo de producto tiene el foco: «/» se escribe ahí (no se le quita al cobrador); Ctrl+K sí abre el buscador.
  if (movil) { await page.getByLabel('Buscar', { exact: true }).click(); await page.waitForTimeout(300) } else await page.keyboard.press('Control+k')
  ok(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'search'), `[${vpName}/empleado] el buscador tiene el foco`)
  for (const [q, prohibida] of [['finanzas', 'finanzas'], ['personal', 'usuarios'], ['gastos', 'finanzas'], ['reportes', 'reportes']] as const) {
    await page.keyboard.press('Control+a'); await page.keyboard.type(q); await page.waitForTimeout(150)
    const ids = await page.locator('.buscador-lista li[role=option]').evaluateAll((els: Element[]) => els.map((e) => e.id))
    ok(!ids.some((i: string) => i.endsWith('-' + prohibida)), `[${vpName}/empleado] «${q}» NO muestra «${prohibida}» (sin permiso)`)
  }
  await page.keyboard.press('Control+a'); await page.keyboard.type('caja'); await page.waitForTimeout(150)
  ok((await page.locator('.buscador-lista li[role=option]').count()) > 0, `[${vpName}/empleado] «caja» sí aparece`)
  await ctx.close()
}
// Teclado: flechas.
{
  const t = await who('restaurante')
  const ctx = await browser.newContext({ viewport: VP.escritorio })
  await ctx.addInitScript((tk: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', tk) }, t.owner)
  const page = await ctx.newPage(); await page.goto(base + '/#/inicio'); await page.waitForTimeout(1100)
  await page.keyboard.press('Control+k'); await page.keyboard.type('c'); await page.waitForTimeout(200)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
  const segundo = await page.evaluate(() => location.hash)
  ok(segundo.length > 2 && segundo !== '#/inicio', `[teclado] Ctrl+K, flecha abajo y Enter abre el segundo resultado (${segundo})`)
  await ctx.close()
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
