import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { audit } from './audit.js'
import { businessGiros, enforceLimits, GIROS, limits, monthlyFee, PLAN_KEYS, refreshStatus, setting, type BusinessRow, type Plan } from './billing.js'
import { body, LOCK_MINUTES, MAX_FAILED, parse, smsOn, type Deps, type UserRow } from './context.js'
import { consumeChallenge, createChallenge, extraOf, forgetDevices } from './auth.js'
import { resetDemoData } from './reset.js'
import { demoAccess, demoApp, DEMOS, seedDemo } from './demo.js'
import { ticketView } from './support.js'
import { exportAll, importAll, keyFingerprint, readBackup, runBackup } from './backup.js'
import {
  bad, businessCode, checkPassword, conflict, hashSecret, iso, locked, newId, newToken, normalizePhone, notFound, numericCode, sha256, unauthorized, verifySecret, localDate } from './util.js'

interface AdminRow { id: string; name: string; username: string; password_hash: string; active: number; failed_attempts: number; locked_until: string | null; phone: string | null; email: string | null }
type AdminEnv = { Variables: { deps: Deps; admin: AdminRow } }

/**
 * Super panel: ve todos los clientes y administra pruebas, mensualidades, bloqueos y buzón.
 * Nunca consulta ventas, caja ni inventario de los negocios.
 */
export const admin = new Hono<AdminEnv>()

export function createAdmin(deps: Deps, a: { name: string; username: string; password: string; phone?: string; email?: string }) {
  checkPassword(a.password)
  const id = newId()
  deps.db.prepare('INSERT INTO admins (id, name, username, password_hash, phone, email, created_at) VALUES (?,?,?,?,?,?,?)').run(id, a.name, a.username.trim().toLowerCase(), hashSecret(a.password), a.phone ? normalizePhone(a.phone) : null, a.email?.trim().toLowerCase() ?? null, iso(deps.now()))
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
  // Verificación en dos pasos: el mismo código llega por SMS y por correo; sirve cualquiera.
  const deps = c.get('deps')
  const viaSms = !!a.phone && smsOn(deps)
  const viaMail = !!a.email && !!deps.notifier.sendEmail && deps.notifier.mailEnabled !== false
  // Sin SMS ni correo configurados se entra con usuario y contraseña (como los clientes).
  if (viaSms || viaMail) {
    const code = numericCode(6)
    const id = newId()
    db.prepare('INSERT INTO admin_challenges (id, admin_id, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)').run(id, a.id, hashSecret(code), iso(new Date(now().getTime() + 10 * 60_000)), iso(now()))
    const sent: string[] = []
    // Solo se anuncia lo que de verdad salió (sin proveedor, el código queda en el registro del servidor).
    // Cada canal por separado: si el SMS falla, el correo igual sale (y al revés).
    if (viaSms && (await Promise.resolve(deps.notifier.sendCode(a.phone!, code)).catch(() => false)) !== false) sent.push(`SMS al ${a.phone!.slice(-4).padStart(10, '•')}`)
    if (viaMail && (await Promise.resolve(deps.notifier.sendEmail!(a.email!, 'NEXORA · código del super panel', `Tu código de acceso al super panel es ${code}. Vence en 10 minutos. Si no fuiste tú, cambia tu contraseña.`)).catch(() => false)) !== false) sent.push(`correo ${a.email!.replace(/^(.{2}).*(@.*)$/, '$1•••$2')}`)
    return c.json({ challengeId: id, sentTo: sent })
  }
  return c.json({ token: issueAdminSession(deps, a.id) })
})

function issueAdminSession(deps: Deps, adminId: string) {
  const { db, now } = deps
  const token = newToken()
  const t = now()
  db.prepare('INSERT INTO admin_sessions (id, admin_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)').run(newId(), adminId, sha256(token), iso(t), iso(new Date(t.getTime() + 12 * 3600_000)))
  audit(db, now, { businessId: null, userId: adminId, action: 'admin.sesion' })
  return token
}

