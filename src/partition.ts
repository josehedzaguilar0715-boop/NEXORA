import type { Db } from './db.js'

/**
 * Separar la base por negocio (estrategia de crecimiento, ver docs/modernizacion/14-estrategia-de-crecimiento.md).
 * Cada tabla es: de un negocio (columna business_id), de un negocio a través de otra tabla (OWNER), o global.
 * `exportBusiness` saca TODO lo de un negocio y nada de otro; con `importAll` se carga en una base vacía.
 * La prueba test/particion.test.ts exige que toda tabla esté clasificada aquí.
 * Los renglones con business_id vacío (bitácora del super panel, respaldos) son de la plataforma, no de un negocio.
 */
export const GLOBAL_TABLES = ['_migrations', 'admins', 'admin_sessions', 'admin_challenges', 'settings', 'app_keys'] as const

/** Tabla → [columna, tabla de la que depende]. La tabla de la que depende ya es de un negocio. */
export const OWNER: Record<string, [string, string]> = {
  asset_rentals: ['tab_id', 'tabs'],
  campaign_awards: ['campaign_id', 'campaigns'],
  campaign_prizes: ['campaign_id', 'campaigns'],
  cash_movements: ['shift_id', 'shifts'],
  combo_items: ['combo_id', 'products'],
  consumption_carry: ['branch_id', 'branches'],
  counter_readings: ['shift_id', 'shifts'],
  idempotency: ['user_id', 'users'],
  layaway_items: ['layaway_id', 'layaways'],
  layaway_payments: ['layaway_id', 'layaways'],
  membership_uses: ['membership_id', 'customer_memberships'],
  notification_seen: ['user_id', 'users'],
  presentations: ['product_id', 'products'],
  price_tiers: ['product_id', 'products'],
  product_suppliers: ['product_id', 'products'],
  purchase_items: ['purchase_id', 'purchases'],
  recipes: ['product_id', 'products'],
  return_items: ['return_id', 'returns'],
  sale_counters: ['branch_id', 'branches'],
  sale_items: ['sale_id', 'sales'],
  sale_payments: ['sale_id', 'sales'],
  sale_promotions: ['sale_id', 'sales'],
  service_combos: ['combo_id', 'services'],
  sessions: ['user_id', 'users'],
  staff_schedules: ['user_id', 'users'],
  supplier_payments: ['purchase_id', 'purchases'],
  tab_items: ['tab_id', 'tabs'],
  ticket_messages: ['ticket_id', 'tickets'],
  trusted_devices: ['user_id', 'users'],
  verification_codes: ['user_id', 'users'],
}

const tablesOf = (db: Db) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '!_!_%' ESCAPE '!' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
const hasBusinessId = (db: Db, t: string) => (db.pragma(`table_info("${t}")`) as { name: string }[]).some((c) => c.name === 'business_id')

/** Condición SQL (con su parámetro) que elige las filas de un negocio en una tabla. */
export function businessFilter(db: Db, table: string): string {
  if (table === 'businesses') return 'id = ?'
  if (hasBusinessId(db, table)) return 'business_id = ?'
  const o = OWNER[table]
  if (!o) throw new Error(`La tabla ${table} no está clasificada en src/partition.ts`)
  return `"${o[0]}" IN (SELECT id FROM "${o[1]}" WHERE ${businessFilter(db, o[1])})`
}

/** Tablas sin clasificar (debe ser vacío). */
export function unclassified(db: Db): string[] {
  return tablesOf(db).filter((t) => t !== 'businesses' && !(GLOBAL_TABLES as readonly string[]).includes(t) && !hasBusinessId(db, t) && !OWNER[t])
}

/** Todo lo de un negocio, con el mismo formato que un respaldo (se carga con importAll en una base vacía). */
export function exportBusiness(db: Db, businessId: string, opts: { withGlobals?: boolean } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const t of tablesOf(db)) {
    if ((GLOBAL_TABLES as readonly string[]).includes(t)) {
      // Las llaves del push (VAPID) y los ajustes generales se copian para que el negocio siga funcionando igual.
      if (opts.withGlobals && ['app_keys', 'settings'].includes(t)) tables[t] = db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]
      continue
    }
    const f = businessFilter(db, t)
    const n = (f.match(/\?/g) ?? []).length
    tables[t] = db.prepare(`SELECT * FROM "${t}" WHERE ${f}`).all(...Array(n).fill(businessId)) as Record<string, unknown>[]
  }
  return { version: (db.prepare('SELECT MAX(version) v FROM _migrations').get() as { v: number }).v, businessId, tables }
}
