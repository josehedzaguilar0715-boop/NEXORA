// Verifica en navegador real (escritorio 1366×900 y celular 390×844) «Respaldo y exportación de datos»:
// descargar, ver qué contiene, simular una restauración y confirmarla. Solo datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/datos.ts [carpeta de capturas]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dosSucursales } from '../../test/sucursales-fixture.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-datos'
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
    const ctx = await browser.newContext({ viewport: vp, acceptDownloads: true })
    await ctx.addInitScript((t: string) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, token)
    const page = await ctx.newPage(); const errs: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    await page.goto(base + '/#/configurar'); await page.waitForTimeout(1500)
    return { ctx, page, errs }
  }
  // Puestos sin acceso: no ven la sección.
  for (const [who, tok] of [['encargado', f.enc1.token], ['empleado', f.e1a.token]] as const) {
    const { ctx, page } = await open(tok)
    ok(!(await page.innerText('body')).includes('Respaldo y exportación de datos'), `[${device}] ${who} no ve «Respaldo y exportación de datos»`)
    await ctx.close()
  }
  const { ctx, page, errs } = await open(f.T)
  await page.getByRole('button', { name: 'Respaldo y exportación de datos' }).click()
  await page.waitForTimeout(600)
  let body = await page.innerText('body')
  ok(/Descargar mi información/.test(body) && /Qué contiene hoy/.test(body) && /Ventas/.test(body) && /no incluye contraseñas/.test(body), `[${device}] la sección muestra descarga, contenido y aviso de privacidad`)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar mi información' }).click()])
  const path = `${shots}/${device}-export.json`; await dl.saveAs(path)
  const file = JSON.parse(readFileSync(path, 'utf8'))
  ok(file.format === 'nexora-negocio' && file.manifest.counts.sales === 3 && !readFileSync(path, 'utf8').match(/s1:[A-Za-z0-9+/=]+:/), `[${device}] se descargó el archivo (${file.manifest.counts.sales} ventas, sin contraseñas)`)
  await page.waitForTimeout(500)
  ok(/Última descarga/.test(await page.innerText('body')), `[${device}] muestra cuándo se generó la última descarga`)
  // Se pierde un dato; se simula y se restaura desde el archivo.
  f.s.db.exec('PRAGMA foreign_keys = OFF'); f.s.db.prepare("DELETE FROM customers").run(); f.s.db.exec('PRAGMA foreign_keys = ON')
  await page.locator('input[type=file]').setInputFiles(path)
  await page.waitForTimeout(900)
  body = await page.innerText('body')
  ok(/Simulación correcta/.test(body) && /Se agregarían\s+1\s+registros/.test(body), `[${device}] la simulación dice qué se agregaría sin cambiar nada`)
  ok((f.s.db.prepare('SELECT COUNT(*) n FROM customers').get() as any).n === 0, `[${device}] la simulación no modificó datos`)
  await page.screenshot({ path: `${shots}/${device}-simulacion.png` })
  await page.getByRole('button', { name: 'Restaurar…' }).click()
  await page.waitForTimeout(400)
  await page.locator('.dialog-wrap input').fill('RESTAURAR')
  await page.locator('.dialog-actions button.primary').click()
  await page.waitForTimeout(900)
  ok((f.s.db.prepare('SELECT COUNT(*) n FROM customers').get() as any).n === 1 && /Listo: se agregaron 1/.test(await page.innerText('body')), `[${device}] tras confirmar con «RESTAURAR» el dato regresó`)
  // Archivo de otro negocio: se rechaza.
  const otro = JSON.parse(JSON.stringify(file)); otro.manifest.businessId = 'otro-negocio'
  writeFileSync(`${shots}/otro.json`, JSON.stringify(otro))
  await page.locator('input[type=file]').setInputFiles(`${shots}/otro.json`)
  await page.waitForTimeout(800)
  ok(/No se puede restaurar/.test(await page.innerText('body')), `[${device}] un archivo de otro negocio o alterado se rechaza`)
  await page.screenshot({ path: `${shots}/${device}-rechazo.png` })
  ok(!errs.length, `[${device}] sin errores de JS ${errs.join('|')}`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
  ok(!overflow, `[${device}] sin desbordamiento horizontal`)
  await ctx.close()
  // Reponer el cliente para la segunda pasada: ya está restaurado.
}
await browser.close(); server.close()
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
