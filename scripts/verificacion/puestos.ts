// Verifica en navegador real (escritorio 1366×900 y celular 390×844) los tres puestos con DOS sucursales:
// dueño, encargado de la sucursal 2 y empleados. Solo datos de prueba en memoria; no toca ninguna base real.
// Uso: npm run build && npx tsx scripts/verificacion/puestos.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dosSucursales } from '../../test/sucursales-fixture.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-puestos'
mkdirSync(shots, { recursive: true })
const f = await dosSucursales()
const root = new Hono()
root.route('/api', f.s.app)
root.use('/*', serveStatic({ root: './web/dist' }))
root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 })
await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }

const browser = await chromium.launch()
for (const [device, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const open = async (token: string) => {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript((t: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, token)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/inicio'); await page.waitForTimeout(1800)
    return { ctx, page, errs }
  }
  const apiFrom = (page: any, method: string, path: string, body?: unknown) => page.evaluate(async ([m, p, b, t]: any) => {
    const r = await fetch('/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined })
    return { status: r.status, text: await r.text() }
  }, [method, path, body, null as unknown])
  const tokenOf = (page: any) => page.evaluate(() => localStorage.getItem('nx_token'))
  const call = async (page: any, method: string, path: string, body?: unknown) => {
    const t = await tokenOf(page)
    return page.evaluate(async ([m, p, b, tk]: any) => { const r = await fetch('/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tk }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, text: await r.text() } }, [method, path, body, t])
  }
  void apiFrom

  // Dueño: ve las dos sucursales.
  { const { ctx, page, errs } = await open(f.T)
    const body = await page.innerText('body')
    ok(/Hola/.test(body), `[${device}] dueño entra a su Inicio`)
    const ventas = await call(page, 'GET', '/sales')
    ok(ventas.text.includes(f.sale1a.id) && ventas.text.includes(f.sale2.id), `[${device}] dueño ve ventas de las dos sucursales`)
    await page.screenshot({ path: `${shots}/${device}-dueno.png` }); ok(!errs.length, `[${device}] dueño sin errores de JS ${errs.join('|')}`); await ctx.close() }

  // Encargado de la sucursal 2.
  { const { ctx, page, errs } = await open(f.enc2.token)
    ok(/Hola/.test(await page.innerText('body')), `[${device}] encargado 2 entra`)
    const ventas = await call(page, 'GET', '/sales')
    ok(ventas.text.includes(f.sale2.id) && !ventas.text.includes(f.sale1a.id) && !ventas.text.includes(f.sale1b.id), `[${device}] encargado 2: solo ventas de su sucursal`)
    const r1 = await call(page, 'GET', `/reports/summary?branchId=${f.b1}`)
    ok(r1.status === 403, `[${device}] encargado 2 cambia branchId a la sucursal 1 → ${r1.status}`)
    const r2 = await call(page, 'GET', `/sales/${f.sale1a.id}`)
    ok(r2.status === 403, `[${device}] encargado 2 pide una venta de la sucursal 1 por id → ${r2.status}`)
    const r3 = await call(page, 'POST', `/shifts/${f.shift1a.id}/close`, { countedCash: 0 })
    ok(r3.status === 403, `[${device}] encargado 2 intenta cerrar caja de la sucursal 1 → ${r3.status}`)
    await page.screenshot({ path: `${shots}/${device}-encargado2.png` }); ok(!errs.length, `[${device}] encargado sin errores de JS ${errs.join('|')}`); await ctx.close() }

  // Empleado: «Mi día», sin Finanzas ni reportes, sin ver al compañero.
  { const { ctx, page, errs } = await open(f.e1b.token)
    const body = await page.innerText('body')
    ok(/Mi día/.test(body) && /Mis ventas de hoy/.test(body), `[${device}] empleado ve «Mi día»`)
    ok(!/Finanzas|Ventas y retiro/.test(body) || device === 'celular', `[${device}] empleado sin Finanzas en el menú`)
    const mine = await call(page, 'GET', '/sales')
    ok(mine.text.includes(f.sale1b.id) && !mine.text.includes(f.sale1a.id), `[${device}] empleado: solo sus ventas`)
    const o = await call(page, 'GET', `/sales/${f.sale1a.id}`)
    ok(o.status === 403, `[${device}] empleado pide la venta de su compañero → ${o.status}`)
    const rep = await call(page, 'GET', '/reports/summary')
    ok(rep.status === 403, `[${device}] empleado pide reportes generales → ${rep.status}`)
    const inv = await call(page, 'POST', '/products', { name: 'X', unit: 'pieza', price: 100 })
    ok(inv.status === 403, `[${device}] empleado intenta crear producto → ${inv.status}`)
    await page.screenshot({ path: `${shots}/${device}-empleado.png` }); ok(!errs.length, `[${device}] empleado sin errores de JS ${errs.join('|')}`); await ctx.close() }
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
