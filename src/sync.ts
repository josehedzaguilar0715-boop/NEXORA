import { createMiddleware } from 'hono/factory'
import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { body, hasPerm, parse, requirePerm, type Env } from './context.js'
import { forbidden, iso, newId, notFound } from './util.js'
import { isMultiBranch, scopeBranch } from './scope.js'

/**
 * Idempotencia: si un equipo reenvía la misma operación (misma llave), se devuelve
 * la respuesta original y no se vuelve a ejecutar. Así una venta pendiente nunca se duplica.
 */
export const idempotency = createMiddleware<Env>(async (c, next) => {
  const key = c.req.header('idempotency-key')
  if (!key || c.req.method === 'GET') return next()
  const { db, now } = c.get('deps')
  const uid = c.get('session').user.id
  const prev = db.prepare('SELECT status, body FROM idempotency WHERE user_id = ? AND key = ?').get(uid, key) as { status: number; body: string } | undefined
  if (prev) return new Response(prev.body, { status: prev.status, headers: { 'content-type': 'application/json', 'idempotent-replay': 'true' } })
  await next()
  if (c.res.status >= 200 && c.res.status < 300) {
    const text = await c.res.clone().text()
    db.prepare('INSERT OR IGNORE INTO idempotency (user_id, key, status, body, created_at) VALUES (?,?,?,?,?)').run(uid, key, c.res.status, text, iso(now()))
  }
})

export const sync = new Hono<Env>()

const change = z.object({
  opId: z.string().uuid(),
  entity: z.string().regex(/^[a-z_]{2,40}$/),
  entityId: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()),
  /** Hora en que el equipo hizo el cambio. */
  updatedAt: z.string().datetime(),
  /** Versión que el equipo tenía al editar (0 si es nuevo). */
  baseVersion: z.number().int().min(0),
})

const canSync = (c: Parameters<typeof hasPerm>[0]) => hasPerm(c, 'edit_inventory') || hasPerm(c, 'configure_catalog') || hasPerm(c, 'customers_credit')

/**
 * Subir cambios hechos (posiblemente sin internet). Si dos equipos cambian lo mismo sin verse,
 * gana el movimiento más reciente y el conflicto queda marcado para revisión.
 */
sync.post('/sync/changes', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  if (!canSync(u)) throw forbidden()
  const d = parse(z.object({ deviceId: z.string().min(1).max(100), changes: z.array(change).min(1).max(500) }), await body(c))
  const results = d.changes.map((ch) =>
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM sync_changes WHERE op_id = ?').get(ch.opId)) return { opId: ch.opId, status: 'duplicado' as const }
      const cur = db.prepare('SELECT * FROM sync_state WHERE business_id = ? AND entity = ? AND entity_id = ?').get(u.business_id, ch.entity, ch.entityId) as
        | { version: number; data: string; client_updated_at: string; device_id: string }
        | undefined
      const t = iso(now())
      const record = (applied: number) =>
        db.prepare(
          'INSERT INTO sync_changes (op_id, business_id, entity, entity_id, data, client_updated_at, device_id, user_id, applied, received_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        ).run(ch.opId, u.business_id, ch.entity, ch.entityId, JSON.stringify(ch.data), ch.updatedAt, d.deviceId, u.id, applied, t)
      const write = (version: number) =>
        db.prepare(
          `INSERT INTO sync_state (business_id, entity, entity_id, version, data, client_updated_at, device_id) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(business_id, entity, entity_id) DO UPDATE SET version = excluded.version, data = excluded.data, client_updated_at = excluded.client_updated_at, device_id = excluded.device_id`,
        ).run(u.business_id, ch.entity, ch.entityId, version, JSON.stringify(ch.data), ch.updatedAt, d.deviceId)

      if (!cur || cur.version === ch.baseVersion) {
        write((cur?.version ?? 0) + 1)
        record(1)
        return { opId: ch.opId, status: 'aplicado' as const, version: (cur?.version ?? 0) + 1 }
      }
      // Conflicto: el equipo editó sobre una versión vieja. Gana el más reciente.
      const incomingWins = ch.updatedAt >= cur.client_updated_at
      const conflictId = newId()
      db.prepare(
        'INSERT INTO sync_conflicts (id, business_id, entity, entity_id, winner, loser, winner_device, loser_device, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      ).run(
        conflictId, u.business_id, ch.entity, ch.entityId,
        incomingWins ? JSON.stringify(ch.data) : cur.data, incomingWins ? cur.data : JSON.stringify(ch.data),
        incomingWins ? d.deviceId : cur.device_id, incomingWins ? cur.device_id : d.deviceId, t,
      )
      if (incomingWins) write(cur.version + 1)
      record(incomingWins ? 1 : 0)
      audit(db, now, { businessId: u.business_id, userId: u.id, action: 'sync.conflicto', entity: ch.entity, entityId: ch.entityId, oldValue: JSON.parse(cur.data), newValue: ch.data, reason: incomingWins ? 'gana el cambio nuevo' : 'gana el cambio anterior' })
      return { opId: ch.opId, status: incomingWins ? ('conflicto_gana' as const) : ('conflicto_pierde' as const), version: incomingWins ? cur.version + 1 : cur.version, conflictId }
    })(),
  )
  return c.json({ results })
})

