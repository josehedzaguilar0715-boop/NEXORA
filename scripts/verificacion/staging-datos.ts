// Prueba funcional de «Respaldo y exportación de datos» contra un servidor real (staging). Crea dos negocios de prueba
// nuevos (no toca otros). Uso: npx tsx scripts/verificacion/staging-datos.ts https://nexora-staging.….workers.dev
import { randomUUID } from 'node:crypto'
const base = process.argv[2]
if (!base || /\/\/nexora\.[^/]*workers\.dev/.test(base)) throw new Error('Uso: staging-datos.ts <url de STAGING> (nunca producción: crea negocios de prueba)')
let fails = 0
const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const call = async (m: string, p: string, token?: string, body?: unknown) => {
  const r = await fetch(`${base}/api${p}`, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json: any = null; try { json = JSON.parse(text) } catch { /* no es JSON */ }
  return { status: r.status, json, text }
}
const tag = String(Date.now()).slice(-8)
const mk = async (name: string, phone: string) => {
  const r = (await call('POST', '/auth/register', undefined, { businessName: name, ownerName: 'Prueba', phone, password: 'secreto123' })).json
  if (!r.token) throw new Error('El registro pide código (SMS): este script solo sirve donde no hay SMS. ' + JSON.stringify(r).slice(0, 100))
  await call('PATCH', '/business', r.token, { forcePasswordChange: false })
  const me = (await call('GET', '/auth/me', r.token)).json.user
  await call('PUT', `/users/${me.id}/auth-code`, r.token, { code: '4321' })
  return { T: r.token as string, id: r.business.id as string, code: r.business.code as string }
}
const A = await mk('Prueba Datos A', `55${tag}`), B = await mk('Prueba Datos B', `56${tag}`)
const prod = (await call('POST', '/products', A.T, { name: 'Arroz', unit: 'pieza', price: 3000, barcode: `75${tag}` })).json.product
await call('POST', '/purchases', A.T, { payment: 'contado', items: [{ productId: prod.id, quantity: 20, cost: 20000 }] })
await call('POST', '/shifts/open', A.T, { openingFloat: 10000 })
for (let i = 0; i < 2; i++) await call('POST', '/sales', A.T, { id: randomUUID(), paymentMethod: 'efectivo', items: [{ productId: prod.id, quantity: 2 }] })
const cust = (await call('POST', '/customers', A.T, { name: 'Cliente Prueba', phone: '9611110000' })).json.customer
await call('POST', '/expenses', A.T, { concept: 'Luz', amount: 500, kind: 'variable', method: 'efectivo' })
await call('POST', '/products', B.T, { name: 'Producto de B', unit: 'pieza', price: 100 })

// Exportar
const ex = await call('GET', '/data/export', A.T)
const file = JSON.parse(ex.text)
ok(ex.status === 200 && file.format === 'nexora-negocio' && file.manifest.businessId === A.id && file.manifest.counts.sales === 2, `exporta su negocio (${file.manifest?.counts?.sales} ventas, esquema ${file.manifest?.schemaVersion})`)
ok(!ex.text.match(/s1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/) && !JSON.stringify(file.tables).match(/password_hash|token_hash|code_hash/) && !file.tables.sessions, 'sin contraseñas, hashes ni sesiones')
ok(!ex.text.includes('Producto de B') && file.tables.businesses.length === 1, 'no incluye nada del otro negocio')
const info = (await call('GET', '/data/info', A.T)).json
ok(info.lastExport?.at && info.contains.sales === 2, 'consulta cuándo se generó y qué contiene')
// Respaldo por negocio
const bk = await call('POST', '/data/backups', A.T)
ok(bk.status === 201, `respaldo manual del negocio (${bk.json?.backup?.bytes} bytes${bk.status === 409 ? ' — KV no configurado' : ''})`)
const list = (await call('GET', '/data/info', A.T)).json.backups
const id = list[0]?.id
const ver = await call('POST', `/data/backups/${id}/verify`, A.T)
ok(ver.json?.valid === true, 'verifica la integridad del respaldo guardado')
ok((await call('POST', `/data/backups/${id}/verify`, B.T)).status === 404, 'otro negocio NO puede verificar ese respaldo (404)')
ok((await call('POST', '/data/import/preview', B.T, { backupId: id })).status === 404, 'otro negocio NO puede restaurar ese respaldo (404)')
// Importación
const sim = (await call('POST', '/data/import/preview', A.T, { file })).json.report
ok(sim.ok && sim.totals.insert === 0 && sim.totals.same > 0, `simulación sobre sí mismo: nada que agregar (${sim.totals.same} ya están)`)
ok((await call('POST', '/data/import/preview', A.T, { backupId: id })).json.report.ok, 'simula desde el respaldo guardado')
const other = JSON.parse((await call('GET', '/data/export', B.T)).text)
const rej = (await call('POST', '/data/import/preview', A.T, { file: other })).json.report
ok(!rej.ok && /OTRO negocio/.test(rej.errors.join(' ')), 'rechaza el archivo de otro negocio')
const hack = structuredClone(file); hack.tables.products[0].name = 'Alterado'
ok(!(await call('POST', '/data/import/preview', A.T, { file: hack })).json.report.ok, 'rechaza un archivo alterado')
ok((await call('POST', '/data/import/confirm', A.T, { file, sha256: file.sha256 })).status === 400, 'confirmar exige la palabra RESTAURAR')
await call('PATCH', `/customers/${cust.id}`, A.T, { name: 'Cliente Renombrado' })
const conf = await call('POST', '/data/import/confirm', A.T, { file, sha256: file.sha256, confirm: 'RESTAURAR' })
ok(conf.status === 200 && conf.json.report.totals.insert === 0 && conf.json.report.totals.differs >= 1, 'restaurar no sobrescribe lo modificado después del respaldo')
ok((await call('GET', `/customers/${cust.id}/credit`, A.T)).status === 200 && JSON.stringify((await call('GET', '/customers', A.T)).json).includes('Cliente Renombrado'), 'el dato nuevo se conservó')
// Permisos
const emp = (await call('POST', '/users', A.T, { name: 'Empleada', username: `emp${tag}`, password: 'inicial123', template: 'cajero' })).json.user
const el = (await call('POST', '/auth/login', undefined, { businessCode: A.code, username: `emp${tag}`, password: 'inicial123' })).json
ok(emp && (await call('GET', '/data/export', el.token)).status === 403 && (await call('POST', '/data/import/preview', el.token, { file })).status === 403, 'un empleado no puede exportar ni restaurar (403)')
ok((await call('GET', '/admin/salud', A.T)).status === 401 && (await call('PUT', '/admin/flags/importar_respaldo', A.T, { enabled: false })).status === 401, 'un dueño no ve la salud ni los interruptores del super panel (401)')
const h = (await call('GET', '/health')).json
ok(h.ok && typeof h.schema === 'number', `salud pública: esquema ${h.schema}`)
console.log(fails ? `\n${fails} verificación(es) fallaron` : '\nTodo en orden')
process.exit(fails ? 1 : 0)
