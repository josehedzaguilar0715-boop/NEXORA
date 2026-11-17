import { serve } from '@hono/node-server'
import { mkdirSync } from 'node:fs'
import { createApp } from './app.js'
import { openDb } from './db.js'

mkdirSync('data', { recursive: true })
const db = openDb(process.env.NEXORA_DB ?? 'data/nexora.db')
const app = createApp({
  db,
  now: () => new Date(),
  // Desarrollo: el código solo se imprime. En staging se conecta WhatsApp/SMS (proveedor pendiente).
  notifier: { sendCode: (phone, code) => console.log(`[verificación] ${phone}: ${code}`) },
})
const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`NEXORA escuchando en http://localhost:${port}`))