/** Bajar cambios aplicados desde la última marca (`since`). */
sync.get('/sync/changes', (c) => {
  const { db } = c.get('deps')
  const u = c.get('session').user
  if (!canSync(u)) throw forbidden()
  const since = Number(c.req.query('since') ?? 0) || 0
  const rows = db
    .prepare('SELECT seq, entity, entity_id AS entityId, data, client_updated_at AS updatedAt, device_id AS deviceId FROM sync_changes WHERE business_id = ? AND applied = 1 AND seq > ? ORDER BY seq LIMIT 500')
    .all(u.business_id, since) as { seq: number; data: string }[]
  return c.json({ changes: rows.map((r) => ({ ...r, data: JSON.parse(r.data) })), next: rows.at(-1)?.seq ?? since })
})

sync.get('/sync/conflicts', requirePerm('view_reports'), (c) => {
  const { db } = c.get('deps')
  if (c.get('session').user.role !== 'owner' && isMultiBranch(db, c.get('session').user.business_id)) throw forbidden('Los choques de edición son de todo el negocio: solo los ve el dueño.')
  const status = c.req.query('status') === 'revisado' ? 'revisado' : 'pendiente'
  const rows = db.prepare('SELECT * FROM sync_conflicts WHERE business_id = ? AND status = ? ORDER BY created_at DESC').all(c.get('session').user.business_id, status) as { winner: string; loser: string }[]
  return c.json({ conflicts: rows.map((r) => ({ ...r, winner: JSON.parse(r.winner), loser: JSON.parse(r.loser) })) })
})

sync.post('/sync/conflicts/:id/reviewed', requirePerm('configure_catalog'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const r = db.prepare("UPDATE sync_conflicts SET status='revisado', reviewed_by=?, reviewed_at=? WHERE id=? AND business_id=? AND status='pendiente'").run(u.id, iso(now()), c.req.param('id'), u.business_id)
  if (!r.changes) throw notFound('No se encontró ese conflicto pendiente.')
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'sync.conflicto_revisado', entity: 'sync_conflict', entityId: c.req.param('id') })
  return c.json({ ok: true })
})

// Vista del dueño desde cualquier lugar: lo que ya llegó a la nube, hoy.
sync.get('/dashboard', requirePerm('view_reports'), (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now())
  // Dueño: todas las sucursales; los demás: solo la suya.
  const br = scopeBranch(c)
  const branches = db
    .prepare(
      `SELECT b.id AS branchId, b.name,
        COALESCE(SUM(CASE WHEN s.status='completada' THEN s.total END),0) AS sales,
        COALESCE(SUM(CASE WHEN s.status='completada' THEN 1 END),0) AS tickets,
        COALESCE(SUM(CASE WHEN s.status='cancelada' THEN 1 END),0) AS cancelled
       FROM branches b
       LEFT JOIN shifts sh ON sh.branch_id = b.id AND sh.opened_date = ?
       LEFT JOIN sales s ON s.shift_id = sh.id
       WHERE b.business_id = ? ${br ? 'AND b.id = ?' : ''} GROUP BY b.id ORDER BY b.name`,
    )
    .all(day, u.business_id, ...(br ? [br] : []))
  const openShifts = db
    .prepare(`SELECT sh.id, sh.branch_id AS branchId, us.name AS cashier, sh.opened_at AS openedAt FROM shifts sh JOIN users us ON us.id = sh.cashier_id WHERE sh.business_id = ? AND sh.status = 'abierto' ${br ? 'AND sh.branch_id = ?' : ''}`)
    .all(u.business_id, ...(br ? [br] : []))
  // Los choques de edición son del negocio completo: en un negocio con varias sucursales solo los ve el dueño.
  const pending = u.role !== 'owner' && isMultiBranch(db, u.business_id) ? 0 : (db.prepare("SELECT COUNT(*) n FROM sync_conflicts WHERE business_id = ? AND status = 'pendiente'").get(u.business_id) as { n: number }).n
  return c.json({ date: day, branches, openShifts, pendingConflicts: pending, asOf: iso(now()) })
})
