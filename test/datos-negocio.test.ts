import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { runBackup, type BackupStore } from '../src/backup.js'
import { buildExport, restoreBusiness, uncoveredTables } from '../src/datos.js'
import { openDb } from '../src/db-node.js'
import { DEMOS } from '../src/demo.js'
import { healthReport, recordError } from '../src/monitor.js'
import { negocioListo, setup } from './helpers.js'
import { dosSucursales } from './sucursales-fixture.js'

const memory = (): BackupStore & { files: Map<string, Uint8Array> } => {
  const files = new Map<string, Uint8Array>()
  return { files, async put(n, b) { files.set(n, b) }, async list() { return [...files].map(([name, b]) => ({ name, size: b.length })) }, async get(n) { return files.get(n) ?? null }, async remove(n) { files.delete(n) } }
}
// Al restaurar un usuario que faltaba se le obliga a cambiar contraseña (no se exportan contraseñas): es lo único que difiere.
const sortedTables = (tables: Record<string, Record<string, unknown>[]>) => Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => JSON.stringify(k === 'users' ? { ...r, must_change_password: 0 } : r)).sort()]))

/** Negocio con datos reales de prueba en varias áreas: ventas, caja, fiado, compras, gastos, personal, sucursales. */
async function conDatos() {
  const f = await dosSucursales()
  await f.call(f.T, 'POST', `/customers/${f.customer.id}/credit-charges`, { id: f.s.uuid(), amount: 12000, note: 'Deuda anterior' })
  await f.call(f.e1a.token, 'POST', `/customers/${f.customer.id}/credit-payments`, { id: f.s.uuid(), amount: 2000, method: 'efectivo' })
  return f
}

