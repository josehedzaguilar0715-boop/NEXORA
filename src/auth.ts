import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { businessGiros, GIROS, setting } from './billing.js'
import { body, parse, LOCK_MINUTES, MAX_FAILED, smsOn, type Deps, type Env, type UserRow } from './context.js'
import {
  bad, businessCode, forbidden, checkPassword, conflict, hashSecret, iso, locked, newId, newToken, normalizePhone,
  normalizeUsername, notFound, numericCode, sha256, unauthorized, verifySecret,
} from './util.js'

const SESSION_DAYS = 30
const CODE_MINUTES = 10
const MAX_CODE_ATTEMPTS = 5
const BAD_CREDENTIALS = 'Datos incorrectos.'

const device = z.object({ deviceId: z.string().max(100).optional(), deviceName: z.string().max(100).optional() })

function createSession(deps: Deps, user: UserRow, dev: { deviceId?: string; deviceName?: string }) {
  const { db, now } = deps
  const token = newToken()
  const t = now()
  const id = newId()
  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, device_id, device_name, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, user.id, sha256(token), dev.deviceId ?? null, dev.deviceName ?? null, iso(t), iso(t), iso(new Date(t.getTime() + SESSION_DAYS * 86_400_000)))
  audit(db, now, { businessId: user.business_id, userId: user.id, action: 'sesion.inicio', entity: 'session', entityId: id, newValue: { device: dev.deviceName ?? dev.deviceId ?? null } })
  return { token, sessionId: id }
}

/** Si el último código de cada reto salió por SMS (false = solo quedó en el registro del servidor). */
const lastDelivery = new Map<string, boolean>()
export const wasDelivered = (challengeId: string) => { const v = lastDelivery.get(challengeId); lastDelivery.delete(challengeId); return v ?? true }

export type CodePurpose = 'registro' | 'login' | 'recuperar' | 'identidad'

export async function createChallenge(deps: Deps, user: UserRow, purpose: CodePurpose, dev: { deviceId?: string; deviceName?: string }) {
  const { db, now, notifier } = deps
  const code = numericCode(6)
  const id = newId()
  const t = now()
  db.prepare(
    'INSERT INTO verification_codes (id, user_id, purpose, code_hash, device_id, device_name, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(id, user.id, purpose, hashSecret(code), dev.deviceId ?? null, dev.deviceName ?? null, iso(new Date(t.getTime() + CODE_MINUTES * 60_000)), iso(t))
  const delivered = (await notifier.sendCode(user.phone!, code)) !== false
  lastDelivery.set(id, delivered)
  return id
}

export function consumeChallenge(deps: Deps, challengeId: string, code: string, purpose: CodePurpose) {
  const { db, now } = deps
  const ch = db.prepare('SELECT * FROM verification_codes WHERE id = ? AND purpose = ?').get(challengeId, purpose) as
    | { id: string; user_id: string; code_hash: string; device_id: string | null; device_name: string | null; attempts: number; expires_at: string; used_at: string | null }
    | undefined
  if (!ch || ch.used_at || ch.expires_at <= iso(now())) throw bad('El código venció. Pide uno nuevo.', 'codigo_vencido')
  if (ch.attempts >= MAX_CODE_ATTEMPTS) throw locked('Demasiados intentos. Pide un código nuevo.')
  if (!verifySecret(code, ch.code_hash)) {
    db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(ch.id)
    throw bad('Código incorrecto.', 'codigo_incorrecto')
  }
  db.prepare('UPDATE verification_codes SET used_at = ? WHERE id = ?').run(iso(now()), ch.id)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ch.user_id) as UserRow
  return { user, dev: { deviceId: ch.device_id ?? undefined, deviceName: ch.device_name ?? undefined } }
}

