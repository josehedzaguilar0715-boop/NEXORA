import type { Context, MiddlewareHandler } from 'hono'
import type { ZodType } from 'zod'
import type { Db } from './db.js'
import type { Permission } from './permissions.js'
import { bad, forbidden, unauthorized, iso, sha256, type Clock } from './util.js'

export interface Notifier {
  /** false = no hay proveedor de SMS: se entra solo con usuario y contraseña, y soporte da contraseñas temporales. */
  smsEnabled?: boolean
  /** false = no hay proveedor de correo. */
  mailEnabled?: boolean
  /** Envía un código por WhatsApp/SMS. En desarrollo solo se registra. */
  /** Devuelve false si no hay proveedor y el código solo quedó en el registro del servidor. */
  sendCode(phone: string, code: string): void | boolean | Promise<void | boolean>
  /** Correo (opcional): se usa para la verificación del super panel. */
  sendEmail?(to: string, subject: string, text: string, attachments?: { filename: string; content: string }[]): void | boolean | Promise<void | boolean>
}

/** ¿Se usan códigos por SMS? Sin proveedor, no (todo se maneja con usuario, contraseña y soporte). */
export const smsOn = (deps: { notifier: Notifier }) => deps.notifier.smsEnabled !== false

export interface Deps {
  db: Db
  notifier: Notifier
  /** Donde se guardan los respaldos automáticos (opcional). */
  backups?: import('./backup.js').BackupStore
  now: Clock
}

export interface UserRow {
  id: string
  business_id: string
  branch_id: string | null
  register_id: string | null
  role: 'owner' | 'staff'
  name: string
  username: string | null
  phone: string | null
  phone_verified: number
  password_hash: string
  must_change_password: number
  permissions: string
  auth_code_hash: string | null
  active: number
  failed_attempts: number
  locked_until: string | null
  auth_failed_attempts: number
  auth_locked_until: string | null
}

export interface Session {
  id: string
  user: UserRow
}

export type Env = { Variables: { deps: Deps; session: Session } }
export type C = Context<Env>

export const MAX_FAILED = 5
export const LOCK_MINUTES = 15

/** Permisos que tiene todo usuario y no se pueden quitar: ver reportes (solo lectura, sin modificar nada). */
export const ALWAYS_GRANTED: Permission[] = ['view_reports']

/**
 * Dueño o encargado (quien puede autorizar cancelaciones y descuentos). Ya no se usa "ver reportes" para esto,
 * porque ahora todos lo tienen.
 */
export function isManager(u: UserRow): boolean {
  return u.role === 'owner' || (JSON.parse(u.permissions) as string[]).includes('cancel_discount')
}

export function hasPerm(u: UserRow, p: Permission): boolean {
  return u.role === 'owner' || ALWAYS_GRANTED.includes(p) || (JSON.parse(u.permissions) as string[]).includes(p)
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data)
  if (!r.success) {
    const first = r.error.issues[0]
    throw bad(`Dato no válido${first?.path.length ? ` (${first.path.join('.')})` : ''}: ${first?.message ?? ''}`)
  }
  return r.data
}

export async function body(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    throw bad('El cuerpo de la solicitud no es JSON válido.')
  }
}

export const requirePerm = (p: Permission): MiddlewareHandler<Env> => async (c, next) => {
  if (!hasPerm(c.get('session').user, p)) throw forbidden()
  await next()
}

export const ownerOnly: MiddlewareHandler<Env> = async (c, next) => {
  if (c.get('session').user.role !== 'owner') throw forbidden('Solo el dueño puede hacer esto.')
  await next()
}

/** Rutas permitidas aunque el usuario deba cambiar su contraseña. */
const PASSWORD_CHANGE_OK = ['/auth/change-password', '/auth/logout', '/auth/me']

export const authenticate: MiddlewareHandler<Env> = async (c, next) => {
  const { db, now } = c.get('deps')
  const h = c.req.header('authorization') ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) throw unauthorized()
  const s = db
    .prepare('SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?')
    .get(sha256(token)) as { id: string; user_id: string; expires_at: string; revoked_at: string | null } | undefined
  if (!s || s.revoked_at || s.expires_at <= iso(now())) throw unauthorized()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id) as UserRow
  if (!user.active) throw unauthorized('Tu usuario está desactivado.')
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(iso(now()), s.id)
  // Con o sin el prefijo /api (el servidor local lo conserva; en la nube se quita antes).
  if (user.must_change_password && !PASSWORD_CHANGE_OK.includes(new URL(c.req.url).pathname.replace(/^\/api(?=\/)/, ''))) {
    throw forbidden('Debes cambiar tu contraseña antes de continuar.')
  }
  c.set('session', { id: s.id, user })
  await next()
}
