import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { audit } from './audit.js'
import { enforceLimits, limits, monthlyFee, PLAN_KEYS, refreshStatus, setting, type BusinessRow, type Plan } from './billing.js'
import { body, LOCK_MINUTES, MAX_FAILED, parse, type Deps } from './context.js'
import { ticketView } from './support.js'
import {
  bad, businessCode, checkPassword, conflict, hashSecret, iso, locked, newId, newToken, normalizePhone, notFound, sha256, unauthorized, verifySecret,
} from './util.js'

interface AdminRow { id: string; name: string; username: string; password_hash: string; active: number; failed_attempts: number; locked_until: string | null }
type AdminEnv = { Variables: { deps: Deps; admin: AdminRow } }

/**
 * Super panel: ve todos los clientes y administra pruebas, mensualidades, bloqueos y buzón.
 * Nunca consulta ventas, caja ni inventario de los negocios.
 */
export const admin = new Hono<AdminEnv>()

export function createAdmin(deps: Deps, a: { name: string; username: string; password: string }) {
  checkPassword(a.password)
  const id = newId()
  deps.db.prepare('INSERT INTO admins (id, name, username, password_hash, created_at) VALUES (?,?,?,?,?)').run(id, a.name, a.username.trim().toLowerCase(), hashSecret(a.password), iso(deps.now()))
  return id
}

