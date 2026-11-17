import type { Deps, UserRow } from './context.js'
import { hasPerm, LOCK_MINUTES, MAX_FAILED } from './context.js'
import type { Permission } from './permissions.js'
import { audit } from './audit.js'
import { bad, forbidden, iso, locked, verifySecret } from './util.js'

/**
 * Valida un código de autorización escrito por `requester` y devuelve quién autoriza.
 * El código pertenece a un usuario del mismo negocio (el dueño, o quien el dueño haya habilitado)
 * y esa persona debe tener el permiso requerido. Tras varios fallos se bloquea al solicitante.
 */
export function authorize(deps: Deps, requester: UserRow, code: string | undefined, needed: Permission, action: string, opts: { ownerOnly?: boolean } = {}): UserRow {
  const { db, now } = deps
  const t = now()
  if (requester.auth_locked_until && requester.auth_locked_until > iso(t)) {
    throw locked('Demasiados intentos con el código. Espera unos minutos e inténtalo de nuevo.')
  }
  if (!code) throw bad('Se requiere el código de autorización.', 'codigo_requerido')

  const candidates = db
    .prepare('SELECT * FROM users WHERE business_id = ? AND active = 1 AND auth_code_hash IS NOT NULL')
    .all(requester.business_id) as UserRow[]
  const match = candidates.find((u) => verifySecret(code, u.auth_code_hash))

  if (!match || !hasPerm(match, needed) || (opts.ownerOnly && match.role !== 'owner')) {
    const attempts = requester.auth_failed_attempts + 1
    const lock = attempts >= MAX_FAILED
    db.prepare('UPDATE users SET auth_failed_attempts = ?, auth_locked_until = ? WHERE id = ?').run(
      lock ? 0 : attempts,
      lock ? iso(new Date(t.getTime() + LOCK_MINUTES * 60_000)) : null,
      requester.id,
    )
    audit(db, now, {
      businessId: requester.business_id,
      userId: requester.id,
      action: lock ? 'codigo.bloqueo' : 'codigo.fallido',
      reason: action,
    })
    if (lock) throw locked('Demasiados intentos con el código. Se bloqueó temporalmente.')
    throw forbidden(match ? (opts.ownerOnly ? 'Esta acción requiere el código del dueño.' : 'Ese código no tiene permiso para esta acción.') : 'Código de autorización incorrecto.')
  }

  if (requester.auth_failed_attempts) {
    db.prepare('UPDATE users SET auth_failed_attempts = 0, auth_locked_until = NULL WHERE id = ?').run(requester.id)
  }
  return match
}