const TRUST_DAYS = 30
/** Marca el equipo como de confianza y devuelve la llave que guarda el equipo (solo se guarda su huella). */
function trustDevice(deps: Deps, user: UserRow, deviceName?: string) {
  const raw = newToken()
  const t = deps.now()
  deps.db.prepare('INSERT INTO trusted_devices (id, user_id, token_hash, device_name, created_at, last_used_at, expires_at) VALUES (?,?,?,?,?,?,?)').run(newId(), user.id, sha256(raw), deviceName ?? null, iso(t), iso(t), iso(new Date(t.getTime() + TRUST_DAYS * 86_400_000)))
  audit(deps.db, deps.now, { businessId: user.business_id, userId: user.id, action: 'sesion.equipo_confianza', newValue: { device: deviceName ?? null } })
  return raw
}

/** Olvida todos los equipos de confianza (al cambiar o recuperar la contraseña). */
export function forgetDevices(deps: Deps, userId: string) {
  deps.db.prepare('UPDATE trusted_devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(deps.now()), userId)
}

/** Verifica contraseña con bloqueo temporal tras varios intentos. */
function checkLogin(deps: Deps, user: UserRow | undefined, password: string): UserRow {
  const { db, now } = deps
  if (!user) {
    verifySecret(password, hashSecret('relleno')) // tiempo parecido si el usuario no existe
    throw unauthorized(BAD_CREDENTIALS)
  }
  if (user.locked_until && user.locked_until > iso(now())) {
    throw locked('Cuenta bloqueada temporalmente por varios intentos fallidos. Inténtalo más tarde.')
  }
  if (!user.active) throw unauthorized('Tu usuario está desactivado. Habla con el dueño.')
  if (!verifySecret(password, user.password_hash)) {
    const attempts = user.failed_attempts + 1
    const lock = attempts >= MAX_FAILED
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      lock ? 0 : attempts,
      lock ? iso(new Date(now().getTime() + LOCK_MINUTES * 60_000)) : null,
      user.id,
    )
    audit(db, now, { businessId: user.business_id, userId: user.id, action: lock ? 'login.bloqueo' : 'login.fallido' })
    throw unauthorized(BAD_CREDENTIALS)
  }
  if (user.failed_attempts || user.locked_until) db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id)
  return user
}

/** Giros adicionales sin repetir ni incluir el principal. */
export const extraOf = (giro: string, extra?: string[]) => JSON.stringify([...new Set(extra ?? [])].filter((g) => g !== giro))

export const publicAuth = new Hono<Env>()

publicAuth.post('/auth/register', async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const d = parse(
    z.object({ businessName: z.string().trim().min(2).max(100), ownerName: z.string().trim().min(2).max(100), phone: z.string(), password: z.string(), giro: z.enum(GIROS).optional(), extraGiros: z.array(z.enum(GIROS)).max(GIROS.length).optional() }).extend(device.shape),
    await body(c),
  )
  const phone = normalizePhone(d.phone)
  checkPassword(d.password)
  const existing = db.prepare("SELECT * FROM users WHERE role = 'owner' AND phone = ?").get(phone) as UserRow | undefined
  if (existing?.phone_verified) throw conflict('Ese teléfono ya tiene una cuenta. Inicia sesión.', 'telefono_registrado')

  let user: UserRow
  if (existing) {
    // Registro sin verificar: se reutiliza y se manda un código nuevo.
    db.prepare('UPDATE users SET name = ?, password_hash = ? WHERE id = ?').run(d.ownerName, hashSecret(d.password), existing.id)
    db.prepare('UPDATE businesses SET name = ?, giro = ?, extra_giros = ? WHERE id = ?').run(d.businessName, d.giro ?? 'abarrotes', extraOf(d.giro ?? 'abarrotes', d.extraGiros), existing.business_id)
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as UserRow
  } else {
    const t = iso(now())
    const bizId = newId()
    const branchId = newId()
    const userId = newId()
    db.transaction(() => {
      const trialDays = setting(db, 'default_trial_days')
      db.prepare('INSERT INTO businesses (id, code, name, phone, trial_days, trial_ends_at, giro, extra_giros, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
        bizId, businessCode(), d.businessName, phone, trialDays, iso(new Date(now().getTime() + trialDays * 86_400_000)), d.giro ?? 'abarrotes', extraOf(d.giro ?? 'abarrotes', d.extraGiros), t,
      )
      db.prepare('INSERT INTO branches (id, business_id, name, created_at) VALUES (?,?,?,?)').run(branchId, bizId, 'Principal', t)
      db.prepare(
        "INSERT INTO users (id, business_id, branch_id, role, name, phone, password_hash, created_at) VALUES (?,?,?,'owner',?,?,?,?)",
      ).run(userId, bizId, branchId, d.ownerName, phone, hashSecret(d.password), t)
      audit(db, now, { businessId: bizId, userId, action: 'negocio.alta', entity: 'business', entityId: bizId, newValue: { name: d.businessName } })
    })()
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow
  }
  // Sin SMS: la cuenta queda lista y entra de una vez con su teléfono y contraseña.
  if (!smsOn(deps)) {
    db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(user.id)
    const { token } = createSession(deps, user, d)
    const biz = db.prepare('SELECT id, code, name FROM businesses WHERE id = ?').get(user.business_id)
    return c.json({ token, business: biz }, 201)
  }
  const challengeId = await createChallenge(deps, user, 'registro', d)
  return c.json({ challengeId, delivered: wasDelivered(challengeId) }, 201)
})

