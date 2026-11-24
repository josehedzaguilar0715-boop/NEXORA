import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { decryptBackup, isEncrypted, runBackup, type BackupStore } from '../src/backup.js'
import { negocioListo } from './helpers.js'

const memory = (): BackupStore & { files: Map<string, Uint8Array> } => {
  const files = new Map<string, Uint8Array>()
  return { files, async put(n, b) { files.set(n, b) }, async list() { return [...files].map(([name, b]) => ({ name, size: b.length })) }, async get(n) { return files.get(n) ?? null }, async remove(n) { files.delete(n) } }
}

describe('respaldos automáticos', () => {
  it('respalda toda la base comprimida, guarda 30 días y la manda al correo del super panel', async () => {
    const n = await negocioListo()
    const p = await n.product({ name: 'Arroz', unit: 'kg', price: 3000 })
    await n.buy([{ productId: p.id, quantity: 10, cost: 20000 }])
    const store = memory()
    const mails: { to: string; files: number }[] = []
    const deps = { db: n.s.db, now: () => new Date('2026-11-17T09:17:00Z'), notifier: { sendCode: () => {}, sendEmail: (to: string, _s: string, _t: string, att?: unknown[]) => void mails.push({ to, files: att?.length ?? 0 }) } }
    const { createAdmin } = await import('../src/admin.js')
    createAdmin(deps, { name: 'S', username: 'soporte2', password: 'superpanel1', email: 'yo@example.com' })
    const r = await runBackup(deps, store)
    expect(r.name).toBe('nexora-2026-11-17T09-17.json.gz')
    expect(r.emailed).toBe(1)
    expect(mails).toEqual([{ to: 'yo@example.com', files: 1 }])
    // Uno viejo (de hace 40 días) se borra solo.
    await store.put('nexora-2026-10-08T09-17.json.gz', new Uint8Array([1]))
    await runBackup({ ...deps, now: () => new Date('2026-11-18T09:17:00Z') }, store)
    expect([...store.files.keys()].filter((k) => k.startsWith('nexora-')).sort()).toEqual(['nexora-2026-11-17T09-17.json.gz', 'nexora-2026-11-18T09-17.json.gz'])
    expect([...store.files.keys()].filter((k) => k.startsWith('negocio-'))).toHaveLength(2) // además, un archivo por negocio y por día

    // Se puede restaurar: la base reconstruida tiene los mismos datos.
    const dir = mkdtempSync(join(tmpdir(), 'nx-'))
    const file = join(dir, 'r.json.gz')
    writeFileSync(file, store.files.get('nexora-2026-11-17T09-17.json.gz')!)
    execFileSync('npx', ['tsx', 'scripts/restore.ts', file, join(dir, 'nueva.db')], { stdio: 'pipe' })
    const db = new Database(join(dir, 'nueva.db'), { readonly: true })
    expect((db.prepare("SELECT name FROM products").get() as any).name).toBe('Arroz')
    expect((db.prepare('SELECT COUNT(*) n FROM lots').get() as any).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) n FROM audit_log').get() as any).n).toBeGreaterThan(3)
    db.close()
  }, 30_000)

  it('con BACKUP_KEY el respaldo va cifrado: sin la llave no se lee; con ella se restaura completo', async () => {
    const n = await negocioListo()
    const p = await n.product({ name: 'Frijol', unit: 'kg', price: 3800 })
    await n.buy([{ productId: p.id, quantity: 5, cost: 10000 }])
    const store = memory()
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7)).toString('base64')
    const deps = { db: n.s.db, now: () => new Date('2026-11-17T09:17:00Z'), notifier: { sendCode: () => {} }, backupKey: key }
    const r = await runBackup(deps, store)
    expect(r.name).toBe('nexora-2026-11-17T09-17.json.gz.enc')
    const bytes = store.files.get(r.name)!
    expect(isEncrypted(bytes)).toBe(true)
    // No contiene texto legible (ni comprimido reconocible).
    expect(Buffer.from(bytes).includes('Frijol')).toBe(false)
    expect(bytes[4] === 0x1f && bytes[5] === 0x8b).toBe(false)
    // Otra llave no abre.
    await expect(decryptBackup(bytes, Buffer.alloc(32, 1).toString('base64'))).rejects.toThrow()
    // Restaurar: sin llave avisa; con llave queda igual.
    const dir = mkdtempSync(join(tmpdir(), 'nx-'))
    const file = join(dir, r.name)
    writeFileSync(file, bytes)
    expect(() => execFileSync('npx', ['tsx', 'scripts/restore.ts', file, join(dir, 'x.db')], { stdio: 'pipe', env: { ...process.env, NEXORA_BACKUP_KEY: '' } })).toThrow()
    execFileSync('npx', ['tsx', 'scripts/restore.ts', file, join(dir, 'nueva.db')], { stdio: 'pipe', env: { ...process.env, NEXORA_BACKUP_KEY: key } })
    const db = new Database(join(dir, 'nueva.db'), { readonly: true })
    expect((db.prepare('SELECT name FROM products').get() as any).name).toBe('Frijol')
    db.close()
  }, 60_000)

  it('el super panel ve, descarga y crea respaldos; un dueño no', async () => {
    const n = await negocioListo()
    const store = memory()
    const { createApp } = await import('../src/app.js')
    const { createAdmin } = await import('../src/admin.js')
    const deps = { db: n.s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {} }, backups: store }
    const app = createApp(deps)
    createAdmin(deps, { name: 'S', username: 'soporte3', password: 'superpanel1' })
    const req = async (method: string, path: string, token?: string) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === 'POST' && !token ? JSON.stringify({ username: 'soporte3', password: 'superpanel1' }) : undefined })
    const token = ((await (await req('POST', '/admin/login')).json()) as any).token
    const made = (await (await req('POST', '/admin/backups', token)).json()) as any
    expect(made.name).toMatch(/^nexora-/)
    const list = (await (await req('GET', '/admin/backups', token)).json()) as any
    expect(list.backups).toHaveLength(1)
    const dl = await req('GET', `/admin/backups/${made.name}`, token)
    expect(dl.headers.get('content-type')).toBe('application/gzip')
    expect((await dl.arrayBuffer()).byteLength).toBe(made.bytes)
    expect((await req('GET', '/admin/backups', n.T)).status).toBe(401)
  })
})