admin.post('/admin/login', async (c) => {
  const { db, now } = c.get('deps')
  const d = parse(z.object({ username: z.string(), password: z.string() }), await body(c))
  const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(d.username.trim().toLowerCase()) as AdminRow | undefined
  if (!a) {
    verifySecret(d.password, hashSecret('relleno'))
    throw unauthorized('Datos incorrectos.')
  }
  if (a.locked_until && a.locked_until > iso(now())) throw locked('Acceso bloqueado temporalmente por varios intentos fallidos.')
  if (!a.active || !verifySecret(d.password, a.password_hash)) {
    const n = a.failed_attempts + 1
    const lock = n >= MAX_FAILED
    db.prepare('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : n, lock ? iso(new Date(now().getTime() + LOCK_MINUTES * 60_000)) : null, a.id)
    throw unauthorized('Datos incorrectos.')
  }
  db.prepare('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(a.id)
  const token = newToken()
  const t = now()
  db.prepare('INSERT INTO admin_sessions (id, admin_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)').run(newId(), a.id, sha256(token), iso(t), iso(new Date(t.getTime() + 12 * 3600_000)))
  audit(db, now, { businessId: null, userId: a.id, action: 'admin.sesion' })
  return c.json({ token })
})

const adminAuth = createMiddleware<AdminEnv>(async (c, next) => {
  const { db, now } = c.get('deps')
  const h = c.req.header('authorization') ?? ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  const s = token
    ? (db.prepare('SELECT admin_id, expires_at, revoked_at FROM admin_sessions WHERE token_hash = ?').get(sha256(token)) as { admin_id: string; expires_at: string; revoked_at: string | null } | undefined)
    : undefined
  if (!s || s.revoked_at || s.expires_at <= iso(now())) throw unauthorized()
  const a = db.prepare('SELECT * FROM admins WHERE id = ? AND active = 1').get(s.admin_id) as AdminRow | undefined
  if (!a) throw unauthorized()
  c.set('admin', a)
  await next()
})
admin.use('/admin/*', async (c, next) => (c.req.path === '/admin/login' ? next() : adminAuth(c, next)))

function businessView(db: Deps['db'], b: BusinessRow, now: Date = new Date()) {
  const cfg = { plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs }
  const owner = db.prepare("SELECT id, name, phone FROM users WHERE business_id = ? AND role = 'owner'").get(b.id)
  const users = (db.prepare('SELECT COUNT(*) n FROM users WHERE business_id = ? AND active = 1').get(b.id) as { n: number }).n
  const branches = (db.prepare('SELECT COUNT(*) n FROM branches WHERE business_id = ? AND active = 1').get(b.id) as { n: number }).n
  const unread = (db.prepare('SELECT COUNT(*) n FROM tickets WHERE business_id = ? AND unread_by_support = 1').get(b.id) as { n: number }).n
  const overdueDays = b.status === 'vencido' && b.overdue_since ? Math.floor((now.getTime() - Date.parse(b.overdue_since)) / 86_400_000) : null
  return {
    id: b.id, code: b.code, name: b.name, status: b.status, owner, createdAt: b.created_at,
    trialDays: b.trial_days, trialEndsAt: b.trial_ends_at, paidUntil: b.paid_until, overdueSince: b.overdue_since, overdueDays,
    suspendedReason: b.suspended_reason,
    plan: cfg, pendingPlan: b.pending_plan ? JSON.parse(b.pending_plan) : null, monthlyFee: monthlyFee(cfg), limits: limits(cfg),
    usage: { users, branches }, unreadTickets: unread,
  }
}

function loadBusiness(c: { get: (k: 'deps') => Deps; req: { param: (k: string) => string } }) {
  const { db, now } = c.get('deps')
  if (!db.prepare('SELECT 1 FROM businesses WHERE id = ?').get(c.req.param('id'))) throw notFound('No se encontró ese negocio.')
  return refreshStatus(db, now, c.req.param('id'))
}

admin.get('/admin/businesses', (c) => {
  const { db, now } = c.get('deps')
  const ids = db.prepare('SELECT id FROM businesses ORDER BY created_at DESC').all() as { id: string }[]
  const list = ids.map(({ id }) => businessView(db, refreshStatus(db, now, id), now()))
  const status = c.req.query('status')
  return c.json({ businesses: status ? list.filter((b) => b.status === status) : list })
})

admin.get('/admin/businesses/:id', (c) => c.json({ business: businessView(c.get('deps').db, loadBusiness(c), c.get('deps').now()) }))

// Alta asistida: el super panel crea el negocio y entrega el acceso al dueño.
admin.post('/admin/businesses', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const d = parse(
    z.object({
      businessName: z.string().trim().min(2).max(100), ownerName: z.string().trim().min(2).max(100), phone: z.string(), tempPassword: z.string(),
      trialDays: z.number().int().min(0).max(365).optional(), plan: z.enum(PLAN_KEYS).optional(),
    }),
    await body(c),
  )
  const phone = normalizePhone(d.phone)
  checkPassword(d.tempPassword)
  if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' AND phone = ?").get(phone)) throw conflict('Ese teléfono ya tiene una cuenta.', 'telefono_registrado')
  const t = now()
  const trialDays = d.trialDays ?? setting(db, 'default_trial_days')
  const bizId = newId(), branchId = newId(), ownerId = newId()
  const code = businessCode()
  db.transaction(() => {
    db.prepare('INSERT INTO businesses (id, code, name, phone, trial_days, trial_ends_at, plan, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      bizId, code, d.businessName, phone, trialDays, iso(new Date(t.getTime() + trialDays * 86_400_000)), d.plan ?? 'inicial', iso(t),
    )
    db.prepare('INSERT INTO branches (id, business_id, name, created_at) VALUES (?,?,?,?)').run(branchId, bizId, 'Principal', iso(t))
    // El teléfono lo verificó el super panel; el dueño cambia la contraseña temporal al entrar.
    db.prepare(
      "INSERT INTO users (id, business_id, branch_id, role, name, phone, phone_verified, password_hash, must_change_password, created_at) VALUES (?,?,?,'owner',?,?,1,?,1,?)",
    ).run(ownerId, bizId, branchId, d.ownerName, phone, hashSecret(d.tempPassword), iso(t))
    audit(db, now, { businessId: bizId, userId: a.id, action: 'negocio.alta_asistida', entity: 'business', entityId: bizId, newValue: { name: d.businessName, trialDays } })
  })()
  return c.json({ business: businessView(db, refreshStatus(db, now, bizId)) }, 201)
})

// Días de prueba y plan. El cambio de plan se aplica al siguiente periodo salvo `applyNow`.
admin.patch('/admin/businesses/:id', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const b = loadBusiness(c)
  const d = parse(
    z.object({
      trialDays: z.number().int().min(0).max(365).optional(),
      plan: z.enum(PLAN_KEYS).optional(),
      extraBranches: z.number().int().min(0).max(100).optional(),
      extraUserPacks: z.number().int().min(0).max(100).optional(),
      applyNow: z.boolean().optional(),
    }),
    await body(c),
  )
  const old = businessView(db, b)
  if (d.trialDays !== undefined) {
    if (b.status !== 'prueba' && !(b.status === 'vencido' && !b.paid_until)) throw bad('Solo se cambian los días de prueba de un negocio en prueba.')
    const endsAt = iso(new Date(Date.parse(b.created_at) + d.trialDays * 86_400_000))
    const stillTrial = endsAt > iso(now())
    db.prepare('UPDATE businesses SET trial_days = ?, trial_ends_at = ?, status = ?, overdue_since = ? WHERE id = ?').run(
      d.trialDays, endsAt, stillTrial ? 'prueba' : b.status, stillTrial ? null : b.overdue_since, b.id,
    )
  }
  if (d.plan !== undefined || d.extraBranches !== undefined || d.extraUserPacks !== undefined) {
    const base = b.pending_plan ? (JSON.parse(b.pending_plan) as { plan: Plan; extraBranches: number; extraUserPacks: number }) : { plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs }
    const next = { plan: d.plan ?? base.plan, extraBranches: d.extraBranches ?? base.extraBranches, extraUserPacks: d.extraUserPacks ?? base.extraUserPacks }
    // En prueba no hay periodo de cobro: se aplica de inmediato.
    if (d.applyNow || b.status === 'prueba') {
      db.prepare('UPDATE businesses SET plan = ?, extra_branches = ?, extra_user_packs = ?, pending_plan = NULL WHERE id = ?').run(next.plan, next.extraBranches, next.extraUserPacks, b.id)
      enforceLimits(db, now, b.id, 'cambio de plan')
    } else {
      db.prepare('UPDATE businesses SET pending_plan = ? WHERE id = ?').run(JSON.stringify(next), b.id)
    }
  }
  const fresh = businessView(db, refreshStatus(db, now, b.id))
  audit(db, now, { businessId: b.id, userId: a.id, action: 'admin.cambio_negocio', entity: 'business', entityId: b.id, oldValue: { trialDays: old.trialDays, plan: old.plan, pendingPlan: old.pendingPlan }, newValue: { trialDays: fresh.trialDays, plan: fresh.plan, pendingPlan: fresh.pendingPlan } })
  return c.json({ business: fresh })
})

