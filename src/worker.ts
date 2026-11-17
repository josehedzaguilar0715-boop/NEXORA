import { DurableObject } from 'cloudflare:workers'
import { createAdmin } from './admin.js'
import { createApp } from './app.js'
import type { Deps } from './context.js'
import { doDb } from './db-do.js'
import { createNotifier } from './notify.js'
// Pantallas compiladas incluidas en el paquete (npm run build && tsx scripts/embed-assets.ts).
import { ASSETS } from './assets.gen.js'

/**
 * NEXORA en Cloudflare (plan gratuito): el Worker entrega las pantallas (incluidas en el paquete) y la API (/api/*)
 * corre dentro de un Durable Object con SQLite. Una sola instancia guarda toda la base.
 */
interface Env {
  NEXORA: { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } }
  [k: string]: unknown
}

export class Nexora extends DurableObject<Env> {
  private app: ReturnType<typeof createApp>

  constructor(ctx: ConstructorParameters<typeof DurableObject>[0], env: Env) {
    super(ctx, env)
    const vars = env as unknown as Record<string, string | undefined>
    const deps: Deps = { db: doDb(ctx.storage), now: () => new Date(), notifier: createNotifier(vars) }
    // Primer arranque: crea el usuario del super panel con los secretos ADMIN_* (no viven en el repositorio).
    const hasAdmin = deps.db.prepare('SELECT 1 FROM admins LIMIT 1').get()
    if (!hasAdmin && vars.ADMIN_USERNAME && vars.ADMIN_PASSWORD) {
      createAdmin(deps, { username: vars.ADMIN_USERNAME, name: vars.ADMIN_NAME ?? 'Soporte', password: vars.ADMIN_PASSWORD, phone: vars.ADMIN_PHONE, email: vars.ADMIN_EMAIL })
    }
    this.app = createApp(deps)
  }

  fetch(req: Request): Promise<Response> | Response {
    return this.app.fetch(req)
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice(4) || '/'
      return env.NEXORA.get(env.NEXORA.idFromName('principal')).fetch(new Request(url, req))
    }
    // Pantallas: archivo exacto o, si no existe, la app (rutas como /admin o /reservar/…).
    const file = ASSETS[url.pathname] ?? ASSETS['/index.html']!
    const bytes = Uint8Array.from(atob(file.body), (ch) => ch.charCodeAt(0))
    const immutable = url.pathname.startsWith('/assets/')
    return new Response(bytes, { headers: { 'content-type': file.type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' } })
  },
}
