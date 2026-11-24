import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { GIROS, limits, type BusinessRow } from './billing.js'
import { body, hasPerm, type C, ownerOnly, parse, puestoOf, requirePerm, type Env, type UserRow } from './context.js'
import { PERMISSIONS, PERMISSION_KEYS, TEMPLATES, type Permission } from './permissions.js'
import { scopeOwn } from './scope.js'
import { bad, checkPassword, conflict, forbidden, hashSecret, iso, newId, normalizeUsername, notFound, verifySecret } from './util.js'

export const users = new Hono<Env>()

function ensureUserSlot(db: import('./db.js').Db, businessId: string) {
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as BusinessRow
  const max = limits({ plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs }).users
  const n = (db.prepare('SELECT COUNT(*) n FROM users WHERE business_id = ? AND active = 1').get(businessId) as { n: number }).n
  if (n >= max) throw conflict(`Tu plan incluye ${max} usuarios activos. Desactiva uno o pide un paquete de usuarios extra desde el buzón.`, 'limite_usuarios')
}

const perms = z.array(z.enum(PERMISSION_KEYS))

const publicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  role: u.role,
  branchId: u.branch_id,
  /** dueno | encargado | empleado */
  position: puestoOf(u),
  active: !!u.active,
  permissions: u.role === 'owner' ? 'todos' : JSON.parse(u.permissions),
  hasAuthCode: !!u.auth_code_hash,
  mustChangePassword: !!u.must_change_password,
})

users.get('/permissions', (c) =>
  c.json({
    permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })),
    templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, position: t.position, permissions: t.permissions })),
  }),
)

users.get('/users', requirePerm('create_employees'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  // El dueño ve a todos; quien no es dueño solo al personal de su sucursal (no al dueño).
  const rows = (u.role === 'owner'
    ? db.prepare('SELECT * FROM users WHERE business_id = ? ORDER BY role DESC, name').all(u.business_id)
    : db.prepare("SELECT * FROM users WHERE business_id = ? AND role = 'staff' AND branch_id = ? ORDER BY name").all(u.business_id, u.branch_id)) as UserRow[]
  return c.json({ users: rows.map(publicUser) })
})

/** Para «¿Quién atendió?» en la caja: solo nombre del personal activo (sin datos sensibles). */
users.get('/staff/sellers', requirePerm('sell'), (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  const staff = u.role === 'owner'
    ? db.prepare('SELECT id, name FROM users WHERE business_id = ? AND active = 1 ORDER BY role DESC, name').all(u.business_id)
    : db.prepare('SELECT id, name FROM users WHERE business_id = ? AND active = 1 AND branch_id = ? ORDER BY role DESC, name').all(u.business_id, u.branch_id)
  return c.json({ staff })
})

users.post('/users', requirePerm('create_employees'), async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const actor = c.get('session').user
  const d = parse(
    z.object({
      name: z.string().trim().min(2).max(100),
      username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}._-]+$/u, 'solo letras, números, punto, guion'),
      password: z.string(),
      template: z.string().optional(),
      permissions: perms.optional(),
      branchId: z.string().optional(),
      position: z.enum(['encargado', 'empleado']).optional(),
    }),
    await body(c),
  )
  checkPassword(d.password)
  ensureUserSlot(db, actor.business_id)
  const tpl = d.template ? TEMPLATES[d.template] : undefined
  if (d.template && !tpl) throw bad('Esa plantilla no existe.')
  const granted = [...new Set<Permission>(d.permissions ?? tpl?.permissions ?? [])]
  const position = d.position ?? tpl?.position ?? 'empleado'
  // Solo el dueño nombra encargados: un encargado crea empleados de su sucursal.
  if (position === 'encargado' && actor.role !== 'owner') throw forbidden('Solo el dueño puede nombrar encargados.')
  // Quien no es dueño solo puede dar permisos que él mismo tiene.
  for (const p of granted) if (!hasPerm(actor, p)) throw forbidden('No puedes dar un permiso que tú no tienes.')
  const branchId = d.branchId ?? actor.branch_id
  if (d.branchId && !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ? AND active = 1').get(d.branchId, actor.business_id)) throw bad('Esa sucursal no existe.')
  const username = normalizeUsername(d.username)
  // Los empleados entran solo con usuario y contraseña: el usuario no se puede repetir en todo NEXORA.
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw conflict(`El usuario "${username}" ya lo usa otra persona. Prueba con otro, por ejemplo "${username}.${(db.prepare('SELECT name FROM businesses WHERE id = ?').get(actor.business_id) as { name: string }).name.split(/\s+/).pop()!.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').slice(0, 10) || '2'}".`, 'usuario_repetido')
  const biz = db.prepare('SELECT force_password_change FROM businesses WHERE id = ?').get(actor.business_id) as { force_password_change: number }
  const id = newId()
  db.prepare(
    "INSERT INTO users (id, business_id, branch_id, role, name, username, password_hash, must_change_password, permissions, position, created_at) VALUES (?,?,?,'staff',?,?,?,?,?,?,?)",
  ).run(id, actor.business_id, branchId, d.name, username, hashSecret(d.password), biz.force_password_change, JSON.stringify(granted), position, iso(now()))
  audit(db, now, { businessId: actor.business_id, userId: actor.id, action: 'usuario.alta', entity: 'user', entityId: id, newValue: { name: d.name, username, position, branchId, permissions: granted } })
  return c.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow) }, 201)
})

