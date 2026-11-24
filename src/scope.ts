import type { MiddlewareHandler } from 'hono'
import { hasPerm, isManager, type C, type Env, type UserRow } from './context.js'
import type { Db } from './db.js'
import { AppError } from './util.js'

/**
 * Alcance de cada puesto (decisión del propietario, 24 nov 2026; no cambiar sin consultarlo):
 *
 *  · DUEÑO     → todas las sucursales y toda la información del negocio.
 *  · ENCARGADO → solo su sucursal, con los permisos operativos que el dueño le haya dado.
 *  · EMPLEADO  → solo lo propio (sus ventas, su caja y sus actividades) con los permisos que el dueño le haya dado.
 *                No ve las ventas privadas de otros empleados.
 *
 * El control está AQUÍ, en el servidor, y corre antes de cualquier ruta: esconder botones en pantalla no protege nada.
 * Los usuarios no pueden saltárselo cambiando `branchId` ni identificadores en la petición.
 */

const otraSucursal = () => new AppError(403, 'otra_sucursal', 'No tienes acceso a la información de otra sucursal.')
const noEsTuyo = () => new AppError(403, 'no_es_tuyo', 'Solo puedes consultar tus propias operaciones.')

/** Quien ve lo de otros empleados: dueño, encargado, o un empleado a quien el dueño le dio «ver reportes». */
export const seesOthers = (u: UserRow) => isManager(u) || hasPerm(u, 'view_reports')

/**
 * Sucursal a la que se limitan las consultas de este usuario.
 *  · dueño → undefined (todas; puede pedir una con ?branchId=).
 *  · los demás → la suya (si no tiene sucursal asignada, ninguna: nada coincide).
 */
export function scopeBranch(c: C): string | undefined {
  const u = c.get('session').user
  if (u.role === 'owner') return c.req.query('branchId') || undefined
  return u.branch_id ?? '(sin sucursal)'
}

/** Id del empleado al que se limitan las consultas de operaciones (ventas, turnos); undefined = no se limita. */
export function scopeOwn(c: C): string | undefined {
  const u = c.get('session').user
  return seesOthers(u) ? undefined : u.id
}

/** El negocio tiene más de una sucursal (si no, «su sucursal» y «el negocio» son lo mismo). */
export const isMultiBranch = (db: Db, businessId: string) => (db.prepare('SELECT COUNT(*) n FROM branches WHERE business_id = ?').get(businessId) as { n: number }).n > 1

/**
 * Información que mezcla todas las sucursales y no se puede separar (estados financieros, balance, libro de dinero…):
 * dueño siempre; los demás solo si el negocio tiene una sola sucursal (ahí todo es de su sucursal).
 */
export const wholeBusinessOnly: MiddlewareHandler<Env> = async (c, next) => {
  const u = c.get('session').user
  if (u.role !== 'owner' && isMultiBranch(c.get('deps').db, u.business_id)) throw new AppError(403, 'solo_dueno', 'Esta información junta todas las sucursales: solo la ve el dueño.')
  await next()
}

// ---------------------------------------------------------------------------------------------------------------
// Control central por identificador: ¿ese registro es de mi sucursal (y, si soy empleado, es mío)?
// ---------------------------------------------------------------------------------------------------------------

/** `branch` y `own` reciben (id, business_id) y devuelven una fila con `v` (la sucursal / el dueño del registro). */
interface Rule { branch: string; own?: string }

