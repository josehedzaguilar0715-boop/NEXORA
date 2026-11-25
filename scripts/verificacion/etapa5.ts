// Etapa 5: tablero de encargos (Papelería), alerta de limpieza (Acceso) y notas olfativas (Perfumería). Datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/etapa5.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-etapa5'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const browser = await chromium.launch()
const owner = async (giro: string) => {
  const r = await s.call('POST', `/admin/demos/${giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  return own.json.token as string
}
const abrir = async (T: string, ruta: string, vp: { width: number; height: number }) => {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript((tk: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', tk) }, T)
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + ruta); await page.waitForTimeout(1000)
  return { page, ctx, errs }
}
const VP = { pc: { width: 1366, height: 900 }, cel: { width: 390, height: 844 } }
// Papelería: encargos
{
  const T = await owner('papeleria')
  await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 0 } })
  const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const mk = (n: number, customerName: string, phone: string, dueDate: string) => s.call('POST', '/orders', { token: T, body: { id: s.uuid(), customerName, phone, description: `Impresión de tesis ${n}`, total: 50000, deposit: 10000, paymentMethod: 'efectivo', dueDate } })
  await mk(1, 'Ana Pérez', '5512345678', ayer)
  const o2 = (await mk(2, 'Luis Gómez', '5598765432', '2999-01-01')).json.order
  await s.call('POST', `/orders/${o2.id}/ready`, { token: T })
  for (const [vn, vp] of Object.entries(VP)) {
    const { page, ctx, errs } = await abrir(T, '/#/encargos', vp)
    const t = await page.locator('main').innerText()
    ok(/por hacer · \d/i.test(t) && /listos para entregar · 1/i.test(t), `[encargos/${vn}] tablero con columnas por estado`)
    ok(t.includes('Vencido'), `[encargos/${vn}] marca el encargo vencido`)
    ok(await page.getByRole('link', { name: 'Avisar por WhatsApp' }).count() === 1, `[encargos/${vn}] aviso manual por WhatsApp solo en los listos`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `[encargos/${vn}] sin desborde horizontal`)
    ok(errs.length === 0, `[encargos/${vn}] sin errores de JS ${errs[0] ?? ''}`)
    await page.screenshot({ path: `${shots}/encargos-${vn}.png`, fullPage: true }); await ctx.close()
  }
}
// Acceso (baños): alerta de limpieza
{
  const T = await owner('banos')
  const tasks = (await s.call('GET', '/cleaning/tasks', { token: T })).json.tasks as { id: string }[]
  if (tasks.length === 0) await s.call('POST', '/cleaning/tasks', { token: T, body: { name: 'Sanitarios' } })
  for (const [vn, vp] of Object.entries(VP)) {
    const { page, ctx, errs } = await abrir(T, '/#/entradas', vp)
    ok(await page.getByText(/Pendiente · Sin limpiar hoy/).count() > 0, `[acceso/${vn}] avisa las tareas de limpieza pendientes`)
    const ts = (await s.call('GET', '/cleaning/tasks', { token: T })).json.tasks[0].id
    if (vn === 'pc') { await s.call('POST', '/cleaning/log', { token: T, body: { taskId: ts } }); await page.reload(); await page.waitForTimeout(900); ok(await page.getByText(/Hace \d+/).count() > 0, `[acceso/${vn}] tras limpiar muestra «Hace …» (el reloj del servidor de prueba puede diferir)`) }
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `[acceso/${vn}] sin desborde horizontal`)
    ok(errs.length === 0, `[acceso/${vn}] sin errores de JS ${errs[0] ?? ''}`)
    await page.screenshot({ path: `${shots}/acceso-${vn}.png`, fullPage: true }); await ctx.close()
  }
}
// Perfumería: notas olfativas aparecen en el catálogo público
{
  const T = await owner('perfumeria')
  await s.call('POST', '/products', { token: T, body: { name: 'Aqua 100 ml', unit: 'pieza', price: 120000, attrs: { brand: 'Casa', fragrance: 'Aqua', sizeMl: 100, presentation: 'regular', descripcion: 'Cítrico, madera, ámbar' } } })
  const slug = (await s.call('GET', '/business/public-link', { token: T })).json.slug
  await s.call('PUT', '/escaparate', { token: T, body: { publicarCarta: true, descripcion: 'Fragancias originales' } })
  const { page, ctx, errs } = await abrir(T, `/carta/${slug}`, VP.cel)
  ok(await page.getByText('Cítrico, madera, ámbar').count() === 1, '[perfumería/catálogo] muestra las notas olfativas')
  ok(errs.length === 0, '[perfumería/catálogo] sin errores de JS'); await ctx.close()
}
await browser.close(); server.close()
console.log(fails ? `✗ ${fails} fallas` : 'Todo en orden'); process.exit(fails ? 1 : 0)