function targetUser(c: C): UserRow {
  const { db } = c.get('deps')
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as UserRow | undefined
  if (!u) throw notFound('No se encontró ese usuario.')
  return u
}

users.patch('/users/:id', requirePerm('create_employees'), async (c) => {
  const { db, now } = c.get('deps')
  const actor = c.get('session').user
  const target = targetUser(c)
  if (target.role === 'owner') throw forbidden('No se puede editar al dueño aquí.')
  if (target.id === actor.id && actor.role !== 'owner') throw forbidden('No puedes cambiar tus propios permisos.')
  // Un encargado solo administra empleados (no a otros encargados) y solo de su sucursal (la sucursal ya la revisa el control central).
  if (actor.role !== 'owner' && puestoOf(target) !== 'empleado') throw forbidden('Solo el dueño administra a los encargados.')
  const d = parse(
    z.object({ name: z.string().trim().min(2).max(100).optional(), permissions: perms.optional(), active: z.boolean().optional(), branchId: z.string().optional(), position: z.enum(['encargado', 'empleado']).optional() }),
    await body(c),
  )
  if (d.position && actor.role !== 'owner') throw forbidden('Solo el dueño cambia el puesto de una persona.')
  const old = publicUser(target)
  if (d.active === true && !target.active) ensureUserSlot(db, actor.business_id)
  const granted = d.permissions ? [...new Set<Permission>(d.permissions)] : undefined
  if (granted) for (const p of granted) if (!hasPerm(actor, p)) throw forbidden('No puedes dar un permiso que tú no tienes.')
  if (d.branchId && !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(d.branchId, actor.business_id)) throw bad('Esa sucursal no existe.')
  db.prepare('UPDATE users SET name = ?, permissions = ?, active = ?, branch_id = ?, position = ? WHERE id = ?').run(
    d.name ?? target.name,
    granted ? JSON.stringify(granted) : target.permissions,
    d.active === undefined ? target.active : d.active ? 1 : 0,
    d.branchId ?? target.branch_id,
    d.position ?? target.position,
    target.id,
  )
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as UserRow
  if (d.active === false) db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), target.id)
  audit(db, now, { businessId: actor.business_id, userId: actor.id, action: 'usuario.cambio', entity: 'user', entityId: target.id, oldValue: old, newValue: publicUser(fresh) })
  return c.json({ user: publicUser(fresh) })
})

// El dueño (o quien tenga permiso) restablece la contraseña de un empleado.
users.post('/users/:id/reset-password', requirePerm('create_employees'), async (c) => {
  const { db, now } = c.get('deps')
  const actor = c.get('session').user
  const target = targetUser(c)
  if (target.role === 'owner') throw forbidden('La contraseña del dueño se recupera con su teléfono.')
  if (actor.role !== 'owner' && puestoOf(target) !== 'empleado') throw forbidden('Solo el dueño restablece la contraseña de un encargado.')
  const d = parse(z.object({ newPassword: z.string() }), await body(c))
  checkPassword(d.newPassword)
  const biz = db.prepare('SELECT force_password_change FROM businesses WHERE id = ?').get(actor.business_id) as { force_password_change: number }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashSecret(d.newPassword), biz.force_password_change, target.id)
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), target.id)
  audit(db, now, { businessId: actor.business_id, userId: actor.id, action: 'usuario.restablecer_contrasena', entity: 'user', entityId: target.id })
  return c.json({ ok: true })
})