publicAuth.post('/auth/register/verify', async (c) => {
  const deps = c.get('deps')
  const d = parse(z.object({ challengeId: z.string(), code: z.string(), rememberDevice: z.boolean().optional() }), await body(c))
  const { user, dev } = consumeChallenge(deps, d.challengeId, d.code, 'registro')
  deps.db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(user.id)
  const { token } = createSession(deps, user, dev)
  const biz = deps.db.prepare('SELECT id, code, name FROM businesses WHERE id = ?').get(user.business_id)
  return c.json({ token, business: biz, ...(d.rememberDevice ? { deviceTrust: trustDevice(deps, user, dev.deviceName) } : {}) })
})

// Dueño: teléfono + contraseña, y verificación en dos pasos.
publicAuth.post('/auth/owner/login', async (c) => {
  const deps = c.get('deps')
  const d = parse(z.object({ phone: z.string(), password: z.string(), deviceTrust: z.string().max(200).optional() }).extend(device.shape), await body(c))
  let phone: string
  try {
    phone = normalizePhone(d.phone)
  } catch {
    throw unauthorized(BAD_CREDENTIALS)
  }
  const user = deps.db.prepare("SELECT * FROM users WHERE role = 'owner' AND phone = ? AND phone_verified = 1").get(phone) as UserRow | undefined
  checkLogin(deps, user, d.password)
  if (!smsOn(deps)) {
    const { token } = createSession(deps, user!, d)
    return c.json({ token, mustChangePassword: !!user!.must_change_password })
  }
  // Equipo de confianza: ya verificó con SMS hace menos de 30 días; no se gasta otro mensaje.
  if (d.deviceTrust) {
    const t = deps.db.prepare('SELECT id FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?').get(sha256(d.deviceTrust), user!.id, iso(deps.now())) as { id: string } | undefined
    if (t) {
      deps.db.prepare('UPDATE trusted_devices SET last_used_at = ? WHERE id = ?').run(iso(deps.now()), t.id)
      const { token } = createSession(deps, user!, d)
      return c.json({ token, trusted: true, mustChangePassword: !!user!.must_change_password })
    }
  }
  const challengeId = await createChallenge(deps, user!, 'login', d)
  return c.json({ challengeId, delivered: wasDelivered(challengeId) })
})

