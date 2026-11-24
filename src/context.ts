import type { Context, MiddlewareHandler } from 'hono'
import type { ZodType } from 'zod'
import type { Db } from './db.js'
import { FINANCE_PERMS, type Permission } from './permissions.js'
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
  /** Llave (base64, 32 bytes) para cifrar los respaldos. Secreto BACKUP_KEY; sin ella se guardan solo comprimidos. */
  backupKey?: string
  /** Tamaño de la base en bytes (en Cloudflare: storage.sql.databaseSize). */
  dbSize?: () => number
  now: Clock
  /** Mantiene vivo el trabajo en segundo plano (push) después de responder; en Cloudflare es waitUntil. */
  defer?: (p: Promise<unknown>) => void
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
  /** 'encargado' | 'empleado' (null = se deduce de los permisos). El dueño es role = 'owner'. */
  position: string | null
  /** 1 = Administrador autorizado: ve todo el negocio, pero solo con las funciones que el dueño le marcó. */
  admin_authorized?: number
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

/**
 * Ningún permiso es «gratis»: cada uno lo autoriza el dueño (antes todos podían ver reportes).
 * El dueño tiene todos; el personal solo los que tenga marcados.
 */
export function hasPerm(u: UserRow, p: Permission): boolean {
  if (u.role === 'owner') return true
  // Funciones financieras nuevas: solo las puede tener un Administrador autorizado (y solo si el dueño se las marcó).
  // Un empleado o un encargado nunca las tiene, aunque aparezcan guardadas.
  if (FINANCE_PERMS.includes(p) && puestoOf(u) !== 'administrador') return false
  // Un empleado anterior al sistema de puestos (sin puesto guardado) no conserva «ver reportes» de antes: ampliaría su alcance.
  // El dueño debe autorizarlo de nuevo (al guardar sus permisos queda registrado su puesto).
  if (p === 'view_reports' && u.position == null && puestoOf(u) === 'empleado') return false
  return (JSON.parse(u.permissions) as string[]).includes(p)
}

/** Puesto: dueño (todo el negocio), administrador autorizado (todo el negocio, solo lo que se le marcó), encargado (su sucursal) o empleado (lo propio). */
export type Puesto = 'dueno' | 'administrador' | 'encargado' | 'empleado'
export function puestoOf(u: UserRow): Puesto {
  if (u.role === 'owner') return 'dueno'
  if (u.admin_authorized) return 'administrador'
  if (u.position === 'encargado' || u.position === 'empleado') return u.position
  // Sin puesto guardado (usuarios anteriores): con «cancelar o descontar» es encargado, como siempre.
  return (JSON.parse(u.permissions) as string[]).includes('cancel_discount') ? 'encargado' : 'empleado'
}

/** Dueño o encargado: quien autoriza cancelaciones y descuentos y ve lo de todo su alcance (no solo lo propio). El administrador no lo es por serlo: solo hace lo que se le marcó. */
export function isManager(u: UserRow): boolean {
  const p = puestoOf(u)
  return p === 'dueno' || p === 'encargado'
}

/** Dueño o administrador autorizado: ven todas las sucursales (con las funciones que tengan). */
export const seesWholeBusiness = (u: UserRow) => u.role === 'owner' || puestoOf(u) === 'administrador'

export type FinanceKind = 'dashboard' | 'finance' | 'manage' | 'costs'
/**
 * Quién ve el panel general y lo financiero. Decisión del propietario (24 nov 2026, opción B): exclusivo del dueño y de
 * administradores expresamente autorizados. Ni el encargado ni el empleado, aunque tengan «ver reportes» guardado
 * (ese permiso solo sirve para ver las ventas de sus compañeros). Los costos de productos los ve quien compra y edita inventario.
 */
export function canFinance(u: UserRow, kind: FinanceKind): boolean {
  const p = puestoOf(u)
  if (p === 'dueno') return true
  if (p === 'administrador') return hasPerm(u, ({ dashboard: 'view_dashboard', finance: 'view_finance', manage: 'manage_finance', costs: 'view_costs' } as const)[kind])
  // Encargado y empleado: nada de finanzas; costos solo si compran/editan inventario (el encargado conserva lo que ya tenía en inventario).
  if (kind === 'costs') return p === 'encargado' ? hasPerm(u, 'view_inventory') || hasPerm(u, 'edit_inventory') : hasPerm(u, 'edit_inventory')
  return false
}

export const requireFinance = (kind: FinanceKind): MiddlewareHandler<Env> => async (c, next) => {
  if (!canFinance(c.get('session').user, kind)) throw forbidden('Esta información es solo del dueño y de quien él autorice.')
  await next()
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

/** Pide al menos uno de los permisos indicados. */
export const requirePerm = (...ps: Permission[]): MiddlewareHandler<Env> => async (c, next) => {
  if (!ps.some((p) => hasPerm(c.get('session').user, p))) throw forbidden()
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