// Cerrar todas las sesiones de un usuario (dueño).
users.delete('/users/:id/sessions', ownerOnly, (c) => {
  const { db, now } = c.get('deps')
  const actor = c.get('session').user
  const target = targetUser(c)
  const r = db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), target.id)
  audit(db, now, { businessId: actor.business_id, userId: actor.id, action: 'usuario.cerrar_sesiones', entity: 'user', entityId: target.id, newValue: { cerradas: r.changes } })
  return c.json({ closed: r.changes })
})

// Código de autorización: lo asigna solo el dueño, a sí mismo o a quien decida.
users.put('/users/:id/auth-code', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const actor = c.get('session').user
  const target = targetUser(c)
  const d = parse(z.object({ code: z.string().min(4, 'mínimo 4 caracteres').max(20) }), await body(c))
  const others = db.prepare('SELECT * FROM users WHERE business_id = ? AND id != ? AND auth_code_hash IS NOT NULL').all(actor.business_id, target.id) as UserRow[]
  if (others.some((u) => verifySecret(d.code, u.auth_code_hash))) throw conflict('Ese código ya lo usa otra persona. Elige uno distinto.', 'codigo_repetido')
  if (verifySecret(d.code, target.password_hash)) throw bad('El código de autorización debe ser distinto a la contraseña.')
  db.prepare('UPDATE users SET auth_code_hash = ?, auth_failed_attempts = 0, auth_locked_until = NULL WHERE id = ?').run(hashSecret(d.code), target.id)
  audit(db, now, { businessId: actor.business_id, userId: actor.id, action: 'usuario.codigo_asignado', entity: 'user', entityId: target.id })
  return c.json({ ok: true })
})

// Datos del negocio: nombre, teléfono del ticket, logo y paso de cambio de contraseña.
users.patch('/business', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const actor = c.get('session').user
  const d = parse(
    z.object({
      name: z.string().trim().min(2).max(100).optional(),
      phone: z.string().trim().max(30).optional(),
      logoUrl: z.string().url().max(500).nullable().optional(),
      forcePasswordChange: z.boolean().optional(),
    }),
    await body(c),
  )
  const old = db.prepare('SELECT name, phone, logo_url AS logoUrl, force_password_change AS forcePasswordChange, giro, extra_giros AS extraGiros FROM businesses WHERE id = ?').get(actor.business_id) as Record<string, unknown>
  // El giro y los giros adicionales se eligen al crear el negocio; después solo los cambia soporte.
  db.prepare('UPDATE businesses SET name = ?, phone = ?, logo_url = ?, force_password_change = ? WHERE id = ?').run(
    d.name ?? old.name,
    d.phone ?? old.phone,
    d.logoUrl === undefined ? old.logoUrl : d.logoUrl,
    d.forcePasswordChange === undefined ? old.forcePasswordChange : d.forcePasswordChange ? 1 : 0,
    actor.business_id,
  )
  const fresh = db.prepare('SELECT name, phone, logo_url AS logoUrl, force_password_change AS forcePasswordChange, giro, extra_giros AS extraGiros FROM businesses WHERE id = ?').get(actor.business_id)
  audit(db, now, { businessId: actor.business_id, userId: actor.id, action: 'negocio.cambio', entity: 'business', entityId: actor.business_id, oldValue: old, newValue: fresh })
  return c.json({ business: fresh })
})

users.get('/audit', requirePerm('view_reports'), (c) => {
  const { db } = c.get('deps')
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500)
  const u = c.get('session').user
  // Dueño: toda la bitácora. Los demás: solo lo que hicieron las personas de su sucursal (y, si no ven lo de otros, solo lo suyo).
  const rows = (u.role === 'owner'
    ? db.prepare('SELECT * FROM audit_log WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(u.business_id, limit)
    : db.prepare(`SELECT a.* FROM audit_log a JOIN users w ON w.id = a.user_id WHERE a.business_id = ? AND w.branch_id = ? AND w.role = 'staff' ${scopeOwn(c) ? 'AND a.user_id = ?' : ''} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`).all(u.business_id, u.branch_id, ...(scopeOwn(c) ? [u.id] : []), limit))
  return c.json({ entries: rows })
})
