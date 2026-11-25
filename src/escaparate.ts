import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { businessGiros } from './billing.js'
import { body, ownerOnly, parse, type Env } from './context.js'
import type { Db } from './db.js'
import { AppError, notFound } from './util.js'

/**
 * Escaparate público del negocio (perfil, menú o lista de precios compartible).
 * Todo se guarda en los ajustes del negocio y en los datos que ya existen (attrs): sin cambios de esquema.
 * Nada es público hasta que el dueño lo enciende; solo salen nombre, precio y foto (nunca costos ni existencias).
 */

/** Solo direcciones https, para no mostrar enlaces peligrosos ni mezclar contenido inseguro. */
export const imagenSegura = (u: unknown): string | null => {
  if (typeof u !== 'string') return null
  const t = u.trim()
  if (t.length > 500 || !/^https:\/\/[^\s"'<>]+$/i.test(t)) return null
  try { return new URL(t).protocol === 'https:' ? t : null } catch { return null }
}

const PERFIL = z.object({
  descripcion: z.string().trim().max(400),
  direccion: z.string().trim().max(200),
  horario: z.string().trim().max(200),
  instagram: z.string().trim().max(60),
  facebook: z.string().trim().max(120),
  portadaUrl: z.string().trim().max(500),
  /** Mostrar la carta/lista de precios en su enlace público. */
  publicarCarta: z.boolean(),
}).partial()
export type Perfil = z.infer<typeof PERFIL>

export function perfilOf(db: Db, businessId: string): Perfil & { portadaUrl?: string } {
  const row = db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'perfil'").get(businessId) as { value: string } | undefined
  if (!row) return {}
  try { return PERFIL.parse(JSON.parse(row.value)) } catch { return {} }
}

/** El perfil tal como lo ve el público (portada validada; sin nada interno). */
export function perfilPublico(db: Db, businessId: string) {
  const p = perfilOf(db, businessId)
  return {
    descripcion: p.descripcion ?? '', direccion: p.direccion ?? '', horario: p.horario ?? '',
    instagram: (p.instagram ?? '').replace(/^@/, ''), facebook: imagenSegura(p.facebook) ?? '', portadaUrl: imagenSegura(p.portadaUrl),
  }
}

export const escaparate = new Hono<Env>()

escaparate.get('/escaparate', ownerOnly, (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const row = db.prepare('SELECT public_slug FROM businesses WHERE id = ?').get(u.business_id) as { public_slug: string | null }
  return c.json({ perfil: perfilOf(db, u.business_id), slug: row.public_slug })
})

escaparate.put('/escaparate', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(PERFIL, await body(c))
  if (d.portadaUrl && !imagenSegura(d.portadaUrl)) throw new AppError(400, 'imagen_invalida', 'La imagen de portada debe ser una dirección que empiece con https://')
  if (d.facebook && !imagenSegura(d.facebook)) throw new AppError(400, 'enlace_invalido', 'El enlace de Facebook debe empezar con https://')
  const old = perfilOf(db, u.business_id)
  const nuevo = { ...old, ...d }
  db.prepare("INSERT INTO business_settings (business_id, key, value) VALUES (?, 'perfil', ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value").run(u.business_id, JSON.stringify(nuevo))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'negocio.escaparate', oldValue: old, newValue: d })
  return c.json({ perfil: nuevo })
})

export const publicEscaparate = new Hono<Env>()

/** Qué tipo de lista conviene a cada giro. */
export const tipoCarta = (giros: string[]): 'menu' | 'precios' | 'catalogo' =>
  giros.some((g) => ['restaurante', 'taqueria', 'comedor', 'palapa'].includes(g)) ? 'menu' : giros.includes('verduleria') ? 'precios' : 'catalogo'

publicEscaparate.get('/public/carta/:slug', (c) => {
  const { db } = c.get('deps')
  const slug = (c.req.param('slug') ?? '').toLowerCase()
  const b = db.prepare('SELECT id, name, phone, status, giro, logo_url FROM businesses WHERE public_slug = ?').get(slug) as { id: string; name: string; phone: string | null; status: string; giro: string; logo_url: string | null } | undefined
  if (!b || b.status === 'vencido' || b.status === 'suspendido' || perfilOf(db, b.id).publicarCarta !== true) throw notFound('Esta lista no está disponible.')
  const giros = businessGiros(db, b.id)
  const rows = db.prepare(`SELECT p.name, p.price, p.unit, p.attrs, COALESCE(c.name, 'Otros') AS category
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.business_id = ? AND p.active = 1 AND p.sellable = 1 ORDER BY category, p.name LIMIT 500`).all(b.id) as { name: string; price: number; unit: string; attrs: string; category: string }[]
  const sections = new Map<string, { name: string; price: number; unit: string; imageUrl: string | null; note: string }[]>()
  for (const r of rows) {
    let a: Record<string, unknown> = {}
    try { a = JSON.parse(r.attrs) } catch { /* sin atributos */ }
    const list = sections.get(r.category) ?? []
    list.push({ name: r.name, price: r.price, unit: r.unit, imageUrl: imagenSegura(a.imagenUrl), note: typeof a.descripcion === 'string' ? a.descripcion.slice(0, 120) : '' })
    sections.set(r.category, list)
  }
  c.header('cache-control', 'public, max-age=60')
  return c.json({
    kind: tipoCarta(giros),
    business: { name: b.name, phone: b.phone, giro: b.giro, logoUrl: imagenSegura(b.logo_url) },
    profile: perfilPublico(db, b.id),
    sections: [...sections].map(([name, items]) => ({ name, items })),
  })
})