const R: Record<string, Rule> = {
  appointments: { branch: 'SELECT branch_id v FROM appointments WHERE id = ? AND business_id = ?' },
  accesses: { branch: 'SELECT branch_id v FROM accesses WHERE id = ? AND business_id = ?' },
  expenses: { branch: 'SELECT branch_id v FROM expenses WHERE id = ? AND business_id = ?' },
  layaways: { branch: 'SELECT branch_id v FROM layaways WHERE id = ? AND business_id = ?' },
  machines: { branch: 'SELECT branch_id v FROM machines WHERE id = ? AND business_id = ?' },
  meat: { branch: 'SELECT branch_id v FROM meat_batches WHERE id = ? AND business_id = ?' },
  purchases: { branch: 'SELECT branch_id v FROM purchases WHERE id = ? AND business_id = ?' },
  quotes: { branch: 'SELECT branch_id v FROM quotes WHERE id = ? AND business_id = ?' },
  sales: { branch: 'SELECT branch_id v FROM sales WHERE id = ? AND business_id = ?', own: 'SELECT cashier_id v FROM sales WHERE id = ? AND business_id = ?' },
  shifts: { branch: 'SELECT branch_id v FROM shifts WHERE id = ? AND business_id = ?', own: 'SELECT cashier_id v FROM shifts WHERE id = ? AND business_id = ?' },
  tabs: { branch: 'SELECT branch_id v FROM tabs WHERE id = ? AND business_id = ?' },
  tables: { branch: 'SELECT branch_id v FROM dining_tables WHERE id = ? AND business_id = ?' },
  registers: { branch: 'SELECT branch_id v FROM registers WHERE id = ? AND business_id = ?' },
  users: { branch: 'SELECT branch_id v FROM users WHERE id = ? AND business_id = ?' },
  tabItems: { branch: 'SELECT t.branch_id v FROM tab_items i JOIN tabs t ON t.id = i.tab_id WHERE i.id = ? AND t.business_id = ?' },
  tableReservations: { branch: 'SELECT d.branch_id v FROM table_reservations r JOIN dining_tables d ON d.id = r.table_id WHERE r.id = ? AND r.business_id = ?' },
  rentals: { branch: 'SELECT t.branch_id v FROM asset_rentals r JOIN tabs t ON t.id = r.tab_id WHERE r.id = ? AND t.business_id = ?' },
  comandas: { branch: 'SELECT t.branch_id v FROM comandas c JOIN tabs t ON t.id = c.tab_id WHERE c.id = ? AND c.business_id = ?' },
  // Encargos: la sucursal es la de quien los capturó.
  orders: { branch: 'SELECT u.branch_id v FROM orders o JOIN users u ON u.id = o.created_by WHERE o.id = ? AND o.business_id = ?', own: 'SELECT created_by v FROM orders WHERE id = ? AND business_id = ?' },
  // Abono de fiado: la sucursal es la de la caja donde se recibió (si no hubo caja, es del negocio).
  creditLedger: { branch: 'SELECT s.branch_id v FROM credit_ledger l JOIN shifts s ON s.id = l.shift_id WHERE l.id = ? AND l.business_id = ?' },
}

/** Rutas con el identificador en la dirección: /sales/:id, /shifts/:id/close… */
const PATHS: [RegExp, Rule][] = [
  [/^\/appointments\/([^/]+)/, R.appointments!],
  [/^\/baths\/accesses\/([^/]+)/, R.accesses!],
  [/^\/expenses\/([^/]+)/, R.expenses!],
  [/^\/layaways\/([^/]+)/, R.layaways!],
  [/^\/machines\/([^/]+)/, R.machines!],
  [/^\/meat\/batches\/([^/]+)/, R.meat!],
  [/^\/purchases\/([^/]+)/, R.purchases!],
  [/^\/quotes\/([^/]+)/, R.quotes!],
  [/^\/sales\/(?!folio\/)([^/]+)/, R.sales!],
  [/^\/shifts\/([^/]+)/, R.shifts!],
  [/^\/tab-items\/([^/]+)/, R.tabItems!],
  [/^\/tabs\/([^/]+)/, R.tabs!],
  [/^\/tables\/([^/]+)/, R.tables!],
  [/^\/table-reservations\/([^/]+)/, R.tableReservations!],
  [/^\/rentals\/([^/]+)/, R.rentals!],
  [/^\/comandas\/([^/]+)/, R.comandas!],
  [/^\/orders\/([^/]+)/, R.orders!],
  [/^\/users\/([^/]+)/, R.users!],
  [/^\/staff\/([^/]+)/, R.users!],
  [/^\/credit-ledger\/([^/]+)/, R.creditLedger!],
]

