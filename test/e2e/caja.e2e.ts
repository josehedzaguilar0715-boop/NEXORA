// Prueba de punta a punta de la pantalla de caja en un navegador real.
// Uso: npm run build && npm run e2e
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { createApp } from '../../src/app.js'
import { openDb } from '../../src/db-node.js'
import { createAdmin } from '../../src/admin.js'

const require = createRequire(import.meta.url)
// Playwright viene preinstalado en el entorno (no es dependencia del proyecto).
const { chromium } = require('playwright') as { chromium: any }

const codes: Record<string, string> = {}
const apiDb = openDb(':memory:')
const api = createApp({ db: apiDb, now: () => new Date(), notifier: { sendCode: (p, c) => void (codes[p] = c) } })
const root = new Hono()
root.route('/api', api)
root.use('/*', serveStatic({ root: './web/dist' }))
root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 })
await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const shots = process.env.SHOTS ?? 'test/e2e/shots'
mkdirSync(shots, { recursive: true })

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.json() as Promise<any>
}
const check = (ok: unknown, what: string) => {
  if (!ok) throw new Error(`Falló: ${what}`)
  console.log(`✓ ${what}`)
}

// Datos de arranque por API: negocio, código del dueño y productos.
const phone = '5512345678'
const reg = await call('POST', '/auth/register', { businessName: 'Abarrotes La Esquina', ownerName: 'Rosa', phone, password: 'secreto123' })
const { token } = await call('POST', '/auth/register/verify', { challengeId: reg.challengeId, code: codes[phone] })
const me = await call('GET', '/auth/me', undefined, token)
await call('PUT', `/users/${me.user.id}/auth-code`, { code: '4321' }, token)
const ref = (await call('POST', '/products', { name: 'Refresco 600 ml', unit: 'pieza', price: 1850, barcode: '7501055300', minStock: 3 }, token)).product
const jam = (await call('POST', '/products', { name: 'Jamón de pavo', unit: 'kg', price: 18000 }, token)).product
await call('POST', '/purchases', { payment: 'contado', items: [{ productId: ref.id, quantity: 24, cost: 26400 }, { productId: jam.id, quantity: 2, cost: 24000 }] }, token)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (location.pathname !== '/' || sessionStorage.getItem('nx_e2e_first')) sessionStorage.setItem('nx_intro', '1'); sessionStorage.setItem('nx_e2e_first', '1') })
const page = await ctx.newPage()
page.on('dialog', (d: any) => void d.accept(d.type() === 'prompt' ? '4321' : undefined))
try {
  // Entrar como dueño con verificación en dos pasos.
  await page.goto(base)
  // Intro obligatoria con el logo: unos 4 segundos, sin botón para omitirla, y luego el acceso.
  await page.getByTestId('intro').waitFor()
  await page.waitForTimeout(2800)
  await page.screenshot({ path: `${shots}/0-intro.png` })
  check((await page.getByRole('button', { name: 'Omitir' }).count()) === 0, 'intro sin botón para omitir')
  await page.getByTestId('intro').waitFor({ state: 'detached', timeout: 6000 })
  check(true, 'intro obligatoria que termina sola')
  await page.getByRole('button', { name: 'Dueño' }).click()
  await page.getByLabel('Teléfono (10 dígitos)').fill(phone)
  await page.getByLabel('Contraseña').fill('secreto123')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Código de 6 dígitos').fill(codes[phone]!)
  await page.getByRole('button', { name: 'Verificar' }).click()
  // El dueño entra al Inicio: indicadores, gráfica y movimientos.
  await page.getByRole('heading', { name: /^Hola/ }).waitFor()
  await page.getByText('Ventas de la semana').waitFor()
  await page.screenshot({ path: `${shots}/1-inicio.png` })
  check(true, 'inicio con indicadores, gráfica y movimientos')
  await page.getByRole('link', { name: 'Caja' }).click()
  await page.getByRole('heading', { name: 'Abrir caja' }).waitFor()
  check(true, 'entra el dueño con código por teléfono')
  await page.screenshot({ path: `${shots}/1-abrir-caja.png` })

  // Abrir caja con fondo.
  await page.getByLabel('Fondo inicial').fill('500')
  await page.getByRole('button', { name: 'Abrir caja' }).click()
  await page.getByTestId('buscar').waitFor()
  check(true, 'abre la caja con fondo inicial')

  // Lector de código de barras: escribe y Enter.
  await page.getByTestId('buscar').fill('7501055300')
  await page.getByTestId('buscar').press('Enter')
  await page.getByTestId('buscar').fill('7501055300')
  await page.getByTestId('buscar').press('Enter')
  // Granel por importe.
  await page.getByRole('button', { name: /Jamón de pavo/ }).click()
  await page.getByRole('button', { name: 'Por importe ($)' }).click()
  await page.getByLabel('Importe en pesos').fill('45')
  await page.getByRole('button', { name: 'Agregar' }).click()
  check((await page.getByTestId('total').textContent()) === '$82.00', 'suma 2 refrescos por código + $45 de jamón = $82.00')
  await page.screenshot({ path: `${shots}/2-cuenta.png` })

  // Cobrar (F10) en efectivo con cambio.
  await page.keyboard.press('F10')
  await page.getByLabel('¿Con cuánto paga?').fill('100')
  check(await page.getByText('Cambio: $18.00').isVisible(), 'calcula el cambio')
  await page.locator('.modal').getByRole('button', { name: /^Cobrar/ }).click()
  await page.getByRole('heading', { name: 'Venta cobrada' }).waitFor()
  check(await page.getByText(/Folio 000001/).first().isVisible(), 'ticket con folio del servidor')
  await page.screenshot({ path: `${shots}/3-ticket.png` })
  await page.getByRole('button', { name: 'Nueva venta' }).click()

  // Sin internet: la venta se guarda en el equipo y el contador lo muestra.
  await ctx.setOffline(true)
  await page.getByTestId('buscar').fill('7501055300')
  await page.getByTestId('buscar').press('Enter')
  await page.getByRole('button', { name: /^Cobrar/ }).first().click()
  await page.locator('.modal').getByRole('button', { name: 'Transferencia' }).click()
  await page.locator('.modal').getByRole('button', { name: /^Cobrar/ }).click()
  await page.getByText('Sin internet: la venta se guardó').waitFor()
  await page.getByRole('button', { name: 'Nueva venta' }).click()
  check((await page.getByTestId('pendientes').textContent())?.includes('1 por enviar'), 'sin internet: contador muestra 1 por enviar')
  await page.screenshot({ path: `${shots}/4-sin-internet.png` })

  await ctx.setOffline(false)
  await page.getByTestId('pendientes').click()
  await page.getByTestId('pendientes').getByText('Todo enviado').waitFor({ timeout: 10_000 })
  const sales = await call('GET', '/sales', undefined, token)
  check(sales.sales.length === 2, 'al volver la señal se envía sin duplicar (2 ventas en el servidor)')

  // Corte de caja.
  // Verificación a ciegas: primero se cuenta el dinero, sin ver cuánto dice el sistema.
  // Corte X: cómo va la caja, sin cerrarla.
  await page.getByRole('button', { name: 'Corte de caja' }).click()
  await page.getByRole('button', { name: /Corte X/ }).click()
  await page.getByRole('heading', { name: /Corte X #1/ }).waitFor()
  check((await page.locator('pre.report').innerText()).includes('DEBE HABER EN CAJA'), 'corte X: reporte parcial con lo que debe haber')
  await page.screenshot({ path: `${shots}/5-corte-x.png` })
  await page.getByRole('button', { name: 'Seguir vendiendo' }).click()
  // Corte Z.
  await page.getByRole('button', { name: 'Corte de caja' }).click()
  await page.getByRole('button', { name: /Corte Z/ }).click()
  await page.getByRole('heading', { name: /1\. Cuenta el dinero/ }).waitFor()
  check(!(await page.getByText('Debe haber en caja').isVisible()), 'corte: se cuenta sin ver lo que espera el sistema')
  await page.getByLabel('¿Cuánto dinero hay en la caja?').fill('500')
  await page.getByRole('button', { name: 'Verificar con el sistema' }).click()
  await page.getByText('Faltan $82.00').waitFor()
  check(true, 'corte: si falta dinero lo dice antes de cerrar')
  await page.getByRole('button', { name: 'Volver a contar' }).click()
  await page.getByLabel('¿Cuánto dinero hay en la caja?').fill('582')
  await page.screenshot({ path: `${shots}/5-corte-conteo.png` })
  await page.getByRole('button', { name: 'Verificar con el sistema' }).click()
  await page.getByText('La caja cuadra').waitFor()
  check(await page.getByText('Debe haber en caja').isVisible(), 'corte: fondo $500 + $82 en efectivo cuadra con lo registrado')
  await page.screenshot({ path: `${shots}/5-corte.png` })
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  await page.getByRole('heading', { name: /Caja cerrada · Corte Z #1/ }).waitFor()
  check((await page.locator('pre.report').innerText()).includes('Turno cerrado.'), 'cierra la caja con su corte Z imprimible')

  // Pantallas del dueño.
  await page.getByRole('button', { name: 'Listo' }).click()
  await page.goto(`${base}/#/reportes`)
  await page.getByText('Utilidad').first().waitFor()
  await page.screenshot({ path: `${shots}/6-reportes.png` })
  check(true, 'reportes del día')

  // Ferretería: cotizar, vender la cotización y devolver con ticket.
  apiDb.prepare("UPDATE businesses SET giro = 'ferreteria'").run() // el giro lo cambia soporte
  await page.goto(`${base}/#/caja`)
  await page.reload()
  await page.getByLabel('Fondo inicial').fill('0')
  await page.getByRole('button', { name: 'Abrir caja' }).click()
  await page.getByTestId('buscar').waitFor()
  await page.goto(`${base}/#/cotizaciones`)
  await page.getByLabel('Cliente').fill('Constructora Ruiz')
  await page.getByLabel('Agregar producto').fill('Refresco')
  await page.getByRole('button', { name: /^Refresco 600 ml/ }).click()
  await page.getByLabel('Cantidad de Refresco 600 ml').fill('3')
  await page.getByRole('button', { name: 'Guardar cotización' }).click()
  await page.getByText(/Cotización #1 por \$55\.50/).waitFor()
  check(true, 'ferretería: cotización guardada')
  page.removeAllListeners('dialog')
  page.on('dialog', (d: any) => void d.accept('transferencia'))
  await page.locator('main').getByRole('button', { name: 'Vender' }).click()
  await page.getByText(/Vendida: folio 3/).waitFor()
  check(true, 'ferretería: la cotización se convierte en venta')
  await page.screenshot({ path: `${shots}/7-cotizaciones.png` })
  await page.goto(`${base}/#/devoluciones`)
  await page.getByLabel('Folio del ticket').fill('3')
  await page.getByRole('button', { name: 'Buscar' }).click()
  await page.getByLabel('Devolver de Refresco 600 ml').fill('1')
  await page.getByLabel('Se devuelve en').selectOption('transferencia')
  await page.getByLabel('Motivo').fill('Sobró uno')
  await page.getByLabel('Código de autorización').fill('4321')
  await page.getByRole('button', { name: 'Registrar devolución' }).click()
  await page.getByText('Devolución registrada: $18.50.').waitFor()
  check(true, 'ferretería: devolución con ticket y código')

  // Papelería: copias por hoja desde la caja.
  apiDb.prepare("UPDATE businesses SET giro = 'papeleria'").run() // el giro lo cambia soporte
  await call('POST', '/services', { name: 'Copia carta B/N', price: 100 }, token)
  await page.goto(`${base}/#/caja`)
  await page.reload()
  await page.getByRole('button', { name: /Copia carta B\/N/ }).click()
  await page.getByRole('button', { name: '20', exact: true }).click()
  await page.getByRole('button', { name: 'Agregar' }).click()
  check((await page.getByTestId('total').textContent()) === '$20.00', 'papelería: 20 copias a $1.00')
  await page.getByRole('button', { name: /^Cobrar/ }).first().click()
  await page.locator('.modal').getByRole('button', { name: 'Tarjeta' }).click()
  await page.locator('.modal').getByRole('button', { name: /^Cobrar/ }).click()
  await page.getByRole('heading', { name: 'Venta cobrada' }).waitFor()
  check(await page.getByText(/20 Copia carta B\/N/).first().isVisible(), 'papelería: ticket con las copias')
  await page.screenshot({ path: `${shots}/8-papeleria.png` })

  // Barbería: el cliente reserva por link, el negocio confirma y cobra desde la agenda.
  apiDb.prepare("UPDATE businesses SET giro = 'barberia'").run() // el giro lo cambia soporte
  await call('PATCH', '/business', { forcePasswordChange: false }, token)
  apiDb.prepare(`UPDATE businesses SET addons = '["reservas"]'`).run() // lo habilita el super panel con la instalación
  await call('PUT', '/modules', { active: ['reservas'] }, token)
  const barbero = (await call('POST', '/users', { name: 'Juan Barbero', username: 'juanb', password: 'inicial123', template: 'barbero' }, token)).user
  await call('PUT', `/staff/${barbero.id}/agenda`, { inAgenda: true, schedule: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '00:00', end: '24:00' })) }, token)
  await call('POST', '/services', { name: 'Corte de cabello', price: 15000, durationMin: 30 }, token)
  const pub = await browser.newPage()
  await pub.addInitScript(() => sessionStorage.setItem('nx_intro', '1'))
  await pub.goto(`${base}/reservar/${me.business.code}`)
  await pub.getByRole('button', { name: /Corte de cabello/ }).click()
  await pub.getByRole('button', { name: 'El primero disponible' }).click()
  // Mañana: así siempre hay horas libres, sin importar la hora en que corra la prueba.
  await pub.getByLabel('Día').fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() + 86_400_000)))
  await pub.locator('button', { hasText: /^\d{2}:\d{2}$/ }).first().click()
  await pub.getByLabel('Nombre').fill('Pedro Cliente')
  await pub.getByLabel('Teléfono (10 dígitos)').fill('5598765432')
  await pub.screenshot({ path: `${shots}/9-reservar.png` })
  await pub.getByRole('button', { name: 'Reservar' }).click()
  await pub.getByText('Por confirmar: te avisaremos').waitFor()
  check(true, 'barbería: el cliente reserva por link y ve "por confirmar"')
  await page.goto(`${base}/#/agenda`)
  await page.reload()
  await page.getByLabel('Día').fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() + 86_400_000)))
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByLabel(/Propina para/).fill('20')
  await page.getByRole('button', { name: 'Cobrar', exact: true }).last().click()
  await page.getByText('Cobrado: $150.00.').waitFor()
  await page.screenshot({ path: `${shots}/10-agenda.png` })
  await pub.reload()
  await pub.getByText('Atendida').waitFor()
  check(true, 'barbería: confirma y cobra desde la agenda; el cliente ve "Atendida"')

  // Restaurante: mesa → cocina → lista → cobro con propina → limpieza → libre.
  apiDb.prepare("UPDATE businesses SET giro = 'restaurante'").run() // el giro lo cambia soporte
  await call('POST', '/tables', { name: '7', area: 'terraza', seats: 4 }, token)
  await call('POST', '/products', { name: 'Tacos de arrachera', unit: 'pieza', price: 16000, trackStock: false, attrs: { station: 'cocina_caliente' } }, token)
  page.removeAllListeners('dialog')
  page.on('dialog', (d: any) => void d.accept('2'))
  await page.goto(`${base}/#/mesas`)
  await page.reload()
  await page.getByRole('button', { name: /Mesa 7/ }).click()
  await page.getByRole('button', { name: /^Tacos de arrachera/ }).click()
  await page.getByRole('button', { name: 'Mandar a cocina' }).click()
  await page.getByText('Comandas enviadas.').waitFor()
  check(true, 'restaurante: pedido enviado a cocina')
  await page.screenshot({ path: `${shots}/11-cuenta-mesa.png` })
  const kitchen = await browser.newPage()
  await kitchen.addInitScript(() => sessionStorage.setItem('nx_intro', '1'))
  await kitchen.addInitScript((t: string) => localStorage.setItem('nx_token', t), token)
  await kitchen.goto(`${base}/#/cocina`)
  await kitchen.getByRole('heading', { name: 'Mesa 7' }).waitFor()
  await kitchen.screenshot({ path: `${shots}/12-cocina.png` })
  await kitchen.getByRole('button', { name: 'Lista' }).click()
  await kitchen.getByText('Sin comandas pendientes.').waitFor()
  check(true, 'restaurante: la cocina ve la comanda y la marca lista')
  await page.getByRole('button', { name: 'Cobrar todo' }).click()
  await page.getByLabel(/Propina para el mesero/).fill('25')
  await page.getByRole('button', { name: 'Cobrar', exact: true }).click()
  await page.getByRole('button', { name: /Mesa 7/ }).getByText(/En limpieza/).waitFor()
  await page.getByRole('button', { name: /Mesa 7/ }).click()
  await page.getByRole('button', { name: /Mesa 7/ }).getByText('Libre').waitFor()
  check(true, 'restaurante: cobro con propina, mesa a limpieza y el mesero la libera')

  // Buzón del dueño y super panel: el dueño escribe, soporte responde y registra un pago.
  await page.goto(`${base}/#/buzon`)
  await page.getByLabel('Asunto').fill('No imprime el ticket')
  await page.getByLabel('Mensaje').fill('La impresora no responde')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await page.getByRole('cell', { name: /No imprime el ticket/ }).waitFor()
  check(true, 'buzón: el dueño envía su duda')
  createAdmin({ db: apiDb, now: () => new Date(), notifier: { sendCode: () => {} } }, { name: 'Soporte', username: 'soporte', password: 'superpanel1' })
  const adm = await browser.newPage()
  await adm.addInitScript(() => sessionStorage.setItem('nx_intro', '1'))
  await adm.goto(`${base}/admin`)
  await adm.getByLabel('Usuario').fill('soporte')
  await adm.getByLabel('Contraseña').fill('superpanel1')
  await adm.getByRole('button', { name: 'Entrar' }).click()
  await adm.getByRole('cell', { name: /Abarrotes La Esquina/ }).click()
  adm.on('dialog', (d: any) => void d.accept('1'))
  await adm.getByRole('button', { name: 'Registrar pago' }).click()
  await adm.getByText('Pago registrado: el negocio queda activo.').waitFor()
  await adm.screenshot({ path: `${shots}/13-super-panel.png` })
  await adm.getByRole('link', { name: 'Buzón' }).click()
  await adm.getByRole('cell', { name: /No imprime el ticket/ }).click()
  await adm.getByLabel('Responder').fill('Revisa el cable USB y vuelve a intentar.')
  await adm.getByRole('button', { name: 'Enviar' }).click()
  await adm.getByText('Revisa el cable USB').waitFor()
  check(true, 'super panel: registra el pago (activo) y responde el buzón')
  await page.reload()
  await page.getByRole('cell', { name: /No imprime el ticket/ }).click()
  await page.getByText('Revisa el cable USB y vuelve a intentar.').waitFor()
  check(true, 'buzón: la respuesta llega al mismo buzón del cliente')
} finally {
  await browser.close()
  server.close()
}
console.log('Prueba de punta a punta: OK')
process.exit(0)
