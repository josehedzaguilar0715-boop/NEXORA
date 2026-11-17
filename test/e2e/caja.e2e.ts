// Prueba de punta a punta de la pantalla de caja en un navegador real.
// Uso: npm run build && npm run e2e
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { createApp } from '../../src/app.js'
import { openDb } from '../../src/db.js'

const require = createRequire(import.meta.url)
// Playwright viene preinstalado en el entorno (no es dependencia del proyecto).
const { chromium } = require('playwright') as { chromium: any }

const codes: Record<string, string> = {}
const api = createApp({ db: openDb(':memory:'), now: () => new Date(), notifier: { sendCode: (p, c) => void (codes[p] = c) } })
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
const page = await ctx.newPage()
page.on('dialog', (d: any) => void d.accept(d.type() === 'prompt' ? '4321' : undefined))
try {
  // Entrar como dueño con verificación en dos pasos.
  await page.goto(base)
  await page.getByRole('button', { name: 'Dueño' }).click()
  await page.getByLabel('Teléfono (10 dígitos)').fill(phone)
  await page.getByLabel('Contraseña').fill('secreto123')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Código de 6 dígitos').fill(codes[phone]!)
  await page.getByRole('button', { name: 'Verificar' }).click()
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

  // Cobrar en efectivo con cambio.
  await page.getByRole('button', { name: 'Efectivo' }).click()
  await page.getByLabel('¿Con cuánto paga?').fill('100')
  check(await page.getByText('Cambio: $18.00').isVisible(), 'calcula el cambio')
  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByRole('heading', { name: 'Venta cobrada' }).waitFor()
  check(await page.getByText(/Folio 000001/).first().isVisible(), 'ticket con folio del servidor')
  await page.screenshot({ path: `${shots}/3-ticket.png` })
  await page.getByRole('button', { name: 'Nueva venta' }).click()

  // Sin internet: la venta se guarda en el equipo y el contador lo muestra.
  await ctx.setOffline(true)
  await page.getByTestId('buscar').fill('7501055300')
  await page.getByTestId('buscar').press('Enter')
  await page.getByRole('button', { name: 'Transferencia' }).click()
  await page.getByText('Sin internet: la venta se guardó').waitFor()
  await page.getByRole('button', { name: 'Nueva venta' }).click()
  check((await page.getByTestId('pendientes').textContent())?.includes('1 por enviar'), 'sin internet: contador muestra 1 por enviar')
  await page.screenshot({ path: `${shots}/4-sin-internet.png` })

  await ctx.setOffline(false)
  await page.getByTestId('pendientes').click()
  await page.getByText('Todo enviado').waitFor({ timeout: 10_000 })
  const sales = await call('GET', '/sales', undefined, token)
  check(sales.sales.length === 2, 'al volver la señal se envía sin duplicar (2 ventas en el servidor)')

  // Corte de caja.
  await page.getByRole('button', { name: 'Corte de caja' }).click()
  await page.getByText('Debe haber en caja').waitFor()
  await page.getByLabel('¿Cuánto efectivo contaste?').fill('582')
  check(await page.getByText('Cuadra exacto').isVisible(), 'corte: fondo $500 + $82 en efectivo cuadra')
  await page.screenshot({ path: `${shots}/5-corte.png` })
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  await page.getByRole('heading', { name: 'Caja cerrada' }).waitFor()
  check(true, 'cierra la caja')

  // Pantallas del dueño.
  await page.getByRole('button', { name: 'Listo' }).click()
  await page.goto(`${base}/#/reportes`)
  await page.getByText('Utilidad').first().waitFor()
  await page.screenshot({ path: `${shots}/6-reportes.png` })
  check(true, 'reportes del día')
} finally {
  await browser.close()
  server.close()
}
console.log('Prueba de punta a punta: OK')
process.exit(0)
