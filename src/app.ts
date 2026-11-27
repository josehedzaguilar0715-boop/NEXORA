import { Hono } from 'hono'
import { authed, publicAuth } from './auth.js'
import { admin } from './admin.js'
import { businessGate } from './billing.js'
import { authenticate } from './context.js'
import { branches, support } from './support.js'
import { common, publicCommon } from './common.js'
import { finance } from './finance.js'
import { accounting } from './accounting.js'
import { finanzas } from './finanzas.js'
import { auto } from './automatizaciones.js'
import { resumen } from './resumen-sucursal.js'
import { importer } from './importer.js'
import { layaways } from './layaways.js'
import { reset } from './reset.js'
import { campaigns, publicCampaigns } from './campaigns.js'
import { today } from './today.js'
import { inventarioExport } from './inventario-export.js'
import { plano } from './plano.js'
import { escaparate, publicEscaparate } from './escaparate.js'
import { notifications } from './notifications.js'
import { publicLinks } from './publiclinks.js'
import { dashboard } from './dashboard.js'
import { setDemoApp } from './demo.js'
import { inventory } from './inventory.js'
import { hardware } from './hardware.js'
import { services } from './services.js'
import { agenda, publicAgenda } from './agenda.js'
import { publicReceipts } from './sales.js'
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
import { rateLimiter } from './ratelimit.js'
import { scopeGuard } from './scope.js'
import { datos } from './datos.js'
import { recordError } from './monitor.js'

export function createApp(deps: Deps) {
  const app = new Hono<Env>()
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  app.get('/health', (c) => {
    // Solo dice si la base responde y en qué versión de esquema está (sin cifras del negocio).
    try { return c.json({ ok: true, schema: (deps.db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v }) } catch { return c.json({ ok: false }, 503) }
  })
  app.use('*', rateLimiter(deps.now))
  app.route('/', publicAuth)
  app.route('/', publicCommon)
  app.route('/', publicCampaigns)
  app.route('/', publicAgenda)
  app.route('/', publicEscaparate)
  app.route('/', publicReceipts)
  app.route('/', publicTourism)
  app.route('/', admin as unknown as Hono<Env>)
  // Todo lo demás exige sesión (authed ya aplica `authenticate`).
  const protectedApp = new Hono<Env>()
  protectedApp.use('*', authenticate)
  protectedApp.use('*', businessGate)
  // Alcance por puesto: sucursal y «solo lo propio» (ver src/scope.ts). Antes de cualquier ruta.
  protectedApp.use('*', scopeGuard)
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
  protectedApp.route('/', plano)
  protectedApp.route('/', menus)
  protectedApp.route('/', taqueria)
  protectedApp.route('/', inventory)
  protectedApp.route('/', inventarioExport)
  protectedApp.route('/', finance)
  protectedApp.route('/', accounting)
  protectedApp.route('/', finanzas)
  protectedApp.route('/', auto)
  protectedApp.route('/', resumen)
  protectedApp.route('/', importer)
  protectedApp.route('/', layaways)
  protectedApp.route('/', reset)
  protectedApp.route('/', campaigns)
  protectedApp.route('/', today)
  protectedApp.route('/', escaparate)
  protectedApp.route('/', dashboard)
  protectedApp.route('/', notifications)
  protectedApp.route('/', publicLinks)
  protectedApp.route('/', datos)
  app.route('/', protectedApp)

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message } }, err.status as 400)
    console.error(err)
    let biz: string | null = null
    try { biz = c.get('session')?.user.business_id ?? null } catch { /* sin sesión */ }
    recordError(deps, { source: 'api', route: `${c.req.method} ${c.req.path}`, status: 500, message: err instanceof Error ? `${err.name}: ${err.message}` : 'error', businessId: biz })
    return c.json({ error: { code: 'error_interno', message: 'Ocurrió un error. Inténtalo de nuevo.' } }, 500)
  })
  app.notFound((c) => c.json({ error: { code: 'no_encontrado', message: 'Ruta no encontrada.' } }, 404))
  setDemoApp(app)
  return app
}
