import type { MiddlewareHandler } from 'hono'
import type { Env } from './context.js'
import { AppError } from './util.js'

/**
 * Límite de intentos por IP en las rutas públicas (entrar, registrarse, recuperar, reservar, comprar boletos).
 * Complementa el bloqueo por cuenta: frena a quien prueba muchas cuentas o llena reservas con teléfonos distintos.
 * Vive en la memoria del Durable Object (uno solo para todos): gratis y sin tablas; si se reinicia, empieza de cero.
 * Sin IP (pruebas, procesos internos) no se limita: en Cloudflare la IP siempre llega en `cf-connecting-ip`.
 */
type Rule = { bucket: string; match: (method: string, path: string) => boolean; max: number; windowMs: number }

const MIN = 60_000
export const RULES: Rule[] = [
  { bucket: 'entrar', match: (m, p) => m === 'POST' && ['/auth/login', '/auth/owner/login', '/admin/login'].includes(p), max: 30, windowMs: 10 * MIN },
  { bucket: 'codigos', match: (m, p) => m === 'POST' && ['/auth/register/verify', '/auth/owner/verify', '/auth/owner/recover/verify'].includes(p), max: 30, windowMs: 10 * MIN },
  // Cada registro o recuperación puede mandar un SMS (cuesta): pocos por hora.
  { bucket: 'sms', match: (m, p) => m === 'POST' && ['/auth/register', '/auth/owner/recover'].includes(p), max: 10, windowMs: 60 * MIN },
  { bucket: 'publico', match: (m, p) => m === 'POST' && p.startsWith('/public/'), max: 60, windowMs: 60 * MIN },
]

export function rateLimiter(now: () => Date, rules: Rule[] = RULES): MiddlewareHandler<Env> {
  const hits = new Map<string, { n: number; reset: number }>()
  let sweep = 0
  return async (c, next) => {
    // La IP la pone el Worker de entrada en x-nexora-ip (siempre la sobrescribe con la de Cloudflare), o Cloudflare directo.
    // En el servidor de desarrollo (Node) no hay límite.
    const ip = c.req.header('x-nexora-ip') || c.req.header('cf-connecting-ip')
    const rule = ip ? rules.find((r) => r.match(c.req.method, c.req.path)) : undefined
    if (!rule || !ip) return next()
    const t = now().getTime()
    // Limpieza ocasional para que la memoria no crezca.
    if (t > sweep) { for (const [k, v] of hits) if (v.reset <= t) hits.delete(k); sweep = t + 5 * MIN }
    const key = `${rule.bucket}:${ip}`
    const h = hits.get(key)
    if (!h || h.reset <= t) hits.set(key, { n: 1, reset: t + rule.windowMs })
    else if (++h.n > rule.max) {
      const mins = Math.max(1, Math.ceil((h.reset - t) / MIN))
      c.header('Retry-After', String(Math.ceil((h.reset - t) / 1000)))
      throw new AppError(429, 'demasiados_intentos', `Demasiados intentos desde esta conexión. Espera ${mins} ${mins === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`)
    }
    return next()
  }
}