describe('exportación de un negocio', () => {
  it('trae todo el negocio, dice de quién es y cuándo se generó, y no incluye contraseñas, tokens ni sesiones', async () => {
    const f = await conDatos()
    const r = await f.s.app.request('/data/export', { headers: { authorization: `Bearer ${f.T}` } })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="nexora-.*\.json"/)
    const text = await r.text()
    const file = JSON.parse(text)
    expect(file.manifest).toMatchObject({ businessId: f.owner.id ? file.manifest.businessId : '', schemaVersion: expect.any(Number) })
    expect(file.manifest.exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    for (const t of ['businesses', 'branches', 'users', 'products', 'sales', 'sale_items', 'sale_payments', 'shifts', 'purchases', 'expenses', 'customers', 'credit_ledger', 'lots', 'stock_movements', 'audit_log'])
      expect(file.tables[t]?.length, t).toBeGreaterThan(0)
    // Sin secretos.
    expect(text).not.toMatch(/s1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/) // formato de hash de contraseña/código
    expect(JSON.stringify(file.tables)).not.toMatch(/password_hash|auth_code_hash|token_hash|code_hash/) // los nombres solo aparecen en el resumen de lo excluido
    expect(file.tables.sessions).toBeUndefined(); expect(file.tables.trusted_devices).toBeUndefined(); expect(file.tables.admins).toBeUndefined()
    // Solo de este negocio (hay otros en la base: se crea uno aparte).
    const otro = setup(); await otro.registerOwner('5599990000')
    expect(file.tables.businesses).toHaveLength(1)
    // La exportación queda registrada y consultable.
    const info = (await f.s.call('GET', '/data/info', { token: f.T })).json
    expect(info.lastExport.at).toBe(file.manifest.exportedAt.slice(0, 19) + file.manifest.exportedAt.slice(19)) 
    expect(info.contains.sales).toBe(file.manifest.counts.sales)
  })

  it('cubre todas las tablas: ninguna queda fuera por accidente y los totales por negocio suman la tabla completa', async () => {
    const f = await conDatos()
    expect(uncoveredTables(f.s.db)).toEqual([])
    const id = (f.s.db.prepare('SELECT id FROM businesses').get() as any).id
    const counts = buildExport(f.s.db, id, new Date()).manifest.counts
    for (const [tabla, n] of Object.entries(counts)) expect(f.s.db.prepare(`SELECT COUNT(*) n FROM "${tabla}"`).get(), tabla).toEqual({ n })
    // Y no falta ninguna tabla con datos del negocio.
    const all = (f.s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map((r) => r.name)
    const conDatosTabla = all.filter((n) => (f.s.db.prepare(`SELECT COUNT(*) n FROM "${n}"`).get() as any).n > 0 && !['_migrations', 'sessions', 'trusted_devices', 'verification_codes', 'push_subscriptions', 'idempotency', 'notification_seen', 'backup_log', 'error_log', 'feature_flags', 'admins', 'admin_sessions', 'admin_challenges', 'app_keys', 'settings'].includes(n))
    expect(conDatosTabla.filter((n) => !(n in counts))).toEqual([])
  })

  it('solo el dueño exporta o restaura; empleados y encargados reciben 403', async () => {
    const f = await dosSucursales()
    for (const u of [f.enc1, f.e1a])
      for (const [m, p, b] of [['GET', '/data/info'], ['GET', '/data/export'], ['POST', '/data/import/preview', { file: {} }], ['POST', '/data/backups']] as [string, string, object?][])
        expect((await f.call(u.token, m, p, b)).status, `${m} ${p}`).toBe(403)
  })

  it('una cuenta vencida todavía puede exportar sus datos (no restaurar)', async () => {
    const f = await dosSucursales()
    f.s.db.prepare("UPDATE businesses SET status = 'vencido', paid_until = '2020-01-01T00:00:00.000Z', trial_ends_at = '2020-01-01T00:00:00.000Z'").run()
    expect((await f.s.call('GET', '/sales', { token: f.T })).status).toBe(402)
    expect((await f.s.call('GET', '/data/export', { token: f.T })).status).toBe(200)
    expect((await f.call(f.T, 'POST', '/data/import/preview', { file: {} })).status).toBe(402)
  })
})

describe('restauración completa sin pérdida', () => {
  it('un negocio con ventas, caja, fiado, inventario, compras, personal y sucursales se carga en una base vacía idéntico y sin referencias rotas', async () => {
    const f = await conDatos()
    const a = buildExport(f.s.db, f.owner.id ? (f.s.db.prepare('SELECT id FROM businesses').get() as any).id : '', new Date())
    const B = openDb(':memory:')
    const rep = restoreBusiness(B, a, a.manifest.businessId, { dryRun: false })
    expect(rep.errors).toEqual([]); expect(rep.warnings).toEqual([]); expect(rep.ok).toBe(true)
    expect(rep.totals.insert).toBe(Object.values(a.manifest.counts).reduce((x, y) => x + y, 0))
    expect(B.pragma('foreign_key_check')).toEqual([])
    const b = buildExport(B, a.manifest.businessId, new Date())
    expect(b.manifest.counts).toEqual(a.manifest.counts)
    expect(sortedTables(b.tables)).toEqual(sortedTables(a.tables)) // renglón por renglón, mismos identificadores y fechas
    // Integridad de dinero e inventario.
    const q = (d: typeof B, sql: string) => d.prepare(sql).get()
    for (const sql of ['SELECT SUM(total) v FROM sales', 'SELECT SUM(amount) v FROM sale_payments', 'SELECT SUM(delta) v FROM credit_ledger', 'SELECT SUM(qty_milli) v FROM stock_movements', 'SELECT SUM(amount) v FROM expenses', 'SELECT COUNT(*) v FROM shifts'])
      expect(q(B, sql), sql).toEqual(q(f.s.db, sql))
    // Repetirla no cambia nada (no duplica).
    const again = restoreBusiness(B, a, a.manifest.businessId, { dryRun: false })
    expect(again.totals.insert).toBe(0); expect(again.totals.same + again.totals.differs).toBe(rep.totals.insert)
    expect(again.totals.differs).toBe(6) // solo los 6 usuarios (se restauraron con «cambiar contraseña»); nada se sobrescribe
  })

  it('los 13 giros: cada demo se exporta y se restaura idéntica', async () => {
    const s = setup(); const at = await s.adminToken()
    for (const d of DEMOS) {
      const r = await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
      const id = (s.db.prepare('SELECT id FROM businesses WHERE giro = ?').get(d.giro) as any).id as string
      void r
      const a = buildExport(s.db, id, new Date())
      const B = openDb(':memory:')
      const rep = restoreBusiness(B, a, id, { dryRun: false })
      expect(rep.errors, d.giro).toEqual([])
      expect(B.pragma('foreign_key_check'), d.giro).toEqual([])
      const b = buildExport(B, id, new Date())
      expect(sortedTables(b.tables), d.giro).toEqual(sortedTables(a.tables))
      expect(Object.keys(a.tables).length, d.giro).toBeGreaterThan(8)
    }
  }, 180_000)
})

describe('importación segura: simulación, confirmación y protección de datos nuevos', () => {
  it('simula primero, exige confirmación explícita, solo agrega lo que falta y conserva lo nuevo', async () => {
    const f = await conDatos()
    const T = f.T
    const file = JSON.parse(await (await f.s.app.request('/data/export', { headers: { authorization: `Bearer ${T}` } })).text())
    // Simulación sobre el mismo negocio: nada que agregar.
    const sim0 = (await f.call(T, 'POST', '/data/import/preview', { file })).json.report
    expect(sim0.ok).toBe(true); expect(sim0.totals.insert).toBe(0)
    // Se pierde información (como si se hubiera borrado por error) y se registra algo nuevo después del respaldo.
    f.s.db.exec('PRAGMA foreign_keys = OFF')
    f.s.db.prepare("DELETE FROM products WHERE name = 'Arroz'").run()
    f.s.db.exec('PRAGMA foreign_keys = ON')
    const nuevo = (await f.call(T, 'POST', '/products', { name: 'Producto nuevo', unit: 'pieza', price: 500 })).json.product
    await f.call(T, 'PATCH', `/customers/${f.customer.id}`, { name: 'Cliente Renombrado' })
    const sim = (await f.call(T, 'POST', '/data/import/preview', { file })).json.report
    expect(sim.ok).toBe(true); expect(sim.totals.insert).toBeGreaterThan(0)
    // La simulación no cambió nada.
    expect(f.s.db.prepare("SELECT COUNT(*) n FROM products WHERE name = 'Arroz'").get()).toEqual({ n: 0 })
    // Sin la palabra de confirmación o con otro archivo: se rechaza.
    expect((await f.call(T, 'POST', '/data/import/confirm', { file, sha256: file.sha256 })).status).toBe(400)
    expect((await f.call(T, 'POST', '/data/import/confirm', { file, sha256: 'x'.repeat(64), confirm: 'RESTAURAR' })).status).toBe(409)
    expect(f.s.db.prepare("SELECT COUNT(*) n FROM products WHERE name = 'Arroz'").get()).toEqual({ n: 0 })
    // Confirmada: vuelve lo que faltaba.
    const done = await f.call(T, 'POST', '/data/import/confirm', { file, sha256: file.sha256, confirm: 'RESTAURAR' })
    expect(done.status).toBe(200); expect(done.json.report.totals.insert).toBe(sim.totals.insert)
    expect(f.s.db.prepare("SELECT COUNT(*) n FROM products WHERE name = 'Arroz'").get()).toEqual({ n: 1 })
    // Lo nuevo y lo modificado después NO se sobrescribe.
    expect(f.s.db.prepare('SELECT name FROM products WHERE id = ?').get(nuevo.id)).toEqual({ name: 'Producto nuevo' })
    expect(f.s.db.prepare('SELECT name FROM customers WHERE id = ?').get(f.customer.id)).toEqual({ name: 'Cliente Renombrado' })
    expect(done.json.report.totals.differs).toBeGreaterThan(0)
    // Queda en la bitácora.
    expect(JSON.stringify((await f.s.call('GET', '/audit', { token: T })).json)).toContain('datos.restaurar')
  })

  it('rechaza archivos de otro negocio, alterados o con relaciones rotas, y no modifica nada', async () => {
    const f = await conDatos()
    const mine = JSON.parse(await (await f.s.app.request('/data/export', { headers: { authorization: `Bearer ${f.T}` } })).text())
    // Otro negocio en la misma base.
    const o = await f.s.registerOwner('5588887777')
    const theirs = JSON.parse(await (await f.s.app.request('/data/export', { headers: { authorization: `Bearer ${o.token}` } })).text())
    const sinBitacora = () => { const x = sortedTables(buildExport(f.s.db, mine.manifest.businessId, new Date()).tables); delete (x as any).audit_log; return JSON.stringify(x) } // la bitácora sí crece: registra cada intento
    const antes = sinBitacora()
    const r1 = (await f.call(f.T, 'POST', '/data/import/preview', { file: theirs })).json.report
    expect(r1.ok).toBe(false); expect(r1.errors.join(' ')).toMatch(/OTRO negocio/)
    // Alterado: la huella no coincide.
    const hack = structuredClone(mine); hack.tables.products[0].name = 'Alterado'
    expect((await f.call(f.T, 'POST', '/data/import/preview', { file: hack })).json.report.errors.join(' ')).toMatch(/huella|dañado/)
    // Intento de meter filas de otro negocio dentro de un archivo propio (con huella recalculada): se rechaza.
    const mezcla = structuredClone(mine); mezcla.tables.products.push({ ...mezcla.tables.products[0], id: 'zzz', business_id: o.business.id })
    mezcla.manifest.counts.products++
    const { createHash } = await import('node:crypto')
    mezcla.sha256 = createHash('sha256').update(JSON.stringify({ manifest: mezcla.manifest, tables: mezcla.tables })).digest('hex')
    expect((await f.call(f.T, 'POST', '/data/import/preview', { file: mezcla })).json.report.errors.join(' ')).toMatch(/otro negocio/)
    // Relaciones rotas (una venta que apunta a un turno inexistente) con huella válida: todo o nada.
    const rota = structuredClone(mine)
    rota.tables.sales.push({ ...rota.tables.sales[0], id: 'venta-rota', shift_id: 'no-existe', folio: 99999 }); rota.manifest.counts.sales++
    rota.sha256 = createHash('sha256').update(JSON.stringify({ manifest: rota.manifest, tables: rota.tables })).digest('hex')
    const r2 = (await f.call(f.T, 'POST', '/data/import/confirm', { file: rota, sha256: rota.sha256, confirm: 'RESTAURAR' }))
    expect(r2.status).toBe(422); expect(r2.json.report.errors.join(' ')).toMatch(/referencias rotas/)
    expect(f.s.db.prepare("SELECT COUNT(*) n FROM sales WHERE id = 'venta-rota'").get()).toEqual({ n: 0 })
    expect(sinBitacora()).toBe(antes)
    // Un archivo que no es de NEXORA.
    expect((await f.call(f.T, 'POST', '/data/import/preview', { file: { hola: 1 } })).json.report.ok).toBe(false)
  })

  it('el interruptor «importar_respaldo» apaga la restauración sin publicar de nuevo', async () => {
    const f = await dosSucursales()
    const at = await f.s.adminToken()
    expect((await f.s.call('PUT', '/admin/flags/importar_respaldo', { token: at, body: { enabled: false } })).status).toBe(200)
    expect((await f.call(f.T, 'POST', '/data/import/preview', { file: {} })).json.error.code).toBe('funcion_desactivada')
    expect((await f.s.call('GET', '/data/export', { token: f.T })).status).toBe(200) // exportar nunca se apaga
    await f.s.call('PUT', '/admin/flags/importar_respaldo', { token: at, body: { enabled: true } })
    expect((await f.call(f.T, 'POST', '/data/import/preview', { file: {} })).status).toBe(200)
  })
})

describe('respaldos automáticos por negocio', () => {
  it('cada negocio tiene su archivo cifrado y su registro; se verifica la integridad; un negocio no ve los del otro', async () => {
    const f = await conDatos()
    const o = await f.s.registerOwner('5577776666')
    const store = memory()
    const key = Buffer.alloc(32, 7).toString('base64')
    const deps = { db: f.s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {} }, backups: store, backupKey: key }
    const app = createApp(deps)
    const call = async (m: string, p: string, token: string, body?: unknown) => { const r = await app.request(p, { method: m, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: (await r.json()) as any } }
    const run = await runBackup(deps, store)
    expect(run.perBusiness).toEqual({ ok: 2, failed: 0 })
    const negocios = [...store.files.keys()].filter((n) => n.startsWith('negocio-'))
    expect(negocios).toHaveLength(2); expect(negocios.every((n) => n.endsWith('.enc'))).toBe(true)
    // Cifrado: no se lee como texto.
    expect(new TextDecoder().decode([...store.files.values()][1]!)).not.toContain('Abarrotes')
    const mine = (await call('GET', '/data/info', f.T)).json
    expect(mine.backups).toHaveLength(1); expect(mine.backups[0]).toMatchObject({ kind: 'automatico', status: 'ok', encrypted: 1 })
    const ver = await call('POST', `/data/backups/${mine.backups[0].id}/verify`, f.T)
    expect(ver.json.valid).toBe(true); expect(ver.json.contains.sales).toBeGreaterThan(0)
    // El otro negocio no puede ni verificar ni restaurar el respaldo ajeno.
    expect((await call('POST', `/data/backups/${mine.backups[0].id}/verify`, o.token)).status).toBe(404)
    expect((await call('POST', '/data/import/preview', o.token, { backupId: mine.backups[0].id })).status).toBe(404)
    // Restaurar desde el respaldo guardado: simulación → nada que agregar.
    expect((await call('POST', '/data/import/preview', f.T, { backupId: mine.backups[0].id })).json.report.totals.insert).toBe(0)
    // Un respaldo dañado se detecta.
    const nombre = (f.s.db.prepare("SELECT name FROM backup_log WHERE id = ?").get(mine.backups[0].id) as any).name
    const bytes = new Uint8Array(store.files.get(nombre)!); bytes[40] = (bytes[40] ?? 0) ^ 0xff; store.files.set(nombre, bytes)
    expect((await call('POST', `/data/backups/${mine.backups[0].id}/verify`, f.T)).json.error.code).toBe('respaldo_danado')
    // Respaldo manual, con límite de frecuencia.
    expect((await call('POST', '/data/backups', f.T)).status).toBe(201)
    expect((await call('POST', '/data/backups', f.T)).status).toBe(429)
    // El respaldo completo diario sigue ahí y queda registrado.
    expect(f.s.db.prepare("SELECT status FROM backup_log WHERE kind = 'completo'").get()).toEqual({ status: 'ok' })
  })

  it('si el almacenamiento falla, el fallo queda registrado, no detiene a los demás y se ve en la salud', async () => {
    const f = await dosSucursales()
    const bad: BackupStore = { ...memory(), async put() { throw new Error('almacenamiento no disponible') } }
    const deps = { db: f.s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {} }, backups: bad }
    await expect(runBackup(deps, bad)).rejects.toThrow()
    expect(f.s.db.prepare("SELECT status, error FROM backup_log WHERE kind = 'completo'").get()).toMatchObject({ status: 'error' })
    const h = healthReport(deps)
    expect(h.status).toBe('critico'); expect(h.issues.join(' ')).toMatch(/respaldo/i)
  })
})

