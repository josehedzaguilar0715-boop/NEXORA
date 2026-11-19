import type { Db } from './db.js'
import { iso, newId, type Clock } from './util.js'

export interface AuditEntry {
  businessId: string | null
  userId: string | null
  action: string
  entity?: string
  entityId?: string
  oldValue?: unknown
  newValue?: unknown
  authorizedBy?: string | null
  reason?: string | null
}

const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v))

export function audit(db: Db, now: Clock, e: AuditEntry) {
  db.prepare(
    `INSERT INTO audit_log (id, business_id, user_id, action, entity, entity_id, old_value, new_value, authorized_by, reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(newId(), e.businessId, e.userId, e.action, e.entity ?? null, e.entityId ?? null, j(e.oldValue), j(e.newValue), e.authorizedBy ?? null, e.reason ?? null, iso(now()))
}