describe('espacio de la base', () => {
  it('el super panel ve tamaño, tope y meses restantes al ritmo actual', async () => {
    const n = await negocioListo()
    const { createApp } = await import('../src/app.js')
    const { createAdmin } = await import('../src/admin.js')
    const deps = { db: n.s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {} }, dbSize: () => 800 * 1048576 }
    const app = createApp(deps)
    createAdmin(deps, { name: 'S', username: 'soporte9', password: 'superpanel1' })
    const token = ((await (await app.request('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'soporte9', password: 'superpanel1' }) })).json()) as any).token
    const s = (await (await app.request('/admin/storage', { headers: { authorization: `Bearer ${token}` } })).json()) as any
    expect(s).toMatchObject({ bytes: 800 * 1048576, limit: 1024 * 1048576, level: 'aviso' })
    expect(s.pct).toBeCloseTo(78.1, 1)
    // Un dueño no puede verlo.
    expect((await app.request('/admin/storage', { headers: { authorization: `Bearer ${n.T}` } })).status).toBe(401)
  })
})

describe('recuperación dentro del sistema (base vacía)', () => {
  it('un respaldo cifrado se carga completo en una base nueva; en una base con negocios se rechaza sin tocar nada', async () => {
    const n = await negocioListo()
    const p = await n.product({ name: 'Azúcar', unit: 'kg', price: 3200 })
    await n.buy([{ productId: p.id, quantity: 8, cost: 16000 }])
    await n.open(0)
    await n.sell([{ productId: p.id, quantity: 1.5 }])
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i)).toString('base64')
    const { createAdmin: mkAdmin } = await import('../src/admin.js')
    mkAdmin({ db: n.s.db, now: () => new Date('2026-11-17T08:00:00Z'), notifier: { sendCode: () => {} } }, { name: 'S', username: 'soporte-x', password: 'otra-clave-123' })
    const store = memory()
    const count = (db: any, t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n
    const TABLES = ['businesses', 'users', 'products', 'lots', 'sales', 'sale_items', 'sale_payments', 'stock_movements', 'shifts', 'audit_log']
    const at = Object.fromEntries(TABLES.map((x) => [x, count(n.s.db, x)])) // así estaba al respaldar
    const r = await runBackup({ db: n.s.db, now: () => new Date('2026-11-17T09:17:00Z'), notifier: { sendCode: () => {} }, backupKey: key }, store)
    const bytes = store.files.get(r.name)!
    const { importAll, readBackup, keyFingerprint } = await import('../src/backup.js')
    expect(await keyFingerprint(key)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/)
    // Base nueva (como un objeto de Cloudflare recién creado).
    const { openDb } = await import('../src/db-node.js')
    const fresh = openDb(':memory:')
    // Como en Cloudflare: el objeto nuevo crea su usuario de soporte al arrancar y alguien ya entró con él.
    const { createAdmin } = await import('../src/admin.js')
    const fdeps = { db: fresh, now: () => new Date('2026-11-17T10:00:00Z'), notifier: { sendCode: () => {} } }
    createAdmin(fdeps, { name: 'S', username: 'soporte-x', password: 'superpanel1' })
    fresh.prepare("INSERT INTO admin_sessions (id, admin_id, token_hash, created_at, expires_at) SELECT 'ses1', id, 'h', '2026-11-17', '2026-12-17' FROM admins").run()
    const res = importAll(fresh, await readBackup(bytes, key))
    expect(res.rows).toBeGreaterThan(20)
    for (const x of TABLES) expect(count(fresh, x), x).toBe(at[x])
    // La existencia restaurada es la misma.
    const { stockOf } = await import('../src/inventory.js')
    const branch = (n.s.db.prepare('SELECT branch_id FROM lots LIMIT 1').get() as any).branch_id
    expect(stockOf(fresh, branch, p.id)).toBe(stockOf(n.s.db, branch, p.id))
    // Sin llave no se abre; en una base con datos no se carga nada.
    await expect(readBackup(bytes)).rejects.toThrow(/cifrado/)
    const before = count(n.s.db, 'sales')
    expect(() => importAll(n.s.db, { version: 1, tables: { sales: [] } })).toThrow(/base vacía/)
    expect(count(n.s.db, 'sales')).toBe(before)
  })

  it('el super panel muestra si el cifrado está activo y la huella; restaurar en esta base (con negocios) se rechaza', async () => {
    const n = await negocioListo()
    const { createApp } = await import('../src/app.js')
    const { createAdmin } = await import('../src/admin.js')
    const key = Buffer.alloc(32, 7).toString('base64')
    const store = memory()
    const deps = { db: n.s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {} }, backups: store, backupKey: key }
    const app = createApp(deps)
    createAdmin(deps, { name: 'S', username: 'soporte7', password: 'superpanel1' })
    const token = ((await (await app.request('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'soporte7', password: 'superpanel1' }) })).json()) as any).token
    const auth = { authorization: `Bearer ${token}` }
    const made = (await (await app.request('/admin/backups', { method: 'POST', headers: auth })).json()) as any
    expect(made.name).toMatch(/\.enc$/)
    const list = (await (await app.request('/admin/backups', { headers: auth })).json()) as any
    expect(list).toMatchObject({ encrypted: true, keyFingerprint: expect.stringMatching(/^[0-9A-F-]{14}$/) })
    expect(JSON.stringify(list)).not.toContain(key)
    const dl = new Uint8Array(await (await app.request(`/admin/backups/${made.name}`, { headers: auth })).arrayBuffer())
    const r = await app.request('/admin/restore', { method: 'POST', headers: { ...auth, 'content-type': 'application/octet-stream' }, body: dl })
    expect(r.status).toBe(400)
    expect(((await r.json()) as any).error.code).toBe('restauracion_rechazada')
    // Un dueño no puede restaurar.
    expect((await app.request('/admin/restore', { method: 'POST', headers: { authorization: `Bearer ${n.T}` }, body: dl })).status).toBe(401)
  })
})
