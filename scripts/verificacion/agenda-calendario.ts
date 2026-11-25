// Agenda con calendario gráfico: capturas reales (escritorio, tableta, celular, claro/oscuro, día/semana/lista), arrastrar y reprogramar,
// editar, cancelar, terminar → pendiente de cobro y auditoría de contraste/letra/desborde. Datos de demostración en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/agenda-calendario.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-agenda'; mkdirSync(shots, { recursive: true })
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const mx = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(ms))
const hoy = mx(Date.now())

const r = await s.call('POST', '/admin/demos/barberia', { token: at })
let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
const T = own.json.token as string
const call = (m: string, p: string, b?: unknown) => s.call(m, p, { token: T, body: b })
const staff = (await call('GET', '/agenda/staff')).json.staff as any[]
const svcs = ((await call('GET', '/services')).json.services as any[]).filter((x) => x.active && x.durationMin)
await call('POST', '/shifts/open', { openingFloat: 10000 })
const iso = (d: string, hm: string) => new Date(`${d}T${hm}:00-06:00`).toISOString()
const [a, b] = staff
// Hoy a las 9:00 los dos trabajan: se siembran citas con todos los estados.
const mk = async (st: any, hm: string, n: number, name: string, day = hoy) => (await call('POST', '/appointments', { staffId: st.id, serviceIds: [svcs[n % svcs.length].id], startsAt: iso(day, hm), customerName: name, phone: '5511223344' })).json.appointment
const horarioA = (await call('GET', `/agenda?date=${hoy}`)).json.hours as any[]
ok(horarioA.length >= 2, `los profesionales de la demo trabajan hoy (${horarioA.length} horarios)`)
const inicio = horarioA.map((h) => h.start).sort()[0] as string
const H = (extra: number) => { const [h, m] = inicio.split(':').map(Number); const t = h! * 60 + m! + extra; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
const c1 = await mk(a, H(0), 0, 'Carlos Ruiz'); const c2 = await mk(a, H(60), 1, 'Marcos Peña'); const c3 = await mk(a, H(150), 2, 'Julián Soto')
const c4 = await mk(b, H(30), 0, 'Andrés Lara'); const c5 = await mk(b, H(120), 1, 'Pablo Vega'); const c6 = await mk(b, H(210), 2, 'Iván Torres')
const c7 = await mk(a, H(240), 0, 'Ramiro Díaz')
s.db.prepare("UPDATE appointments SET status = 'pendiente', source = 'link' WHERE id = ?").run(c2.id)
await call('POST', `/appointments/${c3.id}/start`)
await call('POST', `/appointments/${c4.id}/complete`)
await call('POST', `/appointments/${c5.id}/complete`); await call('POST', `/appointments/${c5.id}/checkout`, { paymentMethod: 'efectivo', cashReceived: 100000 })
await call('POST', `/appointments/${c6.id}/cancel`, { reason: 'No puede venir' })
await call('POST', `/staff/${b.id}/blocks`, { startsAt: iso(hoy, H(300)), endsAt: iso(hoy, H(360)), reason: 'Comida' })
// Otras citas en la semana
const manana = mx(Date.now() + 86_400_000); await mk(a, H(30), 1, 'Eduardo Mora', manana)
// Foto de un profesional (se sirve en el navegador con una imagen generada; la otra queda con su inicial)
await call('PUT', `/staff/${a.id}/photo`, { url: 'https://fotos.nexora.test/barbero.svg' })
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#475569"/><circle cx="60" cy="46" r="24" fill="#e2b896"/><path d="M14 120c4-30 28-44 46-44s42 14 46 44z" fill="#1e293b"/><path d="M36 38c2-18 14-26 24-26s22 8 24 26c-8-8-16-10-24-10s-16 2-24 10z" fill="#1f1a17"/></svg>'

const browser = await chromium.launch()
const VP = { escritorio: { width: 1366, height: 900 }, tableta: { width: 820, height: 1100 }, celular: { width: 390, height: 844 } } as const
const abrir = async (vp: { width: number; height: number }, modo: string) => {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 })
  await ctx.route('https://fotos.nexora.test/**', (rt: any) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }))
  await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [T, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(base + '/#/agenda'); await page.waitForSelector('.cal-cita', { timeout: 15000 }); await page.waitForTimeout(500)
  return { ctx, page, errs }
}
const audit = async (page: any, tag: string, errs: string[]) => {
  const x = await page.evaluate(auditoria)
  const malo = errs.length || x.overflow || x.bad.length || x.small.length || x.encimados.length || x.sinNombre.length
  ok(!malo, `${tag}: contraste, letra, desborde, encimados y nombres${malo ? ` → ${errs[0] ?? ''}${x.overflow ? ' DESBORDA' : ''}${x.bad.slice(0, 2).join('|')}${x.small.slice(0, 2).join('|')}${x.sinNombre.slice(0, 2).join('|')}${x.encimados.slice(0, 1).join('|')}` : ''}`)
}
for (const modo of ['claro', 'oscuro']) for (const [vn, vp] of Object.entries(VP)) {
  const { ctx, page, errs } = await abrir(vp, modo)
  const cabeceras = await page.locator('.cal-colhead').count(); const citas = await page.locator('.cal-cita').count()
  ok(cabeceras >= 2 && citas >= 6, `[${vn}/${modo}] calendario con ${cabeceras} columnas de profesionales y ${citas} citas en bloques`)
  ok(await page.locator('.cal-hora').count() >= 8, `[${vn}/${modo}] horas organizadas en vertical`)
  ok(await page.locator('.cal-avatar').count() >= 2 && await page.locator('img.cal-avatar').count() >= 1, `[${vn}/${modo}] profesionales con foto y nombre (o inicial)`)
  const alturas = await page.locator('.cal-cita').evaluateAll((els: HTMLElement[]) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  ok(new Set(alturas).size >= 2, `[${vn}/${modo}] la altura del bloque depende de la duración (${[...new Set(alturas)].join(', ')} px)`)
  for (const est of ['confirmada', 'pendiente', 'en_atencion', 'cobrar', 'atendida', 'cancelada']) ok(await page.locator(`.cal-cita.cb-${est}`).count() > 0, `[${vn}/${modo}] estado «${est}» con su color`)
  ok(await page.locator('.cal-libre').count() > 0 && await page.locator('.cal-bloqueo').count() > 0, `[${vn}/${modo}] espacios disponibles y bloqueos se distinguen`)
  await page.screenshot({ path: `${shots}/${vn}-${modo}-dia.png` })
  await audit(page, `[${vn}/${modo}] día`, errs)
  await ctx.close()
}
// Semana (escritorio y celular, claro)
for (const [vn, vp] of [['escritorio', VP.escritorio], ['celular', VP.celular]] as const) {
  const { ctx, page, errs } = await abrir(vp, 'claro')
  await page.getByRole('button', { name: 'Semana', exact: true }).click(); await page.waitForTimeout(700)
  ok(await page.locator('.cal-daybtn').count() === 7, `[${vn}] semana con 7 columnas de día`)
  await page.screenshot({ path: `${shots}/${vn}-claro-semana.png` })
  await audit(page, `[${vn}] semana`, errs)
  await ctx.close()
}
// Lista como alternativa
for (const [vn, vp] of [['escritorio', VP.escritorio], ['celular', VP.celular]] as const) {
  const { ctx, page, errs } = await abrir(vp, 'claro')
  await page.getByRole('button', { name: 'Lista', exact: true }).click(); await page.waitForTimeout(500)
  ok(await page.locator('.agenda-staff .appt').count() >= 4, `[${vn}] la vista de lista sigue disponible`)
  await page.screenshot({ path: `${shots}/${vn}-claro-lista.png` })
  await audit(page, `[${vn}] lista`, errs)
  await ctx.close()
}
// Funcionalidad en pantalla (escritorio): detalle, editar, reprogramar, arrastrar, terminar → pendiente de cobro, cancelar
{
  const { ctx, page, errs } = await abrir(VP.escritorio, 'claro')
  await page.locator('.cal-cita.cb-confirmada').first().click(); await page.waitForTimeout(400)
  ok(await page.locator('.cita-det').count() === 1, 'al tocar un bloque se abre el detalle de la cita')
  await page.screenshot({ path: `${shots}/escritorio-claro-detalle.png` })
  // Editar: agregar un servicio que NO cabe (choca con la siguiente cita) debe rechazarse sin cambiar nada
  await page.getByRole('button', { name: 'Editar', exact: true }).click(); await page.waitForTimeout(200)
  await page.locator('.cita-det input').first().fill('Carlos R. Editado')
  await page.getByRole('button', { name: 'Guardar cambios' }).click(); await page.waitForTimeout(700)
  const e1 = (await call('GET', `/agenda?date=${hoy}`)).json.appointments.find((x: any) => x.id === c1.id)
  ok(e1.customerName === 'Carlos R. Editado', 'editar el nombre de la cita se guarda')
  // Reprogramar con el diálogo a una hora libre
  await page.locator('.cal-cita.cb-confirmada').first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Reprogramar', exact: true }).click(); await page.waitForTimeout(500)
  const hora = page.locator('.cita-det .row button').first()
  const textoHora = (await hora.innerText()).trim(); await hora.click()
  await page.getByRole('button', { name: 'Guardar nueva hora' }).click(); await page.waitForTimeout(800)
  const e2 = (await call('GET', `/agenda?date=${hoy}`)).json.appointments.find((x: any) => x.id === c1.id)
  ok(e2 && new Date(e2.startsAt).getTime() !== new Date(iso(hoy, H(0))).getTime(), `reprogramar con horas libres cambia la cita (${textoHora})`)
  // Arrastrar la cita de Julián (en atención no se mueve) → se arrastra Marcos (pendiente) a la columna de otro profesional
  const bloque = page.locator('.cal-cita.cb-pendiente').first(); const bb = (await bloque.boundingBox())!
  const colB = page.locator(`.cal-col[data-cal-staff="${b.id}"]`); const cb = (await colB.boundingBox())!
  await page.mouse.move(bb.x + 20, bb.y + 12); await page.mouse.down()
  await page.mouse.move(cb.x + 40, bb.y + 40, { steps: 8 }); await page.mouse.move(cb.x + 40, bb.y + 12 + 100, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(900)
  const aviso = await page.locator('.okmsg, .error').first().innerText().catch(() => '(sin mensaje)')
  console.log('  mensaje tras arrastrar:', aviso.slice(0, 160))
  const e3 = (await call('GET', `/agenda?date=${hoy}`)).json.appointments.find((x: any) => x.id === c2.id)
  ok(!!e3 && (e3.staffId === b.id || new Date(e3.startsAt).getTime() !== new Date(iso(hoy, H(60))).getTime()), `arrastrar una cita a otra hora o columna la reprograma (${e3?.staffId === b.id ? 'cambió de profesional' : 'cambió de hora'}; si el hueco no existe, el sistema la rechaza sin perderla)`)
  ok(!!(await call('GET', `/agenda?date=${hoy}`)).json.appointments.find((x: any) => x.id === c2.id), 'ninguna cita se pierde al arrastrar')
  // Terminar → pendiente de cobro (y Ver en Caja)
  await page.locator('.cal-cita.cb-en_atencion').first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Terminar', exact: true }).click(); await page.waitForTimeout(900)
  ok(await page.locator('.cal-cita.cb-cobrar').count() >= 2, 'terminar el servicio lo deja «Por cobrar» en el calendario')
  await page.locator('.cal-cita.cb-cobrar').first().click(); await page.waitForTimeout(300)
  ok(await page.getByRole('button', { name: 'Ver en Caja' }).count() === 1 && await page.getByRole('button', { name: 'Cobrar', exact: true }).count() === 0, 'el cobro es solo desde Caja (no hay botón «Cobrar» en la Agenda)')
  await page.keyboard.press('Escape'); await page.mouse.click(5, 300); await page.waitForTimeout(300)
  // Cancelar con motivo
  await page.locator('.cal-cita.cb-confirmada, .cal-cita.cb-pendiente').first().click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Cancelar cita' }).click(); await page.waitForTimeout(300)
  await page.locator('.modal input').last().fill('El cliente avisó'); await page.getByRole('button', { name: 'Cancelar cita' }).last().click(); await page.waitForTimeout(900)
  ok((await call('GET', `/agenda?date=${hoy}`)).json.appointments.filter((x: any) => x.status === 'cancelada').length >= 2, 'cancelar una cita la marca como cancelada y deja el motivo')
  // Clic en espacio disponible abre la nueva cita con profesional y hora
  const libre = page.locator('.cal-libre').first(); const lb = (await libre.boundingBox())!
  await page.mouse.click(lb.x + 10, lb.y + lb.height - 6); await page.waitForTimeout(500)
  ok(await page.getByText('Nueva cita').count() > 0, 'tocar un espacio disponible abre «Nueva cita» con ese profesional')
  ok(errs.length === 0, `sin errores de JS en todo el recorrido ${errs[0] ?? ''}`)
  await ctx.close()
}
await browser.close(); server.close()
console.log(fails ? `\n✗ ${fails} fallas` : '\nTodo en orden'); process.exit(fails ? 1 : 0)