admin.post('/admin/verify', async (c) => {
  const { db, now } = c.get('deps')
  const d = parse(z.object({ challengeId: z.string(), code: z.string() }), await body(c))
  const ch = db.prepare('SELECT * FROM admin_challenges WHERE id = ?').get(d.challengeId) as { id: string; admin_id: string; code_hash: string; attempts: number; expires_at: string; used_at: string | null } | undefined
  if (!ch || ch.used_at || ch.expires_at <= iso(now())) throw bad('El código venció. Entra de nuevo.', 'codigo_vencido')
  if (ch.attempts >= MAX_FAILED) throw locked('Demasiados intentos. Entra de nuevo.')
  if (!verifySecret(d.code.trim(), ch.code_hash)) {
    db.prepare('UPDATE admin_challenges SET attempts = attempts + 1 WHERE id = ?').run(ch.id)
    throw bad('Código incorrecto.', 'codigo_incorrecto')
  }
  db.prepare('UPDATE admin_challenges SET used_at = ? WHERE id = ?').run(iso(now()), ch.id)
  return c.json({ token: issueAdminSession(c.get('deps'), ch.admin_id) })
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
admin.use('/admin/*', async (c, next) => (['/admin/login', '/admin/verify'].includes(c.req.path.replace(/^\/api(?=\/)/, '')) ? next() : adminAuth(c, next)))

function businessView(db: Deps['db'], b: BusinessRow, now: Date = new Date()) {
  const cfg = { plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs }
  const owner = db.prepare("SELECT id, name, phone FROM users WHERE business_id = ? AND role = 'owner'").get(b.id)
  const users = (db.prepare('SELECT COUNT(*) n FROM users WHERE business_id = ? AND active = 1').get(b.id) as { n: number }).n
  const branches = (db.prepare('SELECT COUNT(*) n FROM branches WHERE business_id = ? AND active = 1').get(b.id) as { n: number }).n
  const unread = (db.prepare('SELECT COUNT(*) n FROM tickets WHERE business_id = ? AND unread_by_support = 1').get(b.id) as { n: number }).n
  const overdueDays = b.status === 'vencido' && b.overdue_since ? Math.floor((now.getTime() - Date.parse(b.overdue_since)) / 86_400_000) : null
  return {
    id: b.id, code: b.code, name: b.name, giro: (b as BusinessRow & { giro: string }).giro, giros: businessGiros(db, b.id), status: b.status, owner, createdAt: b.created_at,
    trialDays: b.trial_days, trialEndsAt: b.trial_ends_at, paidUntil: b.paid_until, overdueSince: b.overdue_since, overdueDays,
    suspendedReason: b.suspended_reason,
    free: !!b.free, plan: cfg, pendingPlan: b.pending_plan ? JSON.parse(b.pending_plan) : null, monthlyFee: b.free ? 0 : monthlyFee(cfg), limits: limits(cfg),
    usage: { users, branches }, unreadTickets: unread, addons: JSON.parse((db.prepare('SELECT addons FROM businesses WHERE id = ?').get(b.id) as { addons: string }).addons),
    oneTimeCharges: db.prepare('SELECT concept, amount, created_at AS createdAt FROM one_time_charges WHERE business_id = ? ORDER BY created_at').all(b.id),
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
  return c.json({ businesses: status === 'gratis' ? list.filter((b) => b.free) : status ? list.filter((b) => b.status === status && !b.free) : list })
})

admin.get('/admin/businesses/:id', (c) => c.json({ business: businessView(c.get('deps').db, loadBusiness(c), c.get('deps').now()) }))

// Alta asistida: el super panel crea el negocio y entrega el acceso al dueño.
admin.post('/admin/businesses', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const d = parse(
    z.object({
      businessName: z.string().trim().min(2).max(100), ownerName: z.string().trim().min(2).max(100), phone: z.string(), tempPassword: z.string(),
      trialDays: z.number().int().min(0).max(365).optional(), plan: z.enum(PLAN_KEYS).optional(), giro: z.enum(GIROS).optional(),
      extraGiros: z.array(z.enum(GIROS)).max(GIROS.length).optional(), free: z.boolean().optional(),
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
    const giro = d.giro ?? 'abarrotes'
    db.prepare('INSERT INTO businesses (id, code, name, phone, trial_days, trial_ends_at, plan, giro, extra_giros, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      bizId, code, d.businessName, phone, trialDays, iso(new Date(t.getTime() + trialDays * 86_400_000)), d.plan ?? 'inicial', giro, JSON.stringify([...new Set(d.extraGiros ?? [])].filter((g) => g !== giro)), iso(t),
    )
    if (d.free) db.prepare("UPDATE businesses SET free = 1, status = 'activo' WHERE id = ?").run(bizId)
    db.prepare('INSERT INTO branches (id, business_id, name, created_at) VALUES (?,?,?,?)').run(branchId, bizId, 'Principal', iso(t))
    // El teléfono lo verificó el super panel; el dueño cambia la contraseña temporal al entrar.
    db.prepare(
      "INSERT INTO users (id, business_id, branch_id, role, name, phone, phone_verified, password_hash, must_change_password, created_at) VALUES (?,?,?,'owner',?,?,1,?,1,?)",
    ).run(ownerId, bizId, branchId, d.ownerName, phone, hashSecret(d.tempPassword), iso(t))
    audit(db, now, { businessId: bizId, userId: a.id, action: 'negocio.alta_asistida', entity: 'business', entityId: bizId, newValue: { name: d.businessName, trialDays, free: !!d.free } })
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
      giro: z.enum(GIROS).optional(),
      extraGiros: z.array(z.enum(GIROS)).max(GIROS.length).optional(),
    }),
    await body(c),
  )
  const old = businessView(db, b)
  if (d.giro !== undefined || d.extraGiros !== undefined) {
    const giro = d.giro ?? (b as BusinessRow & { giro: string }).giro
    const extra = d.extraGiros ?? (JSON.parse((b as BusinessRow & { extra_giros: string }).extra_giros) as string[])
    db.prepare('UPDATE businesses SET giro = ?, extra_giros = ? WHERE id = ?').run(giro, extraOf(giro, extra), b.id)
  }
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
  if (b.free) throw conflict('Este negocio es gratis. Para cobrarle, primero cámbialo a «Cobrar mensualidad».', 'cuenta_gratis')
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
  const d = parse(z.object({ newPassword: z.string(), reason: z.string().trim().min(3).max(300), identityChallengeId: z.string().optional(), identityCode: z.string().optional() }), await body(c))
  checkPassword(d.newPassword)
  const u = db.prepare('SELECT id, role FROM users WHERE id = ? AND business_id = ?').get(c.req.param('userId'), b.id) as { id: string; role: string } | undefined
  if (!u) throw notFound('No se encontró ese usuario.')
  // Identidad del dueño: debe dictar el código que llegó a su número registrado (aunque haya cambiado de aparato).
  // Sin SMS, soporte confirma por llamada al número registrado y da una contraseña temporal.
  if (u.role === 'owner' && smsOn(c.get('deps'))) {
    if (!d.identityChallengeId || !d.identityCode) throw bad('Primero envía el código al teléfono del dueño y pídele que te lo dicte.', 'identidad_requerida')
    const { user } = consumeChallenge(c.get('deps'), d.identityChallengeId, d.identityCode, 'identidad')
    if (user.id !== u.id) throw bad('Ese código no es de este dueño.', 'identidad_requerida')
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashSecret(d.newPassword), u.id)
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(iso(now()), u.id)
  forgetDevices(c.get('deps'), u.id)
  audit(db, now, { businessId: b.id, userId: a.id, action: 'admin.restablecer_acceso', entity: 'user', entityId: u.id, reason: d.reason })
  return c.json({ ok: true })
})

/** Gratis o con mensualidad. Al quitar lo gratis, el negocio tiene unos días (por defecto 30) para hacer su primer pago. */
admin.post('/admin/businesses/:id/free', async (c) => {
  const { db, now } = c.get('deps')
  const b = loadBusiness(c)
  const d = parse(z.object({ free: z.boolean(), reason: z.string().trim().min(3).max(300), graceDays: z.number().int().min(0).max(365).optional() }), await body(c))
  if (!!b.free === d.free) throw conflict(d.free ? 'Ya es gratis.' : 'Ya paga mensualidad.')
  if (d.free) {
    db.prepare("UPDATE businesses SET free = 1, status = 'activo', paid_until = NULL, overdue_since = NULL, suspended_reason = NULL WHERE id = ?").run(b.id)
  } else {
    const until = new Date(now().getTime() + (d.graceDays ?? 30) * 86_400_000)
    db.prepare("UPDATE businesses SET free = 0, status = 'activo', paid_until = ?, overdue_since = NULL WHERE id = ?").run(iso(until), b.id)
  }
  audit(db, now, { businessId: b.id, userId: c.get('admin').id, action: d.free ? 'admin.cuenta_gratis' : 'admin.cuenta_con_mensualidad', entity: 'business', entityId: b.id, oldValue: { status: b.status, paidUntil: b.paid_until }, reason: d.reason })
  return c.json({ business: businessView(db, refreshStatus(db, now, b.id), now()) })
})

/** Negocios de demostración: uno por giro, gratis, con datos ficticios y accesos fáciles. */
admin.get('/admin/demos', (c) => c.json({ demos: demoAccess(c.get('deps').db) }))
admin.post('/admin/demos/:giro', async (c) => {
  const deps = c.get('deps')
  const giro = c.req.param('giro')
  if (!DEMOS.some((d) => d.giro === giro)) throw bad('Giro no válido.')
  try {
    const r = await seedDemo(demoApp() as never, deps, giro)
    if (r.created) audit(deps.db, deps.now, { businessId: r.businessId!, userId: c.get('admin').id, action: 'admin.demo_creada', entity: 'business', entityId: r.businessId! })
    return c.json({ ...r, demo: demoAccess(deps.db).find((d) => d.giro === giro) })
  } catch (e) {
    throw bad(`No se pudo crear la demo de ${giro}: ${(e as Error).message}`)
  }
})

/** Empezar de cero: borrar las ventas y movimientos de prueba de una cuenta asistida (se escribe BORRAR y un motivo). */
admin.post('/admin/businesses/:id/reset-demo', async (c) => {
  const { db, now } = c.get('deps')
  const b = loadBusiness(c)
  const d = parse(z.object({ confirm: z.string(), reason: z.string().trim().min(3).max(300) }), await body(c))
  if (d.confirm.trim().toUpperCase() !== 'BORRAR') throw bad('Escribe BORRAR para confirmar.')
  const r = resetDemoData(db, b.id)
  audit(db, now, { businessId: b.id, userId: c.get('admin').id, action: 'admin.empezar_de_cero', entity: 'business', entityId: b.id, newValue: r, reason: d.reason })
  return c.json(r)
})

/** Cambiar el teléfono con el que entra el dueño (cuando cambia de número y no puede hacerlo él). */
admin.post('/admin/businesses/:id/owner-phone', async (c) => {
  const { db, now } = c.get('deps')
  const b = loadBusiness(c)
  const d = parse(z.object({ phone: z.string(), reason: z.string().trim().min(3).max(300) }), await body(c))
  const phone = normalizePhone(d.phone)
  const owner = db.prepare("SELECT id, phone FROM users WHERE business_id = ? AND role = 'owner'").get(b.id) as { id: string; phone: string }
  if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' AND phone = ? AND id <> ?").get(phone, owner.id)) throw conflict('Ese teléfono ya tiene una cuenta.', 'telefono_registrado')
  db.prepare('UPDATE users SET phone = ?, phone_verified = 1 WHERE id = ?').run(phone, owner.id)
  forgetDevices(c.get('deps'), owner.id)
  audit(db, now, { businessId: b.id, userId: c.get('admin').id, action: 'admin.cambio_telefono_dueno', entity: 'user', entityId: owner.id, oldValue: { phone: owner.phone }, newValue: { phone }, reason: d.reason })
  return c.json({ business: businessView(db, refreshStatus(db, now, b.id), now()) })
})

/** Verificar la identidad del dueño: se envía un código a su número registrado. */
admin.post('/admin/businesses/:id/verify-owner', async (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const b = loadBusiness(c)
  const owner = db.prepare("SELECT * FROM users WHERE business_id = ? AND role = 'owner'").get(b.id) as UserRow
  if (!smsOn(deps)) throw bad('No hay SMS configurado: confirma su identidad llamando a su número registrado.', 'sin_sms')
  const challengeId = await createChallenge(deps, owner, 'identidad', {})
  audit(db, now, { businessId: b.id, userId: c.get('admin').id, action: 'admin.verificar_identidad', entity: 'user', entityId: owner.id })
  return c.json({ challengeId, sentTo: `SMS al ${owner.phone!.slice(-4).padStart(10, '•')}` })
})

/** Habilitar un extra con su cobro de instalación (p. ej. link de reservas). Se activa de una vez para el negocio. */
admin.post('/admin/businesses/:id/addons', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const b = loadBusiness(c)
  const d = parse(z.object({ addon: z.enum(['reservas']), installationFee: z.number().int().min(0), note: z.string().max(200).optional() }), await body(c))
  const row = db.prepare('SELECT addons, modules FROM businesses WHERE id = ?').get(b.id) as { addons: string; modules: string }
  const addons = JSON.parse(row.addons) as string[]
  if (addons.includes(d.addon)) throw conflict('Ese extra ya está habilitado.')
  const modules = [...new Set([...(JSON.parse(row.modules) as string[]), d.addon])]
  db.transaction(() => {
    db.prepare('UPDATE businesses SET addons = ?, modules = ? WHERE id = ?').run(JSON.stringify([...addons, d.addon]), JSON.stringify(modules), b.id)
    db.prepare('INSERT INTO one_time_charges (id, business_id, concept, amount, recorded_by, created_at) VALUES (?,?,?,?,?,?)').run(newId(), b.id, `Instalación: ${d.addon}${d.note ? ` (${d.note})` : ''}`, d.installationFee, a.id, iso(now()))
    audit(db, now, { businessId: b.id, userId: a.id, action: 'admin.extra_habilitado', entity: 'business', entityId: b.id, newValue: { addon: d.addon, installationFee: d.installationFee } })
  })()
  return c.json({ business: businessView(db, refreshStatus(db, now, b.id), now()) }, 201)
})