// Registrar pago: el negocio vuelve a Activo sin perder datos y entra el plan pendiente.
admin.post('/admin/businesses/:id/payments', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const b = loadBusiness(c)
  const d = parse(z.object({ months: z.number().int().min(1).max(24), amount: z.number().int().min(0).optional(), note: z.string().max(300).optional() }), await body(c))
  const t = iso(now())
  const pending = b.pending_plan ? (JSON.parse(b.pending_plan) as { plan: Plan; extraBranches: number; extraUserPacks: number }) : null
  const cfg = pending ?? { plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs }
  const start = b.paid_until && b.paid_until > t ? b.paid_until : t
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + d.months)
  const amount = d.amount ?? monthlyFee(cfg) * d.months
  db.transaction(() => {
    db.prepare('INSERT INTO payments (id, business_id, months, amount, note, period_start, period_end, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(newId(), b.id, d.months, amount, d.note ?? null, start, iso(end), a.id, t)
    db.prepare("UPDATE businesses SET status = 'activo', paid_until = ?, overdue_since = NULL, suspended_reason = NULL, plan = ?, extra_branches = ?, extra_user_packs = ?, pending_plan = NULL WHERE id = ?").run(
      iso(end), cfg.plan, cfg.extraBranches, cfg.extraUserPacks, b.id,
    )
    if (pending) enforceLimits(db, now, b.id, 'nuevo periodo con plan cambiado')
    audit(db, now, { businessId: b.id, userId: a.id, action: 'admin.pago', entity: 'business', entityId: b.id, oldValue: { status: b.status, paidUntil: b.paid_until }, newValue: { status: 'activo', paidUntil: iso(end), amount } })
  })()
  return c.json({ business: businessView(db, refreshStatus(db, now, b.id)) }, 201)
})

admin.get('/admin/businesses/:id/payments', (c) => {
  const b = loadBusiness(c)
  return c.json({ payments: c.get('deps').db.prepare('SELECT * FROM payments WHERE business_id = ? ORDER BY created_at DESC').all(b.id) })
})

// Suspender: decisión del super panel, solo después de X días vencido.
admin.post('/admin/businesses/:id/suspend', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const b = loadBusiness(c)
  const d = parse(z.object({ reason: z.string().trim().min(3).max(300) }), await body(c))
  const minDays = setting(db, 'suspend_after_days')
  if (b.status !== 'vencido' || !b.overdue_since) throw conflict('Solo se suspende un negocio vencido.', 'no_vencido')
  const days = (now().getTime() - Date.parse(b.overdue_since)) / 86_400_000
  if (days < minDays) throw conflict(`Debe llevar al menos ${minDays} días vencido (lleva ${Math.floor(days)}).`, 'muy_pronto')
  db.prepare("UPDATE businesses SET status = 'suspendido', suspended_reason = ? WHERE id = ?").run(d.reason, b.id)
  audit(db, now, { businessId: b.id, userId: a.id, action: 'admin.suspension', entity: 'business', entityId: b.id, oldValue: { status: 'vencido' }, newValue: { status: 'suspendido' }, reason: d.reason })
  return c.json({ business: businessView(db, refreshStatus(db, now, b.id)) })
})

