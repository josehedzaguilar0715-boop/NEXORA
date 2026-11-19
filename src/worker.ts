import { DurableObject } from 'cloudflare:workers'
import { createAdmin } from './admin.js'
import { createApp } from './app.js'
import type { Deps } from './context.js'
import { doDb } from './db-do.js'
import { createNotifier } from './notify.js'
import { runBackup, type BackupStore } from './backup.js'
// Pantallas compiladas incluidas en el paquete (npm run build && tsx scripts/embed-assets.ts).
import { ASSETS } from './assets.gen.js'

/**
 * NEXORA en Cloudflare (plan gratuito): el Worker entrega las pantallas (incluidas en el paquete) y la API (/api/*)
 * corre dentro de un Durable Object con SQLite. Una sola instancia guarda toda la base.
 */
interface KV {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { expirationTtl?: number; metadata?: unknown }): Promise<void>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  delete(key: string): Promise<void>
  list(opts?: { prefix?: string; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>
}

/** Respaldos en Cloudflare KV (plan gratuito), aparte de la base. Caducan solos a los 31 días. */
function kvStore(kv: KV): BackupStore {
  return {
    async put(name, bytes) { await kv.put(name, bytes, { expirationTtl: 31 * 86_400, metadata: { size: bytes.length } }) },
    async list() {
      const out: { name: string; size: number }[] = []
      let cursor: string | undefined
      do {
        const r = await kv.list({ prefix: 'nexora-', cursor })
        for (const k of r.keys) out.push({ name: k.name, size: Number((k.metadata as { size?: number } | undefined)?.size ?? 0) })
        cursor = r.list_complete ? undefined : r.cursor
      } while (cursor)
      return out
    },
    async get(name) { const b = await kv.get(name, 'arrayBuffer'); return b ? new Uint8Array(b) : null },
    async remove(name) { await kv.delete(name) },
  }
}

interface Env {
  NEXORA: { idFromName(name: string): unknown; get(id: unknown): { fetch(req: Request): Promise<Response> } }
  BACKUPS?: KV
  [k: string]: unknown
}

export class Nexora extends DurableObject<Env> {
  private app: ReturnType<typeof createApp>
  private deps: Deps

  constructor(ctx: ConstructorParameters<typeof DurableObject>[0], env: Env) {
    super(ctx, env)
    const vars = env as unknown as Record<string, string | undefined>
    const deps: Deps = { db: doDb(ctx.storage), now: () => new Date(), notifier: createNotifier(vars), backups: env.BACKUPS ? kvStore(env.BACKUPS) : undefined, defer: (p) => ctx.waitUntil(p) }
    this.deps = deps
    // Primer arranque: crea el usuario del super panel con los secretos ADMIN_* (no viven en el repositorio).
    const hasAdmin = deps.db.prepare('SELECT 1 FROM admins LIMIT 1').get()
    if (!hasAdmin && vars.ADMIN_USERNAME && vars.ADMIN_PASSWORD) {
      createAdmin(deps, { username: vars.ADMIN_USERNAME, name: vars.ADMIN_NAME ?? 'Soporte', password: vars.ADMIN_PASSWORD, phone: vars.ADMIN_PHONE, email: vars.ADMIN_EMAIL })
    }
    this.app = createApp(deps)
  }

  async fetch(req: Request): Promise<Response> {
    // Llamada interna del cron (el Worker nunca deja pasar esta ruta desde internet).
    if (new URL(req.url).pathname === '/__interno/respaldo') {
      if (!this.deps.backups) return Response.json({ error: 'sin almacenamiento de respaldos' }, { status: 500 })
      return Response.json(await runBackup(this.deps, this.deps.backups))
    }
    return this.app.fetch(req)
  }
}

/** Los archivos de la app se decodifican una sola vez por instancia (antes, en cada petición: CPU de más). */
const decodedCache = new Map<string, Uint8Array<ArrayBuffer>>()
function decoded(key: string, b64: string): Uint8Array<ArrayBuffer> {
  let bytes = decodedCache.get(key)
  if (!bytes) {
    const bin = atob(b64)
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    decodedCache.set(key, bytes)
  }
  return bytes
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice(4) || '/'
      if (url.pathname.startsWith('/__interno')) return new Response('No encontrado', { status: 404 })
      return env.NEXORA.get(env.NEXORA.idFromName('principal')).fetch(new Request(url, req))
    }
    // Pantallas: archivo exacto o, si no existe, la app (rutas como /admin o /reservar/…).
    const key = ASSETS[url.pathname] ? url.pathname : '/index.html'
    const file = ASSETS[key]!
    const bytes = decoded(key, file.body)
    const immutable = url.pathname.startsWith('/assets/')
    return new Response(bytes, { headers: { 'content-type': file.type, 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' } })
  },

  /** Cron diario: respaldo de toda la base. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const r = await env.NEXORA.get(env.NEXORA.idFromName('principal')).fetch(new Request('https://interno/__interno/respaldo', { method: 'POST' }))
    console.log(`[respaldo] ${r.status} ${await r.text()}`)
  },
}
