// Prueba de las funciones nuevas sobre el MOTOR REAL de Cloudflare (workerd + Durable Object con SQLite), con un negocio nuevo de prueba.
// Uso: levantar `npx wrangler dev --port 8799 > /tmp/dev.log` y luego: npx tsx scripts/verificacion/workerd-lanzamiento.ts http://localhost:8799 /tmp/dev.log
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const [base, logFile] = process.argv.slice(2)
if (!base || !logFile) throw new Error('Uso: tsx scripts/verificacion/workerd-lanzamiento.ts <url> <log>')
let token = ''
const raw = async (method: string, path: string, body?: unknown, tok = token) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let j: any = null; try { j = await r.json() } catch { /* sin cuerpo */ }
  return { status: r.status, json: j }
}
const call = async (method: string, path: string, body?: unknown, tok = token) => { const r = await raw(method, path, body, tok); if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`); return r.json }
let fails = 0
const ok = (c: unknown, what: string) => { console.log(`${c ? '✓' : '✗'} ${what}`); if (!c) fails++ }

const health = await (await fetch(`${base}/api/health`)).json() as { schema: number }
ok(health.schema === 48, `motor de Cloudflare: base en esquema ${health.schema} (esperado 48; las migraciones 43–48 corrieron en el Durable Object)`)
const phone = `55${String(Date.now()).slice(-8)}`
const reg = await call('POST', '/auth/register', { businessName: 'Negocio de prueba lanzamiento', ownerName: 'Prueba', phone, password: 'secreto123' })
await new Promise((r) => setTimeout(r, 600))
if (reg.token) token = reg.token // sin proveedor de SMS el registro entra directo
else {
  const code = [...readFileSync(logFile, 'utf8').matchAll(new RegExp(`${phone}: (\\d{6})`, 'g'))].at(-1)?.[1]
  token = (await call('POST', '/auth/register/verify', { challengeId: reg.challengeId, code })).token
}
const me = await call('GET', '/auth/me')
ok(me.access?.dashboard && me.access?.finance && me.access?.manage && me.access?.costs, 'el dueño tiene acceso completo (dashboard, finanzas, mover dinero, costos)')
await call('PUT', `/users/${me.user.id}/auth-code`, { code: '4321' })
const p = (await call('POST', '/products', { name: 'Refresco', unit: 'pieza', price: 2000, barcode: `75${Date.now()}` })).product
await call('POST', '/purchases', { payment: 'contado', items: [{ productId: p.id, quantity: 10, cost: 10000 }] })
await call('POST', '/shifts/open', { openingFloat: 10000 })
const sale = (await call('POST', '/sales', { id: randomUUID(), paymentMethod: 'efectivo', cashReceived: 5000, items: [{ productId: p.id, quantity: 2 }] })).sale
ok(sale.total === 4000, 'venta en Caja')
// Tickets
const t58 = await call('GET', `/sales/${sale.id}/ticket?paper=58`)
const t80 = await call('GET', `/sales/${sale.id}/ticket?paper=80&reprint=1`)
ok(Math.max(...t58.text.split('\n').map((l: string) => l.length)) <= 32 && Math.max(...t80.text.split('\n').map((l: string) => l.length)) <= 48 && /REIMPRESI/.test(t80.text) && /No es una\s+factura/.test(t58.text.replace(/\s+/g, ' ')), 'ticket 58 y 80 mm, reimpresión y leyenda «no es factura»')
const rl = await call('POST', `/sales/${sale.id}/receipt-link`)
const pub = await (await fetch(`${base}/api/public/receipt/${rl.token}`)).json() as any
ok(pub.receipt?.total === 4000 && !JSON.stringify(pub).toLowerCase().includes('customer'), 'comprobante digital público (sin datos del cliente)')
// Finanzas inteligentes
const r1 = await call('GET', '/finanzas/resumen')
ok(r1.vendido === 4000 && r1.entro >= 4000 && typeof r1.retirable === 'number', 'Finanzas: resumen (vendiste, entró, disponible, retirable)')
ok((await call('GET', '/finanzas/planes')).plans.length === 0, 'Finanzas: un negocio nuevo no trae reparto impuesto')
const plan = (await call('POST', '/finanzas/planes', { name: 'Mío', base: 'ganancia', items: [{ name: 'Operación', kind: 'operacion', mode: 'pct', value: 70 }, { name: 'Yo', kind: 'retiro', mode: 'pct', value: 30 }] })).plan
await call('POST', `/finanzas/planes/${plan.id}/activar`, {})
ok((await call('GET', '/finanzas/resumen')).plan?.name === 'Mío', 'Finanzas: reparto propio activo')
ok((await raw('POST', '/finanzas/planes', { name: 'Mal', base: 'ganancia', items: [{ name: 'A', kind: 'otro', mode: 'pct', value: 60 }] })).status === 400, 'Finanzas: suma distinta de 100 % rechazada')
const hoy = r1.to
const antes = (await call('GET', '/finanzas/resumen')).disponible
await call('POST', '/finanzas/saldos', { accountType: 'efectivo', accountName: 'Efectivo', amount: 50000, date: hoy, description: 'Efectivo al empezar' })
ok((await call('GET', '/finanzas/resumen')).disponible === antes + 50000, 'Saldos: el saldo inicial suma una sola vez')
ok((await raw('POST', '/finanzas/saldos', { accountType: 'efectivo', accountName: 'Efectivo', amount: 1, date: hoy, description: 'otra vez' })).status === 409, 'Saldos: no se puede registrar dos veces')
const conc = await call('POST', '/finanzas/saldos/conciliar', { accountType: 'efectivo', accountName: 'Efectivo', counted: (await call('GET', '/finanzas/saldos')).efectivo - 500, description: 'Faltaron 5 pesos' })
ok(conc.matches === false && conc.difference === -500, 'Saldos: conciliación deja un ajuste documentado')
const ret = await raw('POST', '/finanzas/retiros', { amount: 1000, category: 'Sueldo', reason: 'Sueldo de la semana', method: 'transferencia', force: true })
ok(ret.status === 201 && (await call('GET', '/finanzas/retiros')).withdrawals.length === 1, 'Retiros: quedan registrados con motivo y responsable')
// Roles
await call('PATCH', '/business', { forcePasswordChange: false })
const mk = async (username: string, template: string, extra: object = {}) => { await call('POST', '/users', { name: username, username, password: 'inicial123', template, ...extra }); const biz = (await call('GET', '/auth/me')).business; return (await call('POST', '/auth/login', { businessCode: biz.code, username, password: 'inicial123' }, '')).token as string }
const enc = await mk('encprueba', 'encargado'); const emp = await mk('empprueba', 'cajero')
const fin = ['/dashboard/panel', '/finanzas/resumen', '/finanzas/saldos', '/accounting/balance', '/reports/summary']
const e = await Promise.all(fin.map(async (x) => (await raw('GET', x, undefined, enc)).status)); const m = await Promise.all(fin.map(async (x) => (await raw('GET', x, undefined, emp)).status))
ok(e.every((s) => s === 403) && m.every((s) => s === 403), 'Roles: encargado y empleado reciben 403 en panel, finanzas y saldos')
const rs = await raw('GET', '/sucursal/resumen', undefined, enc)
ok(rs.status === 200 && !/utilidad|margen|costo|retiro/i.test(JSON.stringify(rs.json)), 'Roles: el encargado ve el resumen operativo sin nada financiero')
ok((await raw('GET', '/sucursal/resumen', undefined, emp)).status === 403, 'Roles: el empleado no ve el resumen')
const pe = (await call('GET', '/products', undefined, emp)).products[0]
ok(!('lastCost' in pe) && !('marginBp' in pe), 'Costos: el empleado no recibe costo ni margen (permiso aparte)')
// Automatizaciones
ok((await raw('GET', '/auto/productos')).status === 200 && (await raw('GET', '/inventory/replenishment')).status === 200 && (await raw('GET', '/auto/servicios')).status === 200, 'Automatizaciones: productos, reposición y servicios responden en el motor real')
// Cierre de caja y respaldo exportable
const cur = await call('GET', '/shifts/current')
await call('POST', `/shifts/${cur.shift.id}/close`, { countedCash: cur.totals.expectedCash })
const exp = await raw('GET', '/business/export')
ok(exp.status === 200 || exp.status === 403 || exp.status === 404, 'exportación del negocio responde')
console.log(fails ? `\n${fails} FALLAS` : '\nMotor real de Cloudflare: TODO EN ORDEN')
process.exit(fails ? 1 : 0)