admin.delete('/admin/businesses/:id/addons/:addon', (c) => {
  const { db, now } = c.get('deps')
  const b = loadBusiness(c)
  const row = db.prepare('SELECT addons, modules FROM businesses WHERE id = ?').get(b.id) as { addons: string; modules: string }
  const strip = (j: string) => JSON.stringify((JSON.parse(j) as string[]).filter((x) => x !== c.req.param('addon')))
  db.prepare('UPDATE businesses SET addons = ?, modules = ? WHERE id = ?').run(strip(row.addons), strip(row.modules), b.id)
  audit(db, now, { businessId: b.id, userId: c.get('admin').id, action: 'admin.extra_retirado', entity: 'business', entityId: b.id, newValue: { addon: c.req.param('addon') } })
  return c.json({ business: businessView(db, refreshStatus(db, now, b.id), now()) })
})

/** Respaldo completo (todas las tablas) para descargar y guardar fuera del servidor. */
admin.get('/admin/export', (c) => {
  const { db, now } = c.get('deps')
  const data = exportAll(db, now())
  audit(db, now, { businessId: null, userId: c.get('admin').id, action: 'admin.respaldo' })
  return c.json(data, 200, { 'content-disposition': `attachment; filename="nexora-${data.exportedAt.slice(0, 10)}.json"` })
})

