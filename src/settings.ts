import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, ownerOnly, parse, type Env } from './context.js'
import type { Db } from './db.js'

/** Ajustes por negocio. Todo lo opcional viene apagado por defecto. */
const SETTINGS = z.object({
  /** Cargo por traslado a domicilio (centavos). null = apagado. Va fuera de la comisión. */
  travelFee: z.number().int().min(0).nullable(),
  /** Baños: minutos en que un pase no puede volver a entrar (misma visita). */
  passReentryMin: z.number().int().min(0).max(24 * 60),
}).partial()
export type Settings = z.infer<typeof SETTINGS>

export function getSettings(db: Db, businessId: string): Settings {
  const rows = db.prepare('SELECT key, value FROM business_settings WHERE business_id = ?').all(businessId) as { key: string; value: string }[]
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as Settings
}

export const settings = new Hono<Env>()

settings.get('/settings', (c) => c.json({ settings: getSettings(c.get('deps').db, c.get('session').user.business_id) }))

settings.put('/settings', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(SETTINGS, await body(c))
  const old = getSettings(db, u.business_id)
  for (const [k, v] of Object.entries(d)) db.prepare('INSERT INTO business_settings (business_id, key, value) VALUES (?,?,?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value').run(u.business_id, k, JSON.stringify(v))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'negocio.ajustes', oldValue: old, newValue: d })
  return c.json({ settings: getSettings(db, u.business_id) })
})
