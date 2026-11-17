import { createMiddleware } from 'hono/factory'
import type { Env } from './context.js'
import type { Db } from './db.js'
import { audit } from './audit.js'
import { AppError, iso, type Clock } from './util.js'

/** Planes v1 (2026-11-16). Importes en centavos MXN, al mes, sin IVA. */
export const PLANS = {
  inicial: { label: 'Inicial', price: 50000, users: 3 },
  crecimiento: { label: 'Crecimiento', price: 70000, users: 5 },
  profesional: { label: 'Profesional', price: 90000, users: 10 },
} as const
export type Plan = keyof typeof PLANS
export const PLAN_KEYS = Object.keys(PLANS) as [Plan, ...Plan[]]
export const EXTRA_BRANCH_PRICE = 30000
export const USER_PACK_PRICE = 20000
export const USER_PACK_SIZE = 5

export interface PlanConfig { plan: Plan; extraBranches: number; extraUserPacks: number }

export function monthlyFee(p: PlanConfig): number {
  return PLANS[p.plan].price + p.extraBranches * EXTRA_BRANCH_PRICE + p.extraUserPacks * USER_PACK_PRICE
}
export const limits = (p: PlanConfig) => ({ users: PLANS[p.plan].users + p.extraUserPacks * USER_PACK_SIZE, branches: 1 + p.extraBranches })

export interface BusinessRow {
  id: string; code: string; name: string; phone: string | null; status: 'prueba' | 'activo' | 'vencido' | 'suspendido'
  trial_days: number | null; trial_ends_at: string | null; paid_until: string | null; overdue_since: string | null
  suspended_reason: string | null; plan: Plan; extra_branches: number; extra_user_packs: number; pending_plan: string | null; created_at: string
}

export function setting(db: Db, key: string): number {
  return Number((db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string }).value)
}

/**
 * Estado vigente del negocio. Al terminar la prueba sin pago o al vencer la mensualidad pasa a
 * Vencido (sin acceso a operar, datos intactos). Suspendido solo lo decide el super panel.
 */
export function refreshStatus(db: Db, now: Clock, businessId: string): BusinessRow {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as BusinessRow
  const t = iso(now())
  const endsAt = b.status === 'prueba' ? b.trial_ends_at : b.status === 'activo' ? b.paid_until : null
  if (endsAt && endsAt <= t) {
    db.prepare("UPDATE businesses SET status = 'vencido', overdue_since = ? WHERE id = ?").run(endsAt, b.id)
    audit(db, now, { businessId: b.id, userId: null, action: 'negocio.vencido', entity: 'business', entityId: b.id, oldValue: { status: b.status }, newValue: { status: 'vencido', desde: endsAt } })
    return db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as BusinessRow
  }
  return b
}

/**
 * Aplica límites del plan sin borrar nada: los usuarios y sucursales sobrantes (los más nuevos)
 * quedan desactivados.
 */
export function enforceLimits(db: Db, now: Clock, businessId: string, actorNote: string) {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as BusinessRow
  const lim = limits({ plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs })
  const active = db.prepare("SELECT id FROM users WHERE business_id = ? AND active = 1 ORDER BY role = 'owner' DESC, created_at, rowid").all(businessId) as { id: string }[]
  const extraUsers = active.slice(lim.users).map((u) => u.id)
  const branches = db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1 ORDER BY created_at, rowid').all(businessId) as { id: string }[]
  const extraBranches = branches.slice(lim.branches).map((r) => r.id)
  for (const id of extraUsers) {
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id)
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), id)
  }
  for (const id of extraBranches) db.prepare('UPDATE branches SET active = 0 WHERE id = ?').run(id)
  if (extraUsers.length || extraBranches.length) {
    audit(db, now, { businessId, userId: null, action: 'plan.limites_aplicados', entity: 'business', entityId: businessId, newValue: { usuariosDesactivados: extraUsers, sucursalesDesactivadas: extraBranches }, reason: actorNote })
  }
}

export const GIROS = ['abarrotes', 'ferreteria', 'papeleria', 'barberia', 'unas', 'perfumeria', 'banos', 'turistico', 'palapa', 'restaurante', 'comedor', 'taqueria', 'verduleria'] as const

export const BLOCKED_CODE = 'cuenta_vencida'
/** Lo que un negocio vencido o suspendido aún puede usar: entrar, ver su estado y escribir al buzón. */
const ALLOWED_WHEN_BLOCKED = [/^\/auth\//, /^\/support\//]

export const businessGate = createMiddleware<Env>(async (c, next) => {
  const { db, now } = c.get('deps')
  const b = refreshStatus(db, now, c.get('session').user.business_id)
  if ((b.status === 'vencido' || b.status === 'suspendido') && !ALLOWED_WHEN_BLOCKED.some((r) => r.test(new URL(c.req.url).pathname))) {
    throw new AppError(
      402,
      BLOCKED_CODE,
      b.status === 'vencido'
        ? 'Tu cuenta está vencida. Tus datos están intactos; al pagar vuelves a operar.'
        : 'Tu cuenta está suspendida. Tus datos están intactos; escríbenos al buzón para reactivarla.',
    )
  }
  await next()
})
