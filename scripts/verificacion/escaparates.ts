// Etapas 2 y 4: escaparate de reservas (Barber/Nails), menú digital, lista de precios y catálogo. Datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/escaparates.ts [carpeta]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { setup } from '../../test/helpers.js'
const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-escaparates'; mkdirSync(shots, { recursive: true })
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
const PERFIL = { descripcion: 'Atención con cita, sin esperas.', direccion: 'Av. Principal 123, Centro', horario: 'Lun a Sáb 9:00–20:00', instagram: 'minegocio', portadaUrl: 'https://imagenes-que-no-existe.invalid/portada.jpg' }
for (const giro of ['barberia', 'unas', 'restaurante', 'taqueria', 'comedor', 'palapa', 'verduleria', 'abarrotes', 'perfumeria', 'ferreteria', 'papeleria']) {
  const T = await owner(giro)
  const slug = (await s.call('GET', '/business/public-link', { token: T })).json.slug as string
  const agenda = giro === 'barberia' || giro === 'unas'
  if (agenda) s.db.prepare("UPDATE businesses SET addons = '[\"reservas\"]', modules = '[\"reservas\"]' WHERE public_slug = ?").run(slug)
  await s.call('PUT', '/escaparate', { token: T, body: { ...PERFIL, publicarCarta: !agenda } })
  const ruta = agenda ? `/reservar/${slug}` : `/carta/${slug}`
  for (const [vn, vp] of [['pc', { width: 1366, height: 900 }], ['cel', { width: 390, height: 844 }]] as const) {
    const page = await (await browser.newContext({ viewport: vp })).newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + ruta); await page.waitForTimeout(900)
    ok(await page.getByText('Av. Principal 123').count() > 0, `[${giro}/${vn}] muestra los datos del negocio`)
    ok(await page.locator('[aria-label="Imagen ilustrativa"]').count() > 0, `[${giro}/${vn}] usa la ilustración cuando la foto no carga`)
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `[${giro}/${vn}] sin desborde horizontal`)
    ok(errs.length === 0, `[${giro}/${vn}] sin errores de JS ${errs[0] ?? ''}`)
    if (agenda) { await page.locator('.pub-item').first().click(); ok(await page.locator('.pub-item.on').count() === 1, `[${giro}/${vn}] se puede elegir un servicio`) }
    else ok(await page.locator('.pub-item, .pub-fila').count() > 0, `[${giro}/${vn}] muestra artículos`)
    const texto = await page.locator('main').innerText()
    ok(!/costo|existencia|stock/i.test(texto), `[${giro}/${vn}] sin datos internos`)
    if (['barberia', 'restaurante', 'verduleria'].includes(giro)) await page.screenshot({ path: `${shots}/${giro}-${vn}.png`, fullPage: true })
    await page.context().close()
  }
}
// Apagada: sin publicar no hay página.
const T2 = await owner('taqueria'); const sl2 = (await s.call('GET', '/business/public-link', { token: T2 })).json.slug
await s.call('PUT', '/escaparate', { token: T2, body: { publicarCarta: false } })
ok((await s.call('GET', `/public/carta/${sl2}`)).status === 404, 'la carta no es pública sin que el dueño la encienda')
await browser.close(); server.close()
console.log(fails ? `✗ ${fails} fallas` : 'Todo en orden'); process.exit(fails ? 1 : 0)