/** Identificadores que vienen en el cuerpo o en la dirección (?shiftId=…): se revisan igual que los de la ruta. */
const KEYS: Record<string, Rule> = {
  shiftId: R.shifts!, saleId: R.sales!, tableId: R.tables!, registerId: R.registers!, tabId: R.tabs!,
  purchaseId: R.purchases!, layawayId: R.layaways!, appointmentId: R.appointments!, orderId: R.orders!,
  // Personas: un encargado solo trabaja con gente de su sucursal.
  staffId: R.users!, userId: R.users!, cashierId: R.users!,
}
const BRANCH_KEYS = ['branchId', 'fromBranch', 'toBranch', 'fromBranchId', 'toBranchId']

function check(db: Db, u: UserRow, rule: Rule, id: unknown, opts: { person?: boolean } = {}) {
  if (typeof id !== 'string' || !id) return
  const mine = u.branch_id
  const row = db.prepare(rule.branch).get(id, u.business_id) as { v: string | null } | undefined
  // No existe (o es de otro negocio): la ruta responde 404 como siempre.
  if (!row) return
  // Un registro sin sucursal (p. ej. el dueño) o de otra sucursal no es de este usuario.
  if (row.v !== mine) throw otraSucursal()
  if (seesOthers(u)) return
  if (opts.person) {
    // Un empleado, al elegir una persona (cashierId=…), solo puede elegirse a sí mismo.
    if (id !== u.id) throw noEsTuyo()
    return
  }
  if (!rule.own) return
  const o = db.prepare(rule.own).get(id, u.business_id) as { v: string | null } | undefined
  if (o && o.v !== u.id) throw noEsTuyo()
}

/**
 * Control central: corre en cada petición de un usuario que no es el dueño, antes de la ruta.
 *  1. branchId / fromBranch / toBranch (dirección o cuerpo) distinto de la sucursal del usuario → 403.
 *  2. Registros de otra sucursal, por la ruta, la dirección o el cuerpo → 403.
 *  3. Empleado sin «ver reportes»: registros de otro empleado (ventas, turnos, encargos) → 403.
 */
export const scopeGuard: MiddlewareHandler<Env> = async (c, next) => {
  const u = c.get('session').user
  if (u.role === 'owner') return next()
  const { db } = c.get('deps')
  const path = c.req.path.replace(/^\/api(?=\/)/, '')

  // 1) Sucursales pedidas.
  const q = c.req.query()
  const bodyObj = await readJson(c)
  const sources: Record<string, unknown>[] = [q, bodyObj]
  for (const src of sources) for (const k of BRANCH_KEYS) {
    const v = src[k]
    if (typeof v === 'string' && v && v !== u.branch_id) throw otraSucursal()
  }

  // 2 y 3) Registros por la ruta.
  for (const [re, rule] of PATHS) {
    const m = path.match(re)
    if (m) { check(db, u, rule, m[1]); break }
  }
  // …y por la dirección o el cuerpo.
  for (const src of sources) for (const [k, rule] of Object.entries(KEYS)) {
    // Solo «cashierId» (filtrar por una persona) obliga al empleado a elegirse a sí mismo; staffId/userId solo piden misma sucursal.
    if (src[k] !== undefined) check(db, u, rule, src[k], { person: k === 'cashierId' })
  }
  await next()
}

/** Cuerpo JSON de la petición (Hono lo guarda: la ruta lo vuelve a leer sin problema). */
async function readJson(c: C): Promise<Record<string, unknown>> {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return {}
  if (!(c.req.header('content-type') ?? '').includes('json')) return {}
  try {
    const j = await c.req.json()
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

