import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto'

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}
export const bad = (msg: string, code = 'solicitud_invalida') => new AppError(400, code, msg)
export const unauthorized = (msg = 'Sesión no válida. Vuelve a entrar.') => new AppError(401, 'no_autenticado', msg)
export const forbidden = (msg = 'No tienes permiso para hacer esto.') => new AppError(403, 'sin_permiso', msg)
export const notFound = (msg = 'No se encontró.') => new AppError(404, 'no_encontrado', msg)
export const conflict = (msg: string, code = 'conflicto') => new AppError(409, code, msg)
export const locked = (msg: string) => new AppError(423, 'bloqueado', msg)

export type Clock = () => Date
export const iso = (d: Date) => d.toISOString()
export const newId = () => randomUUID()

/** Fecha local (YYYY-MM-DD) en zona horaria de México. */
export function localDate(d: Date, tz = 'America/Mexico_City'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function hashSecret(secret: string): string {
  const salt = randomBytes(16)
  const h = scryptSync(secret, salt, 32)
  return `s1:${salt.toString('base64')}:${h.toString('base64')}`
}
export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [v, s, h] = stored.split(':')
  if (v !== 's1' || !s || !h) return false
  const expected = Buffer.from(h, 'base64')
  const got = scryptSync(secret, Buffer.from(s, 'base64'), expected.length)
  return timingSafeEqual(got, expected)
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')
export const numericCode = (digits = 6) => String(randomInt(0, 10 ** digits)).padStart(digits, '0')
export const businessCode = () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => alphabet[randomInt(0, alphabet.length)]).join('')
}

export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  const ten = d.length === 12 && d.startsWith('52') ? d.slice(2) : d
  if (ten.length !== 10) throw bad('El teléfono debe tener 10 dígitos.')
  return ten
}
export const normalizeUsername = (u: string) => u.trim().toLowerCase()

export function checkPassword(p: string) {
  if (p.length < 8) throw bad('La contraseña debe tener al menos 8 caracteres.')
}

/** Hora reportada por el equipo (puede venir de una caja sin internet); nunca en el futuro. */
export function clampTime(at: string | undefined, now: Date): Date {
  if (!at) return now
  const d = new Date(at)
  return Number.isNaN(d.getTime()) || d > now ? now : d
}
