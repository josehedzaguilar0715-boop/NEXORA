// Verifica que, con internet lento, los formularios no pierdan lo que el usuario eligió ni guarden datos vacíos.
// Retrasa 1.5 s cada respuesta de la API. Uso: servidor local con demos y `node scripts/verificacion/internet-lento.cjs`.
const { chromium } = require('playwright')
const B = process.env.B || 'http://localhost:3135'
const ok = (c, t) => { console.log((c ? '✓ ' : '✗ ') + t); if (!c) process.exitCode = 1 }
;(async () => {
  const b = await chromium.launch()
  const tok = (await (await fetch(B + '/api/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '5500000005', password: 'demo1234' }) })).json()).token
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, tok)
  const p = await ctx.newPage()
  await p.goto(B + '/#/inicio'); await p.waitForTimeout(1500)
  await p.route('**/api/**', async (r) => { await new Promise((s) => setTimeout(s, 1500)); await r.continue() })
  // 1) Ajustes: guardar módulos está apagado hasta que llegan los módulos.
  await p.goto(B + '/#/ajustes')
  const btn = p.getByRole('button', { name: 'Cargando…' }).first()
  await btn.waitFor()
  ok(await btn.isDisabled(), 'Ajustes: «Guardar módulos» desactivado mientras carga')
  await p.getByRole('button', { name: 'Guardar módulos' }).waitFor({ timeout: 15000 })
  ok(await p.getByRole('button', { name: 'Guardar módulos' }).isEnabled(), 'Ajustes: se activa al llegar los módulos')
  // 2) Horario de agenda: no se muestra el formulario hasta tener el horario.
  await p.goto(B + '/#/usuarios'); await p.locator('.team-row').first().waitFor({ timeout: 20000 })
  await p.locator('.team-row', { hasText: 'Técnica' }).first().getByRole('button', { name: 'Abrir' }).click()
  await p.locator('.modal .subtabs button', { hasText: 'Horario de agenda' }).click()
  ok(await p.getByText('Cargando horario…').count() === 1, 'Horario: muestra «Cargando horario…» en vez de un formulario vacío')
  await p.getByLabel(/Atiende citas/).waitFor({ timeout: 15000 })
  ok(await p.getByLabel(/Atiende citas/).isChecked(), 'Horario: llega con «Atiende citas» marcado (lo guardado no se pierde)')
  // 3) Nueva cita: con la respuesta lenta, sí pide horas y las muestra.
  await p.goto(B + '/#/agenda'); await p.getByRole('button', { name: '+ Nueva cita' }).click()
  await p.locator('.modal .results button').first().click()
  await p.locator('.modal button', { hasText: /^\d{1,2}:\d{2} [ap]\.m\.$/ }).first().waitFor({ timeout: 15000 }).catch(() => {})
  ok(await p.locator('.modal button', { hasText: /^\d{1,2}:\d{2} [ap]\.m\.$/ }).count() > 0 || await p.getByText('No hay horas libres ese día.').count() === 1, 'Nueva cita: responde (horas libres o aviso real)')
  // 4) Venta sin internet y conteo: no deja contar hasta que la venta se envía (evita doble descuento de inventario).
  const tv = (await (await fetch(B + '/api/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '5500000013', password: 'demo1234' }) })).json()).token
  const c2 = await b.newContext({ viewport: { width: 1280, height: 860 } })
  await c2.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, tv)
  const q = await c2.newPage()
  await q.goto(B + '/#/caja'); await q.getByTestId('buscar').waitFor({ timeout: 15000 })
  await q.route('**/api/sales', (r) => r.abort('internetdisconnected'))
  await q.locator('.quick-grid button').first().click()
  await q.waitForTimeout(400)
  if (await q.locator('.modal').count()) { await q.locator('.modal input').first().fill('1'); await q.keyboard.press('Enter') }
  await q.getByRole('button', { name: /^Cobrar/ }).first().click(); await q.waitForTimeout(600)
  const pay = q.getByRole('button', { name: /^(Cobrar|Confirmar|Listo)/ }).last(); if (await pay.isVisible().catch(() => false)) await pay.click()
  await q.waitForTimeout(1200)
  const pend = await q.evaluate(() => JSON.parse(localStorage.getItem('nx_outbox') || '[]').filter((i) => i.status === 'pendiente').length)
  ok(pend >= 1, `Venta sin internet queda por enviar (${pend})`)
  await q.goto(B + '/#/cierre'); await q.locator('input[aria-label^="Contado"]').first().waitFor({ timeout: 15000 })
  await q.locator('input[aria-label^="Contado"]').first().fill('5')
  await q.getByRole('button', { name: 'Guardar conteo' }).click(); await q.waitForTimeout(1200)
  ok(await q.getByText(/sin enviar/).count() >= 1, 'Conteo bloqueado mientras hay ventas sin enviar (con explicación)')
  await q.unroute('**/api/sales')
  await q.locator('input[aria-label^="Contado"]').first().fill('5')
  await q.getByRole('button', { name: 'Guardar conteo' }).click(); await q.waitForTimeout(2500)
  const pend2 = await q.evaluate(() => JSON.parse(localStorage.getItem('nx_outbox') || '[]').filter((i) => i.status === 'pendiente').length)
  ok(pend2 === 0 && await q.getByText(/sin enviar/).count() === 0, 'Con internet: primero se envía la venta y luego se guarda el conteo')
  await b.close()
})()
