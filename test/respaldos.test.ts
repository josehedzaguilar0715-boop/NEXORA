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
    expect([...store.files.keys()].sort()).toEqual(['nexora-2026-11-17T09-17.json.gz', 'nexora-2026-11-18T09-17.json.gz'])

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