describe('monitoreo', () => {
  it('registra errores sin datos privados, los agrupa, avisa por correo una vez y los muestra en la salud del super panel', async () => {
    const s = setup()
    const sent: string[] = []
    const deps = { db: s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {}, sendEmail: (_to: string, subject: string, text: string) => { sent.push(subject + ' ' + text); return true } } }
    const at = await s.adminToken()
    s.db.prepare("UPDATE admins SET email = 'soporte@example.com'").run()
    const err = { source: 'api' as const, route: 'POST /sales/123e4567-e89b-12d3-a456-426614174000', status: 500, message: 'fallo con maria@example.com tel 5512345678' }
    recordError(deps, err); recordError(deps, err)
    const row = s.db.prepare('SELECT * FROM error_log').get() as any
    expect(row.count).toBe(2); expect(row.route).toBe('POST /sales/:id')
    expect(row.message).not.toMatch(/maria@|5512345678/)
    await new Promise((r) => setTimeout(r, 10))
    expect(sent).toHaveLength(1) // una alerta, no una por repetición
    expect(sent[0]).not.toMatch(/maria@|5512345678/)
    const app = createApp(deps)
    const salud = await (await app.request('/admin/salud', { headers: { authorization: `Bearer ${at}` } })).json() as any
    expect(salud.error ?? salud.status).toBe('critico'); expect(salud.errors24h[0].count).toBe(2); expect(salud.schema.database).toBe(salud.schema.code)
    // Un dueño no ve la salud del sistema.
    const o = await s.registerOwner()
    expect((await s.call('GET', '/admin/salud', { token: o.token })).status).toBe(401)
  })

  it('un error interno real de una ruta se anota solo, sin cuerpos ni datos', async () => {
    const n = await negocioListo()
    n.s.db.exec('ALTER TABLE customers RENAME TO customers_x')
    const r = await n.s.call('GET', '/customers', { token: n.T })
    n.s.db.exec('ALTER TABLE customers_x RENAME TO customers')
    expect(r.status).toBe(500)
    const row = n.s.db.prepare('SELECT source, route, status, message FROM error_log').get() as any
    expect(row).toMatchObject({ source: 'api', route: 'GET /customers', status: 500 })
  })

  it('la salud detecta una venta cuyo total no coincide con sus pagos y una caja olvidada', async () => {
    const f = await dosSucursales()
    const deps = { db: f.s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: { sendCode: () => {} } }
    expect(healthReport(deps).sales.paymentMismatch7d).toBe(0)
    f.s.db.exec('DROP TRIGGER IF EXISTS sale_payments_no_update')
    f.s.db.prepare('UPDATE sale_payments SET amount = amount + 1 WHERE sale_id = ?').run(f.sale1a.id)
    expect(healthReport(deps).sales.paymentMismatch7d).toBe(1)
    expect(healthReport(deps).issues.join(' ')).toMatch(/no coincide/)
  })
})

describe('migración 42', () => {
  it('es aditiva: solo tablas nuevas y el esquema queda en 42', async () => {
    const f = await dosSucursales()
    expect((f.s.db.prepare('SELECT MAX(version) v FROM _migrations').get() as any).v).toBe(42)
    expect((await f.s.app.request('/health')).status).toBe(200)
    expect(await (await f.s.app.request('/health')).json()).toEqual({ ok: true, schema: 42 })
  })
})