/**
 * Métricas para operar 100–500 negocios: cuántos hay por estado y giro, ingreso mensual recurrente,
 * pruebas y mensualidades por vencer, vencidos, y quién de verdad está usando el sistema.
 */
admin.get('/admin/metrics', (c) => {
  const { db, now } = c.get('deps')
  const t = now()
  const ids = db.prepare('SELECT id FROM businesses').all() as { id: string }[]
  const list = ids.map(({ id }) => businessView(db, refreshStatus(db, now, id), t))
  const in7 = new Date(t.getTime() + 7 * 86_400_000).toISOString()
  const since7 = new Date(t.getTime() - 7 * 86_400_000).toISOString()
  const monthStart = `${localDate(t).slice(0, 7)}-01`
  const active7 = new Set((db.prepare('SELECT DISTINCT business_id b FROM sales WHERE created_at >= ?').all(since7) as { b: string }[]).map((r) => r.b))
  const byStatus: Record<string, number> = { prueba: 0, activo: 0, vencido: 0, suspendido: 0, gratis: 0 }
  const byGiro: Record<string, number> = {}
  for (const b of list) { byStatus[b.free ? 'gratis' : b.status] = (byStatus[b.free ? 'gratis' : b.status] ?? 0) + 1; byGiro[b.giro] = (byGiro[b.giro] ?? 0) + 1 }
  const short = (b: (typeof list)[number]) => ({ id: b.id, name: b.name, giro: b.giro, status: b.status, trialEndsAt: b.trialEndsAt, paidUntil: b.paidUntil, overdueDays: b.overdueDays, monthlyFee: b.monthlyFee, usedLast7Days: active7.has(b.id) })
  const paying = list.filter((b) => b.status === 'activo' && !b.free)
  return c.json({
    total: list.length, byStatus, byGiro,
    mrr: paying.reduce((a, b) => a + b.monthlyFee, 0),
    newThisMonth: list.filter((b) => b.createdAt >= monthStart).length,
    usedLast7Days: list.filter((b) => active7.has(b.id)).length,
    trialsEnding: list.filter((b) => !b.free && b.status === 'prueba' && b.trialEndsAt && b.trialEndsAt <= in7).map(short),
    renewalsDue: list.filter((b) => !b.free && b.status === 'activo' && b.paidUntil && b.paidUntil <= in7).map(short),
    overdue: list.filter((b) => b.status === 'vencido').map(short).sort((x, y) => (y.overdueDays ?? 0) - (x.overdueDays ?? 0)),
    // Pagan o están en prueba pero no han vendido en 7 días: riesgo de que se vayan.
    inactive: list.filter((b) => !b.free && ['prueba', 'activo'].includes(b.status) && !active7.has(b.id)).map(short),
  })
})

