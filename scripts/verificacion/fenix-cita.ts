// La cita ya agendada de una barbería (cuyo profesional ya no está activo en la agenda) debe verse en el calendario y en la lista.
// Corre sobre una COPIA aislada de un respaldo real. Uso: npx tsx scripts/verificacion/fenix-cita.ts <respaldo-restaurado.db>
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createApp } from '../../src/app.js'
import { openDb } from '../../src/db-node.js'
import { sha256 } from '../../src/util.js'
const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const src = process.argv[2]; if (!src) throw new Error('Uso: tsx scripts/verificacion/fenix-cita.ts <copia.db>')
const dest = `${src}.fenix`; if (existsSync(dest)) unlinkSync(dest); copyFileSync(src, dest)
const db = openDb(dest)
const app = createApp({ db, now: () => new Date(), notifier: { sendCode: () => false, smsEnabled: false } })
const root = new Hono(); root.route('/api', app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const biz = db.prepare("SELECT id FROM businesses WHERE giro = 'barberia' LIMIT 1").get() as { id: string }
const owner = db.prepare("SELECT id FROM users WHERE business_id = ? AND role = 'owner'").get(biz.id) as { id: string }
const exp = new Date(Date.now() + 3_600_000).toISOString()
db.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)').run('fx', owner.id, sha256('fxtok'), exp, exp, exp)
const cita = db.prepare("SELECT starts_at, customer_name FROM appointments WHERE business_id = ? AND status IN ('confirmada','pendiente') ORDER BY starts_at DESC LIMIT 1").get(biz.id) as { starts_at: string; customer_name: string } | undefined
const dia = cita ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(cita.starts_at)) : ''
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
ok(!!cita, 'la barbería tiene una cita abierta en el respaldo')
const b = await chromium.launch()
for (const [vn, vp] of [['escritorio', { width: 1366, height: 900 }], ['celular', { width: 390, height: 844 }]] as const) {
  const ctx = await b.newContext({ viewport: vp })
  await ctx.addInitScript(() => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', 'fxtok') })
  const page = await ctx.newPage()
  await page.goto(base + '/#/agenda'); await page.waitForTimeout(1500)
  await page.getByLabel('Día', { exact: true }).fill(dia); await page.waitForTimeout(1200)
  ok(await page.locator('.cal-cita').count() >= 1, `[${vn}] la cita aparece como bloque en el calendario`)
  ok(await page.locator('.cal-cita', { hasText: cita!.customer_name.split(' ')[0]! }).count() >= 1, `[${vn}] el bloque muestra al cliente`)
  await page.getByRole('button', { name: 'Lista', exact: true }).click(); await page.waitForTimeout(700)
  ok(await page.locator('.appt', { hasText: cita!.customer_name.split(' ')[0]! }).count() >= 1, `[${vn}] la cita también aparece en la lista`)
  await ctx.close()
}
await b.close(); server.close()
console.log(fails ? `\n✗ ${fails} fallas` : '\nTodo en orden (solo en la copia)'); process.exit(fails ? 1 : 0)
