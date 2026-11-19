// Prueba rápida de un servidor ya levantado (local con wrangler dev, o staging).
// Uso: tsx scripts/smoke.ts http://localhost:8798 /ruta/al/log   (el código de verificación se lee del log)
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const [base, logFile] = process.argv.slice(2)
if (!base || !logFile) throw new Error('Uso: tsx scripts/smoke.ts <url> <archivo-de-log>')
let token = ''
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = (await r.json()) as any
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`)
  return j
}
const ok = (c: unknown, what: string) => { if (!c) throw new Error(`Falló: ${what}`); console.log(`✓ ${what}`) }
const phone = `55${String(Date.now()).slice(-8)}`
const reg = await call('POST', '/auth/register', { businessName: 'Tienda de prueba', ownerName: 'Prueba', phone, password: 'secreto123' })
await new Promise((r) => setTimeout(r, 500))
const code = [...readFileSync(logFile, 'utf8').matchAll(new RegExp(`${phone}: (\\d{6})`, 'g'))].at(-1)?.[1]
ok(code, 'el código de verificación se envió (aparece en el registro)')
token = (await call('POST', '/auth/register/verify', { challengeId: reg.challengeId, code })).token
ok(token, 'registro del dueño con código')
const me = await call('GET', '/auth/me')
await call('PUT', `/users/${me.user.id}/auth-code`, { code: '4321' })
const p = (await call('POST', '/products', { name: 'Refresco', unit: 'pieza', price: 1850, barcode: `75${Date.now()}` })).product
await call('POST', '/purchases', { payment: 'contado', items: [{ productId: p.id, quantity: 10, cost: 10000 }], freight: [{ concept: 'Gasolina', amount: 500 }] })
await call('POST', '/shifts/open', { openingFloat: 50000 })
const saleId = randomUUID()
const sale = (await call('POST', '/sales', { id: saleId, paymentMethod: 'efectivo', cashReceived: 5000, items: [{ productId: p.id, quantity: 2 }] })).sale
ok(sale.total === 3700 && sale.change === 1300, 'venta con cambio')
ok((await call('POST', '/sales', { id: saleId, paymentMethod: 'efectivo', items: [{ productId: p.id, quantity: 2 }] })).duplicate, 'la misma venta no se cobra dos veces')
const t = await call('GET', `/sales/${sale.id}/ticket`)
ok(t.text.includes('$37.00'), 'ticket')
await call('POST', `/sales/${sale.id}/cancel`, { reason: 'Prueba de cancelación', authCode: '4321' })
const cur = await call('GET', '/shifts/current')
ok(cur.totals.expectedCash === 50000, 'cancelación con código y corte correcto')
await call('POST', `/shifts/${cur.shift.id}/close`, { countedCash: 50000 })
ok((await call('GET', `/products/${p.id}`)).product.stock === 10, 'inventario de vuelta tras cancelar')
const cli = (await call('POST', '/customers', { name: 'Cliente QR' })).customer
const qr = await fetch(`${base}/api/public/qr/${cli.code}.svg`)
ok(qr.ok && (await qr.text()).includes('<svg'), 'QR del cliente')
const page = await fetch(`${base}/admin`)
ok(page.ok && (await page.text()).includes('NEXORA'), 'pantallas servidas (super panel en /admin)')
console.log('Prueba rápida: OK')