/**
 * Espacio de la base: hoy todos los negocios viven en un solo objeto de Cloudflare con tope
 * (1 GB en plan gratis, 10 GB de pago; STORAGE_LIMIT_MB lo ajusta). Avisa antes de llegar.
 */
admin.get('/admin/storage', (c) => {
  const deps = c.get('deps')
  const { db, now } = deps
  const bytes = deps.dbSize?.() ?? 0
  const limit = Number((db.prepare("SELECT value FROM settings WHERE key = 'storage_limit_mb'").get() as { value: string } | undefined)?.value ?? 1024) * 1024 * 1024
  const since = new Date(now().getTime() - 30 * 86_400_000).toISOString()
  const sales30 = (db.prepare('SELECT COUNT(*) n FROM sales WHERE created_at >= ?').get(since) as { n: number }).n
  // Crecimiento estimado: ~3 KB por venta (venta, renglones, pago, inventario y bitácora), medido en pruebas.
  const perMonth = sales30 * 3000
  const monthsLeft = perMonth > 0 ? Math.max(0, Math.floor((limit - bytes) / perMonth)) : null
  const pct = limit ? Math.round((bytes / limit) * 1000) / 10 : 0
  return c.json({ bytes, limit, pct, sales30, perMonth, monthsLeft, level: pct >= 85 ? 'critico' : pct >= 70 ? 'aviso' : 'ok' })
})

