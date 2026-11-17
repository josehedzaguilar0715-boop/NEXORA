import { Hono } from 'hono'
import { authed, publicAuth } from './auth.js'
import { authenticate } from './context.js'
import { cash } from './cash.js'
import type { Deps, Env } from './context.js'
import { sales } from './sales.js'
import { idempotency, sync } from './sync.js'
import { users } from './users.js'
import { AppError } from './util.js'

export function createApp(deps: Deps) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.get('/health', (c) => c.json({ ok: true }))
  app.route('/', publicAuth)
  // Todo lo demás exige sesión (authed ya aplica `authenticate`).
  const protectedApp = new Hono<Env>()
  protectedApp.use('*', authenticate)
  protectedApp.use('*', idempotency)
  protectedApp.route('/', authed)
  protectedApp.route('/', sync)
  protectedApp.route('/', users)
  protectedApp.route('/', cash)
  protectedApp.route('/', sales)
  app.route('/', protectedApp)

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400)
    console.error(err)
    return c.json({ error: { code: 'error_interno', message: 'Ocurrió un error. Inténtalo de nuevo.' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'no_encontrado', message: 'Ruta no encontrada.' } }, 404))
  return app
}
