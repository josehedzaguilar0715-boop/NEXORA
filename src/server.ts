import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app.js'
import { openDb } from './db-node.js'
import { createNotifier } from './notify.js'

const dbPath = process.env.NEXORA_DB ?? 'data/nexora.db'
mkdirSync(dirname(dbPath), { recursive: true })
const db = openDb(dbPath)
const api = createApp({
  db,
  now: () => new Date(),
  // SMS por Twilio y correo por Resend; sin credenciales solo se imprime en consola.
  notifier: createNotifier(),
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