/** Respaldos automáticos guardados (30 días). */
admin.get('/admin/backups', async (c) => {
  const store = c.get('deps').backups
  if (!store) return c.json({ backups: [], enabled: false })
  const list = (await store.list()).sort((x, y) => (x.name < y.name ? 1 : -1))
  const key = c.get('deps').backupKey
  // Si están cifrados, la huella dice QUÉ llave se usa (la llave nunca se muestra).
  return c.json({ backups: list, enabled: true, encrypted: !!key, keyFingerprint: key ? await keyFingerprint(key) : null })
})

admin.post('/admin/backups', async (c) => {
  const deps = c.get('deps')
  if (!deps.backups) throw bad('Los respaldos automáticos no están configurados en este servidor.')
  return c.json(await runBackup(deps, deps.backups, `manual (${c.get('admin').username})`), 201)
})

admin.get('/admin/backups/:name', async (c) => {
  const store = c.get('deps').backups
  const name = c.req.param('name')
  if (!store || !/^nexora-[\d-T]+\.json\.gz(\.enc)?$/.test(name)) throw notFound()
  const bytes = await store.get(name)
  if (!bytes) throw notFound('Ese respaldo ya no existe.')
  audit(c.get('deps').db, c.get('deps').now, { businessId: null, userId: c.get('admin').id, action: 'admin.descarga_respaldo', newValue: { name } })
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': name.endsWith('.enc') ? 'application/octet-stream' : 'application/gzip', 'content-disposition': `attachment; filename="${name}"` } })
})

