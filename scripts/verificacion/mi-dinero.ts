// Finanzas inteligentes en pantalla: Mi dinero, Reparto (crear con suma validada, usar), Retiros (registrar, confirmar exceso) y permisos por puesto.
// Solo datos de prueba en memoria. Uso: npm run build && npx tsx scripts/verificacion/mi-dinero.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-dinero'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const r = await s.call('POST', '/admin/demos/abarrotes', { token: at })
let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
const T = own.json.token as string
s.db.prepare("UPDATE businesses SET plan = 'profesional'").run()
const code = (s.db.prepare('SELECT code FROM businesses').get() as { code: string }).code
const emp = await s.createStaff(T, code, 'cajeraprueba', 'cajero', { permissions: ['sell', 'view_reports'] })
const adm = await s.createStaff(T, code, 'admprueba', 'administrador')
const enc = await s.createStaff(T, code, 'encprueba', 'encargado')
const browser = await chromium.launch()
const abrir = async (tok: string, vp: { width: number; height: number }, hash: string) => {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript((t: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, tok)
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + hash); await page.waitForTimeout(1200)
  return { ctx, page, errs }
}
for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const { ctx, page, errs } = await abrir(T, vp, '/#/finanzas')
  const t = await page.locator('main').innerText()
  ok(/Vendiste/.test(t) && /Entró dinero/.test(t) && /Salió dinero/.test(t) && /Ganancia real/.test(t) && /Dinero disponible/.test(t) && /Por reservar/.test(t) && /Puedes retirar/.test(t), `[${dev}] Mi dinero muestra las 7 cifras en lenguaje llano`)
  ok(!/50\s*\/\s*30\s*\/\s*20|50 %|Plan 50/.test(t), `[${dev}] no impone 50/30/20`)
  await page.getByText('¿Cómo se calcula?').first().click(); await page.waitForTimeout(200)
  ok(await page.locator('.how[open] p').first().isVisible(), `[${dev}] «¿Cómo se calcula?» se abre`)
  await page.screenshot({ path: `${shots}/${dev}-mi-dinero.png` })
  // Reparto: crear uno propio con suma inválida y luego válida.
  await page.getByRole('button', { name: 'Reparto', exact: true }).click(); await page.waitForTimeout(500)
  ok(!/Plan anterior\s*En uso/.test(await page.locator('main').innerText()), `[${dev}] Reparto: ningún reparto viene impuesto`)
  await page.getByRole('button', { name: 'En blanco' }).click(); await page.waitForTimeout(400)
  await page.getByLabel('Nombre', { exact: true }).fill('Mi reparto')
  await page.getByRole('button', { name: '+ Agregar partida' }).click()
  const vals = page.getByLabel('Valor'); const names = page.getByLabel('Nombre de la partida')
  await names.nth(0).fill('Operación'); await vals.nth(0).fill('60')
  await names.nth(1).fill('Dueño'); await vals.nth(1).fill('30'); await page.waitForTimeout(600)
  ok(/faltan 10 %/.test(await page.locator('main').innerText()) && await page.getByRole('button', { name: 'Guardar reparto' }).isDisabled(), `[${dev}] suma 90 %: avisa «faltan 10 %» y no deja guardar`)
  await page.getByRole('button', { name: '+ Agregar partida' }).click()
  await names.nth(2).fill('Ahorro'); await vals.nth(2).fill('10'); await page.waitForTimeout(600)
  ok(/suman 100 %/.test(await page.locator('main').innerText()) && await page.getByRole('button', { name: 'Guardar reparto' }).isEnabled(), `[${dev}] suma 100 %: permite guardar`)
  await page.screenshot({ path: `${shots}/${dev}-reparto-editor.png` })
  await page.getByRole('button', { name: 'Guardar reparto' }).click(); await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Usar este' }).last().click(); await page.waitForTimeout(500)
  ok(/En uso/.test(await page.locator('main').innerText()), `[${dev}] el reparto propio queda «En uso»`)
  // Retiros
  await page.getByRole('button', { name: 'Retiros', exact: true }).click(); await page.waitForTimeout(500)
  await page.locator('#retiro-monto').fill('10.00'); await page.getByLabel('Motivo').fill('Prueba de retiro')
  await page.getByRole('button', { name: 'Registrar retiro' }).click(); await page.waitForTimeout(500)
  // En este negocio de prueba aún no hay dinero libre: el sistema pide confirmar antes de dejar sacar de más.
  ok(await page.getByText('Es más de lo que conviene retirar').isVisible(), `[${dev}] sacar más de lo conveniente pide confirmación`)
  await page.getByRole('button', { name: 'Sí' }).click(); await page.waitForTimeout(800)
  ok(/Retiro registrado/.test(await page.locator('main').innerText()) && /Prueba de retiro/.test(await page.locator('main').innerText()), `[${dev}] retiro registrado con motivo, fecha y responsable`)
  await page.screenshot({ path: `${shots}/${dev}-retiros.png` })
  ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)) && !errs.length, `[${dev}] sin desborde ni errores${errs[0] ? ' ' + errs[0] : ''}`)
  await ctx.close()
}
// Permisos en pantalla: el empleado con «ver reportes» ve «Mi día», sin Finanzas; el administrador sin permisos tampoco.
{
  const { ctx, page } = await abrir(emp.token, { width: 1366, height: 900 }, '/#/inicio')
  const t = await page.locator('body').innerText()
  ok(/Mi día/.test(t) && !/Finanzas|Ganancia real|Utilidad/.test(t), '[empleado con «ver reportes»] ve «Mi día» y no ve Finanzas ni utilidades')
  await page.goto(base + '/#/finanzas'); await page.waitForTimeout(800)
  ok(!/Vendiste|Dinero disponible/.test(await page.locator('body').innerText()), '[empleado] entrar a #/finanzas por la dirección no muestra cifras')
  await ctx.close()
}
{
  await s.call('PATCH', `/users/${adm.id}`, { token: T, body: { permissions: ['view_dashboard', 'view_finance'] } })
  const { ctx, page } = await abrir(adm.token, { width: 1366, height: 900 }, '/#/finanzas')
  const t = await page.locator('main').innerText()
  ok(/Puedes retirar/.test(t) && !(await page.getByRole('button', { name: 'Registrar un retiro' }).count()), '[administrador con ver finanzas] ve las cifras pero no el botón de registrar retiros')
  await ctx.close()
}
// Encargado (opción B): conserva Caja/Productos y supervisión, pero sin Finanzas, Ventas ni panel.
for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const { ctx, page } = await abrir(enc.token, vp, '/#/inicio')
  const t = await page.locator('body').innerText()
  ok(/Mi día/.test(t) && !/Ganancia real|Utilidad|Dinero disponible/.test(t), `[encargado/${dev}] Inicio sin utilidades (ve «Mi día»)`)
  if (dev === 'escritorio') ok(!/Finanzas/.test(t) && /Caja/.test(t) && /Productos/.test(t), '[encargado] el menú no tiene Finanzas y conserva Caja y Productos')
  await page.goto(base + '/#/finanzas'); await page.waitForTimeout(800)
  ok(!/Vendiste|Dinero disponible|Puedes retirar/.test(await page.locator('body').innerText()), `[encargado/${dev}] entrar a #/finanzas por la dirección no muestra cifras`)
  await ctx.close()
}
// Costos y márgenes: permiso aparte (el encargado no los ve hasta que el dueño se los da).
{
  const { ctx, page } = await abrir(enc.token, { width: 1366, height: 900 }, '/#/productos')
  ok(!(await page.locator('th', { hasText: 'Costo' }).count()), '[encargado sin permiso de costos] Productos no muestra la columna Costo')
  await ctx.close()
  const perms = (await s.call('GET', '/auth/me', { token: enc.token })).json.permissions as string[]
  await s.call('PATCH', `/users/${enc.id}`, { token: T, body: { permissions: [...perms, 'view_costs'] } })
  const o2 = await abrir(enc.token, { width: 1366, height: 900 }, '/#/productos')
  ok((await o2.page.locator('th', { hasText: 'Costo' }).count()) > 0, '[encargado con permiso de costos] Productos muestra la columna Costo')
  await o2.ctx.close()
  await s.call('PATCH', `/users/${enc.id}`, { token: T, body: { permissions: perms } })
}
// Auditoría visual de cada pestaña (contraste AA, letra mínima en celular, desborde, textos encimados) en claro y oscuro.
for (const modo of ['claro', 'oscuro']) for (const [dev, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [T, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + '/#/finanzas'); await page.waitForTimeout(1000)
  const pasos: [string, string?][] = [['Mi dinero'], ['Reparto'], ['Retiros'], ['Gastos'], ['Reportes', 'Resumen'], ['Reportes', 'Estado de resultados'], ['Reportes', 'Flujo de efectivo'], ['Reportes', 'Balance'], ['Reportes', 'Movimientos']]
  const malos: string[] = []
  for (const [tab, sub] of pasos) {
    await page.getByRole('button', { name: tab, exact: true }).first().click(); await page.waitForTimeout(500)
    if (sub) { await page.getByRole('button', { name: sub, exact: true }).click(); await page.waitForTimeout(500) }
    const a = await page.evaluate(auditoria)
    const n = a.overflow || a.bad.length || a.small.length || a.encimados.length || a.sinNombre.length || a.cortados.length
    if (n) malos.push(`${tab}${sub ? '/' + sub : ''}:${a.overflow ? ' DESBORDA' : ''}${a.bad.length ? ` contraste ${a.bad.slice(0, 2).join(' | ')}` : ''}${a.small.length ? ` letra ${a.small.slice(0, 2).join(' | ')}` : ''}${a.encimados.length ? ` encimados ${a.encimados.slice(0, 2).join(' | ')}` : ''}${a.sinNombre.length ? ` sin nombre ${a.sinNombre.slice(0, 2).join(' | ')}` : ''}${a.cortados.length ? ` cortados ${a.cortados.slice(0, 2).join(' | ')}` : ''}`)
  }
  ok(malos.length === 0 && !errs.length, `[auditoría ${modo}/${dev}] 9 pestañas de Finanzas sin hallazgos${malos.length ? ': ' + malos.join(' || ') : ''}${errs[0] ? ' ' + errs[0] : ''}`)
  await ctx.close()
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} FALLAS` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
