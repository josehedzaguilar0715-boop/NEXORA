import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, ownerOnly, parse, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, conflict } from './util.js'
import { randomBytes } from 'node:crypto'

/**
 * Enlaces públicos (reservas, boletos): usan un identificador público propio del negocio
 * («fenix-barberia-7k2q»), distinto del código interno con el que entran los empleados.
 * Los enlaces viejos con el código siguen funcionando para no romper los que ya se compartieron.
 */

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'negocio'
const suffix = () => randomBytes(3).toString('hex').slice(0, 4)
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

/** Identificador público del negocio; se crea la primera vez que se pide (no cambia nada más). */
export function ensurePublicSlug(db: Db, businessId: string): string {
  const row = db.prepare('SELECT name, public_slug FROM businesses WHERE id = ?').get(businessId) as { name: string; public_slug: string | null }
  if (row.public_slug) return row.public_slug
  for (let i = 0; i < 20; i++) {
    const slug = `${slugify(row.name)}-${suffix()}`
    if (!db.prepare('SELECT 1 FROM businesses WHERE public_slug = ?').get(slug)) {
      db.prepare('UPDATE businesses SET public_slug = ? WHERE id = ? AND public_slug IS NULL').run(slug, businessId)
      return (db.prepare('SELECT public_slug FROM businesses WHERE id = ?').get(businessId) as { public_slug: string }).public_slug
    }
  }
  throw conflict('No se pudo crear el enlace público. Intenta de nuevo.')
}

/** Busca el negocio de un enlace público: por identificador público o (enlaces viejos) por código. */
export function findPublicBusiness(db: Db, codeOrSlug: string) {
  const v = codeOrSlug.trim()
  return db.prepare('SELECT id, name, phone, status FROM businesses WHERE public_slug = ? OR code = ? LIMIT 1').get(v.toLowerCase(), v.toUpperCase()) as
    { id: string; name: string; phone: string | null; status: string } | undefined
}

/** Nombre que ve el público de quien atiende: nombre e inicial del apellido («Luis P.»). */
export const publicName = (full: string) => {
  const [first, ...rest] = full.trim().split(/\s+/)
  return rest.length ? `${first} ${rest[rest.length - 1]!.charAt(0).toUpperCase()}.` : first ?? ''
}

export const publicLinks = new Hono<Env>()

publicLinks.get('/business/public-link', (c) => {
  const u = c.get('session').user
  return c.json({ slug: ensurePublicSlug(c.get('deps').db, u.business_id) })
})

/** El dueño puede elegir un enlace fácil de recordar (p. ej. «fenix-barberia»). */
publicLinks.put('/business/public-link', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ slug: z.string().trim().toLowerCase() }), await body(c))
  if (!SLUG_RE.test(d.slug)) throw bad('Usa de 3 a 40 letras sin acentos, números y guiones (por ejemplo: fenix-barberia).')
  if (db.prepare('SELECT 1 FROM businesses WHERE public_slug = ? AND id != ?').get(d.slug, u.business_id)) throw conflict('Ese enlace ya lo usa otro negocio. Prueba con otro.', 'enlace_ocupado')
  const before = ensurePublicSlug(db, u.business_id)
  db.prepare('UPDATE businesses SET public_slug = ? WHERE id = ?').run(d.slug, u.business_id)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'negocio.enlace_publico', oldValue: { slug: before }, newValue: { slug: d.slug } })
  return c.json({ slug: d.slug })
})