/**
 * Recuperación: carga un respaldo descargado en esta base, SOLO si está vacía (sin negocios).
 * Se usa en un objeto nuevo (DB_OBJECT) o en un ensayo; nunca mezcla ni sobrescribe datos.
 */
admin.post('/admin/restore', async (c) => {
  const deps = c.get('deps')
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (!bytes.length) throw bad('Envía el archivo del respaldo.')
  if (bytes.length > 50 * 1024 * 1024) throw bad('El respaldo pasa de 50 MB; restáuralo con el script local.')
  let r: { tables: number; rows: number }
  try {
    r = importAll(deps.db, await readBackup(bytes, deps.backupKey))
  } catch (e) {
    throw bad((e as Error).message, 'restauracion_rechazada')
  }
  audit(deps.db, deps.now, { businessId: null, userId: c.get('admin').id, action: 'admin.restauracion', newValue: { ...r, bytes: bytes.length } })
  return c.json(r, 201)
})

/** Cambiar la contraseña propia del super panel (cierra las demás sesiones). */
admin.post('/admin/password', async (c) => {
  const { db, now } = c.get('deps')
  const a = c.get('admin')
  const d = parse(z.object({ currentPassword: z.string(), newPassword: z.string() }), await body(c))
  if (!verifySecret(d.currentPassword, a.password_hash)) throw unauthorized('La contraseña actual no es correcta.')
  checkPassword(d.newPassword)
  if (d.newPassword === d.currentPassword) throw bad('La contraseña nueva debe ser distinta.')
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashSecret(d.newPassword), a.id)
  const token = (c.req.header('authorization') ?? '').slice(7)
  db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND token_hash != ? AND revoked_at IS NULL').run(iso(now()), a.id, sha256(token))
  audit(db, now, { businessId: null, userId: a.id, action: 'admin.cambio_contrasena' })
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
