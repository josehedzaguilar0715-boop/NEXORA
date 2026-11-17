import type { Db } from '../db.js'
import { randomUUID } from 'node:crypto'

/**
 * Cola local de la caja. Cada operación (abrir caja, vender, retirar, cerrar…) se guarda aquí
 * al momento y se reenvía en orden cuando hay señal. Nada se borra: lo enviado y lo rechazado
 * se conserva. `pending()` alimenta el contador visible de "pendientes de sincronizar".
 */
export interface OutboxRequest { id: string; method: string; path: string; body: unknown }
export type Transport = (req: OutboxRequest) => Promise<{ status: number; json?: unknown }>

export function migrateOutbox(db: Db) {
  db.exec(`CREATE TABLE IF NOT EXISTS outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','enviado','rechazado')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT
  )`)
}

export class Outbox {
  constructor(private db: Db, private now: () => Date = () => new Date()) {
    migrateOutbox(db)
  }

  /** Guarda la operación; `id` es también la llave de idempotencia al enviarla. */
  enqueue(method: string, path: string, body: unknown, id: string = randomUUID()): string {
    this.db.prepare('INSERT INTO outbox (id, method, path, body, created_at) VALUES (?,?,?,?,?)').run(id, method, path, JSON.stringify(body ?? null), this.now().toISOString())
    return id
  }

  pending(): number {
    return (this.db.prepare("SELECT COUNT(*) n FROM outbox WHERE status = 'pendiente'").get() as { n: number }).n
  }

  rejected(): { id: string; method: string; path: string; error: string }[] {
    return this.db.prepare("SELECT id, method, path, error FROM outbox WHERE status = 'rechazado' ORDER BY seq").all() as never
  }

  /**
   * Envía en orden. Sin señal, error del servidor, sesión vencida, cuenta vencida o bloqueo: se detiene y todo queda pendiente.
   * Rechazo definitivo (datos no válidos, caja cerrada…): se marca "rechazado" para revisión y se sigue.
   */
  async flush(send: Transport): Promise<{ sent: number; rejected: number; stopped: boolean }> {
    const rows = this.db.prepare("SELECT * FROM outbox WHERE status = 'pendiente' ORDER BY seq").all() as { id: string; method: string; path: string; body: string }[]
    let sent = 0, rejected = 0
    for (const r of rows) {
      let res: { status: number; json?: unknown }
      this.db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?').run(r.id)
      try {
        res = await send({ id: r.id, method: r.method, path: r.path, body: JSON.parse(r.body) })
      } catch {
        return { sent, rejected, stopped: true } // sin internet
      }
      if (res.status >= 200 && res.status < 300) {
        this.db.prepare("UPDATE outbox SET status = 'enviado', error = NULL WHERE id = ?").run(r.id)
        sent++
      } else if (res.status >= 500 || res.status === 401 || res.status === 402 || res.status === 423) {
        return { sent, rejected, stopped: true }
      } else {
        const msg = (res.json as { error?: { message?: string } } | undefined)?.error?.message ?? `Error ${res.status}`
        this.db.prepare("UPDATE outbox SET status = 'rechazado', error = ? WHERE id = ?").run(msg, r.id)
        rejected++
      }
    }
    return { sent, rejected, stopped: false }
  }
}