// Restablecer acceso cuando el dueño no está disponible (o al dueño mismo, tras verificar su identidad).
admin.post('/admin/businesses/:id/users/:userId/reset-password', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const b = loadBusiness(c)
  const d = parse(z.object({ newPassword: z.string(), reason: z.string().trim().min(3).max(300) }), await body(c))
  checkPassword(d.newPassword)
  const u = db.prepare('SELECT id, role FROM users WHERE id = ? AND business_id = ?').get(c.req.param('userId'), b.id) as { id: string; role: string } | undefined
  if (!u) throw notFound('No se encontró ese usuario.')
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashSecret(d.newPassword), u.id)
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), u.id)
  audit(db, now, { businessId: b.id, userId: a.id, action: 'admin.restablecer_acceso', entity: 'user', entityId: u.id, reason: d.reason })
  return c.json({ ok: true })
})

admin.get('/admin/settings', (c) => c.json({ settings: Object.fromEntries((c.get('deps').db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]).map((r) => [r.key, Number(r.value)])) }))

admin.put('/admin/settings', async (c) => {
  const { db, now } = c.get('deps')
  const d = parse(z.object({ default_trial_days: z.number().int().min(0).max(365).optional(), suspend_after_days: z.number().int().min(0).max(365).optional() }), await body(c))
  for (const [k, v] of Object.entries(d)) if (v !== undefined) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(v), k)
  audit(db, now, { businessId: null, userId: c.get('admin').id, action: 'admin.ajustes', newValue: d })
  return c.json({ ok: true })
})

// Buzón desde el super panel.
admin.get('/admin/tickets', (c) => {
  const { db } = c.get('deps')
  const where = ['1=1']
  const args: string[] = []
  for (const [q, col] of [['businessId', 'business_id'], ['type', 'type'], ['status', 'status']] as const) {
    const v = c.req.query(q)
    if (v) { where.push(`${col} = ?`); args.push(v) }
  }
  if (c.req.query('unread')) where.push('unread_by_support = 1')
  const rows = db.prepare(`SELECT t.*, b.name AS business_name FROM tickets t JOIN businesses b ON b.id = t.business_id WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`).all(...args)
  return c.json({ tickets: rows })
})

admin.get('/admin/tickets/:id', (c) => {
  const { db } = c.get('deps')
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(c.req.param('id')) as { id: string } | undefined
  if (!t) throw notFound()
  db.prepare('UPDATE tickets SET unread_by_support = 0 WHERE id = ?').run(t.id)
  return c.json({ ticket: ticketView(db, t.id) })
})

admin.post('/admin/tickets/:id/messages', async (c) => {
  const { db, now } = c.get('deps')
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(c.req.param('id')) as { id: string; type: string; status: string } | undefined
  if (!t) throw notFound()
  const d = parse(z.object({ message: z.string().trim().min(1).max(5000) }), await body(c))
  const ts = iso(now())
  db.prepare("INSERT INTO ticket_messages (id, ticket_id, author_type, author_id, body, created_at) VALUES (?,?,'soporte',?,?,?)").run(newId(), t.id, c.get('admin').id, d.message, ts)
  const status = t.type === 'soporte' && t.status === 'abierto' ? 'respondido' : t.status
  db.prepare('UPDATE tickets SET updated_at = ?, unread_by_client = 1, unread_by_support = 0, status = ? WHERE id = ?').run(ts, status, t.id)
  return c.json({ ticket: ticketView(db, t.id) }, 201)
})

// Estado de solicitudes de cambio: en revisión, aceptada o rechazada. Soporte: cerrar.
admin.patch('/admin/tickets/:id', async (c) => {
  const { db, now } = c.get('deps')
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(c.req.param('id')) as { id: string; business_id: string; type: string; status: string } | undefined
  if (!t) throw notFound()
  const d = parse(z.object({ status: z.enum(['en_revision', 'aceptada', 'rechazada', 'cerrado', 'abierto']) }), await body(c))
  const valid = t.type === 'cambio' ? ['en_revision', 'aceptada', 'rechazada'] : ['cerrado', 'abierto']
  if (!valid.includes(d.status)) throw bad('Ese estado no aplica a este tipo de mensaje.')
  db.prepare('UPDATE tickets SET status = ?, updated_at = ?, unread_by_client = 1 WHERE id = ?').run(d.status, iso(now()), t.id)
  audit(db, now, { businessId: t.business_id, userId: c.get('admin').id, action: 'admin.estado_buzon', entity: 'ticket', entityId: t.id, oldValue: { status: t.status }, newValue: { status: d.status } })
  return c.json({ ticket: ticketView(db, t.id) })
})