publicAuth.post('/auth/owner/verify', async (c) => {
  const deps = c.get('deps')
  const d = parse(z.object({ challengeId: z.string(), code: z.string(), rememberDevice: z.boolean().optional() }), await body(c))
  const { user, dev } = consumeChallenge(deps, d.challengeId, d.code, 'login')
  const { token } = createSession(deps, user, dev)
  return c.json({ token, mustChangePassword: !!user.must_change_password, ...(d.rememberDevice ? { deviceTrust: trustDevice(deps, user, dev.deviceName) } : {}) })
})

// Dueño que olvidó su contraseña: la recupera con un código que llega a su teléfono.
publicAuth.post('/auth/owner/recover', async (c) => {
  const deps = c.get('deps')
  if (!smsOn(deps)) throw bad('Llama o escribe a soporte: te damos una contraseña temporal para entrar y luego la cambias.', 'recuperar_con_soporte')
  const d = parse(z.object({ phone: z.string() }), await body(c))
  let phone = ''
  try { phone = normalizePhone(d.phone) } catch { /* misma respuesta: no revela si el número existe */ }
  const user = phone ? (deps.db.prepare("SELECT * FROM users WHERE role = 'owner' AND phone = ? AND phone_verified = 1 AND active = 1").get(phone) as UserRow | undefined) : undefined
  if (!user) return c.json({ challengeId: newId() })
  return c.json({ challengeId: await createChallenge(deps, user, 'recuperar', {}) })
})

publicAuth.post('/auth/owner/recover/verify', async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const d = parse(z.object({ challengeId: z.string(), code: z.string(), newPassword: z.string() }), await body(c))
  checkPassword(d.newPassword)
  const { user } = consumeChallenge(deps, d.challengeId, d.code, 'recuperar')
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashSecret(d.newPassword), user.id)
  forgetDevices(deps, user.id)
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), user.id)
  audit(db, now, { businessId: user.business_id, userId: user.id, action: 'dueno.recupero_cuenta', entity: 'user', entityId: user.id })
  return c.json({ ok: true })
})

// Empleado: usuario + contraseña. El código del negocio ya no se pide; solo desempata usuarios
// antiguos que se repiten entre negocios (los nuevos son únicos en todo NEXORA).
publicAuth.post('/auth/login', async (c) => {
  const deps = c.get('deps')
  const { db } = deps
  const d = parse(z.object({ businessCode: z.string().optional(), username: z.string(), password: z.string() }).extend(device.shape), await body(c))
  const code = d.businessCode?.trim().toUpperCase()
  const candidates = db.prepare(`SELECT u.* FROM users u ${code ? 'JOIN businesses b ON b.id = u.business_id AND b.code = ?' : ''} WHERE u.username = ? AND u.role = 'staff'`)
    .all(...[...(code ? [code] : []), normalizeUsername(d.username)]) as UserRow[]
  // Con usuarios repetidos, entra el que tenga esa contraseña.
  const user = candidates.length > 1 ? (candidates.find((u) => verifySecret(d.password, u.password_hash)) ?? candidates[0]) : candidates[0]
  checkLogin(deps, user, d.password)
  const { token } = createSession(deps, user!, d)
  return c.json({ token, mustChangePassword: !!user!.must_change_password })
})

export const authed = new Hono<Env>()

authed.get('/auth/me', (c) => {
  const { user } = c.get('session')
  const { db } = c.get('deps')
  const biz = { ...(db.prepare('SELECT id, code, name, phone, logo_url, status, giro, trial_ends_at AS trialEndsAt, paid_until AS paidUntil FROM businesses WHERE id = ?').get(user.business_id) as object), giros: businessGiros(db, user.business_id) }
  const permissions = user.role === 'owner' ? 'todos' : JSON.parse(user.permissions)
  const settingsRows = db.prepare('SELECT key, value FROM business_settings WHERE business_id = ?').all(user.business_id) as { key: string; value: string }[]
  return c.json({
    settings: Object.fromEntries(settingsRows.map((r) => [r.key, JSON.parse(r.value)])),
    modules: JSON.parse((db.prepare('SELECT modules FROM businesses WHERE id = ?').get(user.business_id) as { modules: string }).modules),
    user: { id: user.id, name: user.name, username: user.username, phone: user.phone, role: user.role, branchId: user.branch_id, mustChangePassword: !!user.must_change_password },
    permissions,
    business: biz,
  })
})

