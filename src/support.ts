import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { limits, type BusinessRow } from './billing.js'
import { body, ownerOnly, parse, type C, type Env } from './context.js'
import type { Db } from './db.js'
import { conflict, iso, newId, notFound } from './util.js'

export function ticketView(db: Db, id: string) {
  const t = db.prepare('SELECT id, type, subject, module, status, created_at AS createdAt, updated_at AS updatedAt FROM tickets WHERE id = ?').get(id)
  const messages = db.prepare('SELECT author_type AS author, body, created_at AS createdAt FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, rowid').all(id)
  return { ...(t as object), messages }
}

/** Buzón del cliente (privado por negocio): dudas de soporte y solicitudes de cambio. */
export const support = new Hono<Env>()
support.use('/support/*', ownerOnly)

support.get('/support/tickets', (c) => {
  const { db } = c.get('deps')
  const rows = db
    .prepare('SELECT id, type, subject, module, status, updated_at AS updatedAt, unread_by_client AS unread FROM tickets WHERE business_id = ? ORDER BY updated_at DESC')
    .all(c.get('session').user.business_id)
  return c.json({ tickets: rows })
})

support.post('/support/tickets', async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('soporte'), subject: z.string().trim().min(3).max(150), message: z.string().trim().min(1).max(5000) }),
      // Una solicitud de cambio indica el giro o módulo que afecta.
      z.object({ type: z.literal('cambio'), subject: z.string().trim().min(3).max(150), module: z.string().trim().min(2).max(80), message: z.string().trim().min(1).max(5000) }),
    ]),
    await body(c),
  )
  const id = newId()
  const t = iso(now())
  db.transaction(() => {
    db.prepare('INSERT INTO tickets (id, business_id, type, subject, module, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      id, u.business_id, d.type, d.subject, d.type === 'cambio' ? d.module : null, d.type === 'cambio' ? 'enviada' : 'abierto', u.id, t, t,
    )
    db.prepare("INSERT INTO ticket_messages (id, ticket_id, author_type, author_id, body, created_at) VALUES (?,?,'cliente',?,?,?)").run(newId(), id, u.id, d.message, t)
  })()
  return c.json({ ticket: ticketView(db, id) }, 201)
})

function loadTicket(c: C) {
  const t = c.get('deps').db.prepare('SELECT * FROM tickets WHERE id = ? AND business_id = ?').get(c.req.param('id'), c.get('session').user.business_id) as { id: string; type: string; status: string } | undefined
  if (!t) throw notFound()
  return t
}

support.get('/support/tickets/:id', (c) => {
  const t = loadTicket(c)
  c.get('deps').db.prepare('UPDATE tickets SET unread_by_client = 0 WHERE id = ?').run(t.id)
  return c.json({ ticket: ticketView(c.get('deps').db, t.id) })
})

support.post('/support/tickets/:id/messages', async (c) => {
  const { db, now } = c.get('deps')
  const t = loadTicket(c)
  const d = parse(z.object({ message: z.string().trim().min(1).max(5000) }), await body(c))
  const ts = iso(now())
  db.prepare("INSERT INTO ticket_messages (id, ticket_id, author_type, author_id, body, created_at) VALUES (?,?,'cliente',?,?,?)").run(newId(), t.id, c.get('session').user.id, d.message, ts)
  // Si el cliente vuelve a escribir en un caso cerrado o respondido, se reabre.
  const status = t.type === 'soporte' ? 'abierto' : t.status
  db.prepare('UPDATE tickets SET updated_at = ?, unread_by_support = 1, status = ? WHERE id = ?').run(ts, status, t.id)
  return c.json({ ticket: ticketView(db, t.id) }, 201)
})

/** Sucursales: el dueño las crea dentro de lo que su plan permite. */
export const branches = new Hono<Env>()

branches.get('/branches', (c) => {
  const rows = c.get('deps').db.prepare('SELECT id, name, active FROM branches WHERE business_id = ? ORDER BY created_at').all(c.get('session').user.business_id)
  return c.json({ branches: rows })
})

branches.post('/branches', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ name: z.string().trim().min(2).max(80) }), await body(c))
  const b = db.prepare('SELECT * FROM businesses WHERE id = ?').get(u.business_id) as BusinessRow
  const lim = limits({ plan: b.plan, extraBranches: b.extra_branches, extraUserPacks: b.extra_user_packs })
  const n = (db.prepare('SELECT COUNT(*) n FROM branches WHERE business_id = ? AND active = 1').get(u.business_id) as { n: number }).n
  if (n >= lim.branches) throw conflict('Tu plan no incluye más sucursales. Pide una sucursal adicional desde el buzón.', 'limite_sucursales')
  const id = newId()
  db.prepare('INSERT INTO branches (id, business_id, name, created_at) VALUES (?,?,?,?)').run(id, u.business_id, d.name, iso(now()))
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'sucursal.alta', entity: 'branch', entityId: id, newValue: { name: d.name } })
  return c.json({ branch: { id, name: d.name, active: 1 } }, 201)
})
