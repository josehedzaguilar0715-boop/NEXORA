import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, parse, requirePerm, type Env } from './context.js'

/**
 * Plano de mesas: dónde va cada mesa dentro de su zona (en porcentaje, 0–100).
 * Se guarda en los ajustes del negocio. Las mesas sin posición se acomodan solas en cuadrícula.
 */
const PLANO = z.record(z.string().max(64), z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })).refine((o) => Object.keys(o).length <= 300, 'Demasiadas mesas.')

export const plano = new Hono<Env>()

const leer = (c: { get: Function }) => {
  const { db } = c.get('deps') as { db: import('./db.js').Db }
  const u = (c.get('session') as { user: { business_id: string } }).user
  const row = db.prepare("SELECT value FROM business_settings WHERE business_id = ? AND key = 'planoMesas'").get(u.business_id) as { value: string } | undefined
  try { return row ? PLANO.parse(JSON.parse(row.value)) : {} } catch { return {} }
}

plano.get('/tables/plan', (c) => c.json({ plan: leer(c) }))

plano.put('/tables/plan', requirePerm('configure_catalog'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const nuevo = parse(PLANO, await body(c))
  // Solo mesas de este negocio: se descartan ids ajenos o inexistentes.
  const propias = new Set((db.prepare('SELECT id FROM dining_tables WHERE business_id = ?').all(u.business_id) as { id: string }[]).map((r) => r.id))
  const limpio = Object.fromEntries(Object.entries(nuevo).filter(([id]) => propias.has(id)))
  db.prepare("INSERT INTO business_settings (business_id, key, value) VALUES (?, 'planoMesas', ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value").run(u.business_id, JSON.stringify(limpio))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'mesas.plano', newValue: { mesas: Object.keys(limpio).length } })
  return c.json({ plan: limpio })
})
