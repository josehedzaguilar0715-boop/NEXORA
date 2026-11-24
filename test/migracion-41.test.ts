import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { openDb } from '../src/db-node.js'

describe('migraciones 41 y 42 (users.position; respaldos, errores e interruptores): compatible con una base que ya tiene datos', () => {
  it('sobre una base en la versión 40 con negocio, personal y ventas: agrega la columna y no cambia ningún dato ni comportamiento', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nx-mig-')), 'v40.db')
    // Base «de producción»: negocio con dueño, empleado y una venta, y esquema detenido en la versión 40.
    let db = openDb(file)
    const app = (d: typeof db) => createApp({ db: d, now: () => new Date(), notifier: { sendCode: () => false, smsEnabled: false } })
    const call = async (a: ReturnType<typeof app>, m: string, p: string, token?: string, body?: unknown) => {
      const r = await a.request(p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
      return { status: r.status, json: (await r.json()) as any }
    }
    let a = app(db)
    const reg = await call(a, 'POST', '/auth/register', undefined, { businessName: 'Negocio Antiguo', ownerName: 'Dueña', phone: '5598765432', password: 'secreto123' })
    const T = reg.json.token as string
    await call(a, 'PATCH', '/business', T, { forcePasswordChange: false })
    const code = (await call(a, 'GET', '/business', T)).json.business?.code ?? (db.prepare('SELECT code FROM businesses').get() as any).code
    const st = await call(a, 'POST', '/users', T, { name: 'Cajera Vieja', username: 'cajeravieja', password: 'inicial123', template: 'cajero' })
    const enc = await call(a, 'POST', '/users', T, { name: 'Jefa Vieja', username: 'jefavieja', password: 'inicial123', template: 'encargado' })
    const antes = db.prepare('SELECT id, role, name, permissions, branch_id FROM users ORDER BY id').all()
    const ventasAntes = db.prepare('SELECT COUNT(*) n FROM sales').get()
    // Regresa la base a la versión 40: sin columna ni registro de la migración 41.
    db.exec('DELETE FROM _migrations WHERE version IN (41, 42); ALTER TABLE users DROP COLUMN position; DROP TABLE backup_log; DROP TABLE error_log; DROP TABLE feature_flags;')
    expect((db.prepare("SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name = 'position'").get() as any).n).toBe(0)
    ;(db as any).close?.()
    // Arranque con el código nuevo: aplica la 41 (columna) y la 42 (tablas de respaldos, errores e interruptores).
    db = openDb(file)
    expect((db.prepare('SELECT MAX(version) v FROM _migrations').get() as any).v).toBe(42)
    expect((db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('backup_log','error_log','feature_flags')").get() as any).n).toBe(3)
    expect((db.prepare("SELECT COUNT(*) n FROM pragma_table_info('users') WHERE name = 'position'").get() as any).n).toBe(1)
    expect(db.prepare('SELECT id, role, name, permissions, branch_id FROM users ORDER BY id').all()).toEqual(antes)
    expect(db.prepare('SELECT COUNT(*) n FROM sales').get()).toEqual(ventasAntes)
    expect((db.prepare('SELECT COUNT(*) n FROM users WHERE position IS NOT NULL').get() as any).n).toBe(0) // nadie cambió de puesto
    // Los usuarios anteriores siguen entrando y se clasifican como siempre.
    a = app(db)
    const lc = await call(a, 'POST', '/auth/login', undefined, { businessCode: code, username: 'cajeravieja', password: 'inicial123' })
    const lj = await call(a, 'POST', '/auth/login', undefined, { businessCode: code, username: 'jefavieja', password: 'inicial123' })
    expect((await call(a, 'GET', '/auth/me', lc.json.token)).json.user.position).toBe('empleado')
    expect((await call(a, 'GET', '/auth/me', lj.json.token)).json.user.position).toBe('encargado')
    // Correr de nuevo el arranque no cambia nada (idempotente).
    expect(st.status).toBe(201); expect(enc.status).toBe(201)
    const dueno = await call(a, 'POST', '/auth/owner/login', undefined, { phone: '5598765432', password: 'secreto123' })
    expect(dueno.status).toBe(200)
  })
})