authed.post('/auth/change-password', async (c) => {
  const { db, now } = c.get('deps')
  const { user } = c.get('session')
  const d = parse(z.object({ currentPassword: z.string(), newPassword: z.string() }), await body(c))
  if (!verifySecret(d.currentPassword, user.password_hash)) throw unauthorized('La contraseña actual no es correcta.')
  checkPassword(d.newPassword)
  if (d.currentPassword === d.newPassword) throw bad('La contraseña nueva debe ser distinta.')
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashSecret(d.newPassword), user.id)
  forgetDevices(c.get('deps'), user.id)
  audit(db, now, { businessId: user.business_id, userId: user.id, action: 'usuario.cambio_contrasena', entity: 'user', entityId: user.id })
  return c.json({ ok: true })
})

// El dueño cambia el teléfono con el que entra (confirma con su contraseña).
authed.post('/auth/owner/phone', async (c) => {
  const { db, now } = c.get('deps')
  const { user } = c.get('session')
  if (user.role !== 'owner') throw forbidden('Solo el dueño puede cambiar su teléfono.')
  const d = parse(z.object({ phone: z.string(), password: z.string() }), await body(c))
  if (!verifySecret(d.password, user.password_hash)) throw unauthorized('La contraseña no es correcta.')
  const phone = normalizePhone(d.phone)
  if (phone === user.phone) return c.json({ ok: true, phone })
  if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' AND phone = ? AND id <> ?").get(phone, user.id)) throw conflict('Ese teléfono ya tiene una cuenta.', 'telefono_registrado')
  db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?').run(phone, user.id)
  forgetDevices(c.get('deps'), user.id)
  audit(db, now, { businessId: user.business_id, userId: user.id, action: 'dueno.cambio_telefono', entity: 'user', entityId: user.id, oldValue: { phone: user.phone }, newValue: { phone } })
  return c.json({ ok: true, phone })
})

authed.post('/auth/logout', (c) => {
  const { db, now } = c.get('deps')
  const s = c.get('session')
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(iso(now()), s.id)
  return c.json({ ok: true })
})

// Dispositivos y sesiones propios; el dueño puede cerrar cualquiera de su cuenta.
authed.get('/auth/sessions', (c) => {
  const { db, now } = c.get('deps')
  const s = c.get('session')
  const rows = db
    .prepare(
      `SELECT id, device_id AS deviceId, device_name AS deviceName, created_at AS createdAt, last_seen_at AS lastSeenAt
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
    )
    .all(s.user.id, iso(now()))
  return c.json({ sessions: rows, current: s.id })
})

authed.get('/auth/trusted-devices', (c) => {
  const { db, now } = c.get('deps')
  const rows = db.prepare('SELECT id, device_name AS deviceName, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt FROM trusted_devices WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC').all(c.get('session').user.id, iso(now()))
  return c.json({ devices: rows })
})

authed.delete('/auth/trusted-devices/:id', (c) => {
  const { db, now } = c.get('deps')
  const r = db.prepare('UPDATE trusted_devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(iso(now()), c.req.param('id'), c.get('session').user.id)
  if (!r.changes) throw notFound('No se encontró ese equipo.')
  return c.json({ ok: true })
})

authed.delete('/auth/sessions/:id', (c) => {
  const { db, now } = c.get('deps')
  const s = c.get('session')
  const r = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(iso(now()), c.req.param('id'), s.user.id)
  if (!r.changes) throw notFound('No se encontró esa sesión.')
  audit(db, now, { businessId: s.user.business_id, userId: s.user.id, action: 'sesion.cierre', entity: 'session', entityId: c.req.param('id') })
  return c.json({ ok: true })
})
