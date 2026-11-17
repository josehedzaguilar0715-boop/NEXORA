import Database from 'better-sqlite3'
import { migrate, type Db } from './db.js'

/** Base local (desarrollo, pruebas y servidor Node) con better-sqlite3. */
export function openDb(path = ':memory:'): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return migrate(db as unknown as Db)
}
