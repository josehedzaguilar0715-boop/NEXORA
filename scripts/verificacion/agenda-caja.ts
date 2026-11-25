// Agenda → Caja en pantalla: «Terminar» en la agenda deja la cita por cobrar; Caja la cobra. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/agenda-caja.ts
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const r = await s.call('POST', '/admin/demos/barberia', { token: at })
let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
const T = own.json.token as string
const staff = (await s.call('GET', '/agenda/staff', { token: T })).json.staff[0]
const svc = (await s.call('GET', '/services', { token: T })).json.services[0]
if (!(await s.call('GET', '/shifts/current', { token: T })).json.shift) await s.call('POST', '/shifts/open', { token: T, body: { openingFloat: 10000 } })
const mx = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(ms)) // el día de México (de noche en UTC ya es otro día)
const hoy = mx(Date.now())
// Se agenda para el primer hueco disponible de hoy o de los próximos días.
let appt: any = null
let dia = ''
for (let d = 0; d < 7 && !appt; d++) {
  const day = mx(Date.now() + d * 86_400_000)
  const av = (await s.call('GET', `/agenda/availability?date=${day}&serviceIds=${svc.id}&staffId=${staff.id}`, { token: T })).json
  if (av.slots?.length) {
    const t = av.slots[0] as string
    const iso = new Date(`${day}T${t}:00-06:00`).toISOString()
    const c = await s.call('POST', '/appointments', { token: T, body: { staffId: staff.id, serviceIds: [svc.id], startsAt: iso, customerName: 'Cliente de prueba' } })
    if (c.status === 201) { appt = c.json.appointment; dia = day }
  }
}
ok(!!appt, 'cita de prueba creada')
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
await ctx.addInitScript((t: string) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, T)
const page = await ctx.newPage(); const errs: string[] = []
page.on('pageerror', (e: Error) => errs.push(e.message))
await page.goto(base + '/#/agenda'); await page.waitForTimeout(1200)
if (dia && dia !== hoy) { await page.locator('input[type=date]').first().fill(dia).catch(() => {}); await page.waitForTimeout(800) }
const terminar = page.getByRole('button', { name: /^Terminar/ }).first()
ok(await terminar.count() > 0, 'la agenda ofrece «Terminar»')
ok((await page.getByRole('button', { name: 'Cobrar', exact: true }).count()) === 0, 'la agenda NO tiene botón «Cobrar»')
await terminar.click(); await page.waitForTimeout(800)
ok(/Pendiente de cobro/.test(await page.locator('main').innerText()), 'la cita queda «Pendiente de cobro»')
await page.getByRole('button', { name: 'Ver en Caja' }).click(); await page.waitForTimeout(1500)
ok(/Caja|Cobrar a Cliente de prueba/.test(await page.locator('body').innerText()) && await page.getByText('Cobrar a Cliente de prueba').count() > 0, '«Ver en Caja» abre directo la operación de esa cita')
await page.getByRole('button', { name: 'Cobrar', exact: true }).last().click(); await page.waitForTimeout(1200)
ok(/Venta cobrada/.test(await page.locator('body').innerText()), 'Caja cobra la cita y muestra el ticket')
const q = (await s.call('GET', '/agenda/to-charge', { token: T })).json.appointments
ok(q.length === 0, 'ya no queda por cobrar')
ok(!errs.length, `sin errores${errs[0] ? ' ' + errs[0] : ''}`)
await browser.close(); server.close()
console.log(fails ? `\n${fails} FALLAS` : '\nTodo en orden'); process.exit(fails ? 1 : 0)
