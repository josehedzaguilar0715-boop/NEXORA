import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createApp } from './app.js'
import { openDb } from './db-node.js'
import { createNotifier } from './notify.js'
import { runBackup } from './backup.js'
import { fsBackupStore, msUntilLocal } from './backup-fs.js'
import type { Deps } from './context.js'

const dbPath = process.env.NEXORA_DB ?? 'data/nexora.db'
mkdirSync(dirname(dbPath), { recursive: true })
const db = openDb(dbPath)
const deps: Deps = {
  db,
  now: () => new Date(),
  // SMS por Twilio y correo por Resend; sin credenciales solo se imprime en consola.
  notifier: createNotifier(),
  backups: fsBackupStore(process.env.NEXORA_BACKUPS ?? join(dirname(dbPath), 'respaldos')),
}
const api = createApp(deps)

// Respaldo automático cada noche a las 3:17 (hora del centro de México).
const nightly = () => runBackup(deps, deps.backups!).then((r) => console.log(`[respaldo] ${r.name}`)).catch((e) => console.error('[respaldo] falló', e))
setTimeout(() => { void nightly(); setInterval(nightly, 86_400_000) }, msUntilLocal(3, 17))

const root = new Hono()
root.route('/api', api)
// La app web (pantallas) se sirve desde web/dist después de `npm run build`.
if (existsSync('web/dist')) {
  root.use('/*', serveStatic({ root: './web/dist' }))
  root.get('*', serveStatic({ path: './web/dist/index.html' }))
}

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: root.fetch, port }, () => console.log(`NEXORA escuchando en http://localhost:${port}`))
