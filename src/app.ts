import { Hono } from 'hono'
import { authed, publicAuth } from './auth.js'
import { admin } from './admin.js'
import { businessGate } from './billing.js'
import { authenticate } from './context.js'
import { branches, support } from './support.js'
import { common, publicCommon } from './common.js'
import { finance } from './finance.js'
import { accounting } from './accounting.js'
import { importer } from './importer.js'
import { layaways } from './layaways.js'
import { reset } from './reset.js'
import { campaigns, publicCampaigns } from './campaigns.js'
import { today } from './today.js'
import { notifications } from './notifications.js'
import { publicLinks } from './publiclinks.js'
import { dashboard } from './dashboard.js'
import { setDemoApp } from './demo.js'
import { inventory } from './inventory.js'
import { hardware } from './hardware.js'
import { services } from './services.js'
import { agenda, publicAgenda } from './agenda.js'
import { commissions } from './commissions.js'
import { payouts } from './payouts.js'
import { settings } from './settings.js'
import { perfume } from './perfume.js'
import { baths } from './baths.js'
import { publicTourism, tourism } from './tourism.js'
import { dining } from './dining.js'
import { menus } from './menus.js'
import { taqueria } from './taqueria.js'
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
  app.route('/', publicCommon)
  app.route('/', publicCampaigns)
  app.route('/', publicAgenda)
  app.route('/', publicTourism)
  app.route('/', admin as unknown as Hono<Env>)
  // Todo lo demás exige sesión (authed ya aplica `authenticate`).
  const protectedApp = new Hono<Env>()
  protectedApp.use('*', authenticate)
  protectedApp.use('*', businessGate)
  protectedApp.use('*', idempotency)
  protectedApp.route('/', authed)
  protectedApp.route('/', sync)
  protectedApp.route('/', users)
  protectedApp.route('/', cash)
  protectedApp.route('/', sales)
  protectedApp.route('/', support)
  protectedApp.route('/', branches)
  protectedApp.route('/', common)
  protectedApp.route('/', hardware)
  protectedApp.route('/', services)
  protectedApp.route('/', agenda)
  protectedApp.route('/', commissions)
  protectedApp.route('/', payouts)
  protectedApp.route('/', settings)
  protectedApp.route('/', perfume)
  protectedApp.route('/', baths)
  protectedApp.route('/', tourism)
  protectedApp.route('/', dining)
  protectedApp.route('/', menus)
  protectedApp.route('/', taqueria)
  protectedApp.route('/', inventory)
  protectedApp.route('/', finance)
  protectedApp.route('/', accounting)
  protectedApp.route('/', importer)
  protectedApp.route('/', layaways)
  protectedApp.route('/', reset)
  protectedApp.route('/', campaigns)
  protectedApp.route('/', today)
  protectedApp.route('/', dashboard)
  protectedApp.route('/', notifications)
  protectedApp.route('/', publicLinks)
  app.route('/', protectedApp)

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400)
    console.error(err)
    return c.json({ error: { code: 'error_interno', message: 'Ocurrió un error. Inténtalo de nuevo.' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'no_encontrado', message: 'Ruta no encontrada.' } }, 404))
  setDemoApp(app)
  return app
}
