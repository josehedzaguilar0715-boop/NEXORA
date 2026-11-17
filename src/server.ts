import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, mkdirSync } from 'node:fs'
import { createApp } from './app.js'
import { openDb } from './db.js'

mkdirSync('data', { recursive: true })
const db = openDb(process.env.NEXORA_DB ?? 'data/nexora.db')
const api = createApp({
  db,
  now: () => new Date(),
  // Desarrollo: el código solo se imprime. En staging se conecta WhatsApp/SMS (proveedor pendiente).
  notifier: { sendCode: (phone, code) => console.log(`[verificación] ${phone}: ${code}`) },
})

const root = new Hono()
root.route('/api', api)
// La app web (pantallas) se sirve desde web/dist después de `npm run build`.
if (existsSync('web/dist')) {
  root.use('/*', serveStatic({ root: './web/dist' }))
  root.get('*', serveStatic({ path: './web/dist/index.html' }))
}

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: root.fetch, port }, () => console.log(`NEXORA escuchando en http://localhost:${port}`))
