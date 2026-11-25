// Recorrido en NAVEGADOR de todas las pantallas de cada negocio sobre una COPIA aislada de un respaldo real de producción
// (sesiones creadas SOLO en la copia; no toca producción ni datos reales; no guarda capturas porque tendrían datos privados).
// Revisa por dueño y por un empleado de cada negocio: errores de JS, respuestas de la API con error, desborde, contraste AA,
// letra ≥ 18 px en celular, encimados y nombres accesibles. Imprime solo cifras y giros, no nombres ni datos.
// Uso: npm run build && npx tsx scripts/verificacion/copia-real-navegador.ts <respaldo-restaurado.db> [claro|oscuro]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createApp } from '../../src/app.js'
import { openDb } from '../../src/db-node.js'
import { sha256 } from '../../src/util.js'
import { auditoria } from './auditoria-dom.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const src = process.argv[2]; const modo = process.argv[3] ?? 'claro'
if (!src) throw new Error('Uso: tsx scripts/verificacion/copia-real-navegador.ts <copia.db> [claro|oscuro]')
const dest = `${src}.nav`; if (existsSync(dest)) unlinkSync(dest); copyFileSync(src, dest)
const db = openDb(dest)
const app = createApp({ db, now: () => new Date(), notifier: { sendCode: () => false, smsEnabled: false } })
const root = new Hono(); root.route('/api', app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const exp = new Date(Date.now() + 3_600_000 * 6).toISOString()
const tokenOf = (u: string) => { const t = `nav-${u}`; db.prepare('INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)').run(`nav-${u}`, u, sha256(t), exp, exp, exp); return t }
const users = db.prepare(`SELECT u.id, u.role, b.giro, b.id bid FROM users u JOIN businesses b ON b.id = u.business_id WHERE u.active = 1 AND b.status NOT IN ('suspendido') AND u.must_change_password = 0 ORDER BY b.created_at, u.role DESC`).all() as { id: string; role: string; giro: string; bid: string }[]
// Un dueño y un empleado/encargado por negocio.
const vistos = new Set<string>(); const quien = users.filter((u) => { const k = `${u.bid}/${u.role}`; if (vistos.has(k)) return false; vistos.add(k); return true })
const browser = await chromium.launch()
const VP = { escritorio: { width: 1366, height: 900 }, celular: { width: 390, height: 844 } } as const
let revisiones = 0, fallas = 0, usuarios = 0
const resumen: string[] = []
for (const u of quien) {
  const tk = tokenOf(u.id); usuarios++
  for (const [vn, vp] of Object.entries(VP)) {
    const ctx = await browser.newContext({ viewport: vp })
    await ctx.addInitScript(([t, m]: [string, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); localStorage.setItem('nx_modo', m) }, [tk, modo])
    const page = await ctx.newPage(); const errs: string[] = []; const api: string[] = []
    page.on('pageerror', (e: Error) => errs.push(e.message))
    page.on('response', (r: any) => { if (r.url().includes('/api/') && r.status() >= 500) api.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    await page.goto(base + '/#/inicio'); await page.waitForTimeout(1200)
    const claves: string[] = await page.evaluate(() => [...new Set([...document.querySelectorAll('.rail-item')].map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''))].filter((h) => h.startsWith('#/')))
    // «Otras herramientas» está recogido: se abre para que sus entradas también se recorran.
    for (const h of claves) {
      await page.goto(base + '/' + h); await page.waitForTimeout(700); revisiones++
      const a = await page.evaluate(auditoria)
      const malo = errs.length || api.length || a.overflow || a.bad.length || (vn === 'celular' && a.small.length) || a.encimados.length || a.sinNombre.length || a.cortados.length
      if (malo) { fallas++; console.log(`✗ [${u.giro}/${u.role}/${vn}] ${h}: ${errs[0] ?? ''}${api.length ? ' API ' + api.join(',') : ''}${a.overflow ? ' DESBORDA' : ''}${a.bad.length ? ` contraste(${a.bad.length}) ${a.bad.slice(0, 1).join('|')}` : ''}${vn === 'celular' && a.small.length ? ` letra(${a.small.length}) ${a.small.slice(0, 1).join('|')}` : ''}${a.encimados.length ? ` encimados(${a.encimados.length})` : ''}${a.sinNombre.length ? ` sinNombre(${a.sinNombre.length})` : ''}${a.cortados.length ? ` cortados(${a.cortados.length})` : ''}`); errs.length = 0; api.length = 0 }
    }
    await ctx.close()
  }
  resumen.push(`${u.giro}/${u.role}`)
}
await browser.close(); server.close()
console.log(`\n${usuarios} usuarios (un dueño y un empleado/encargado por negocio: ${resumen.join(', ')})\n${revisiones} pantallas revisadas en modo ${modo} (escritorio y celular) sobre la copia de un respaldo real · con hallazgos: ${fallas}`)
process.exit(fallas ? 1 : 0)
