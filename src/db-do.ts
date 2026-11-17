import { migrate, type Db } from './db.js'

/** Lo mínimo de la API de SQLite de Durable Objects que usamos. */
interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] }
}
interface DurableStorage {
  sql: SqlStorage
  transactionSync<T>(fn: () => T): T
}

/** Base en Cloudflare: SQLite dentro de un Durable Object, con la misma forma síncrona que better-sqlite3. */
export function doDb(storage: DurableStorage): Db {
  const sql = storage.sql
  let depth = 0
  const bind = (params: unknown[]) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p))
  const db: Db = {
    prepare(query) {
      return {
        get: (...p) => sql.exec(query, ...bind(p)).toArray()[0],
        all: (...p) => sql.exec(query, ...bind(p)).toArray(),
        run: (...p) => {
          sql.exec(query, ...bind(p)).toArray()
          return { changes: Number(sql.exec('SELECT changes() AS c').toArray()[0]!.c) }
        },
      }
    },
    exec(query) {
      sql.exec(query).toArray()
    },
    transaction(fn) {
      // Transacciones anidadas: la de afuera manda (si algo falla, se deshace todo).
      return ((...args: unknown[]) => {
        if (depth > 0) return fn(...args)
        return storage.transactionSync(() => {
          depth++
          try {
            return fn(...args)
          } finally {
            depth--
          }
        })
      }) as typeof fn
    },
    pragma(source, options) {
      const rows = sql.exec(`PRAGMA ${source}`).toArray()
      return options?.simple ? (rows[0] ? Object.values(rows[0])[0] : undefined) : rows
    },
  }
  return migrate(db)
}
