// Diagnóstico: ¿qué ve un EMPLEADO al que el dueño le marcó «ver reportes»? (datos de prueba en memoria)
// Uso: npx tsx scripts/verificacion/empleado-con-reportes.ts
import { dosSucursales } from '../../test/sucursales-fixture.js'

const f = await dosSucursales()
const r = await f.s.call('PATCH', `/users/${f.e1a.id}`, { token: f.T, body: { position: 'empleado', permissions: ['sell', 'open_close_cash', 'customers_credit', 'view_reports'] } })
console.log('PATCH puesto empleado + view_reports:', r.status)
const t = f.e1a.token
for (const p of ['/dashboard/panel', '/reports/summary', '/reports/daily?days=7', '/reports/recent?limit=8', '/accounting/income-statement', '/accounting/balance', '/accounting/export', '/expenses', '/fixed-expenses', '/finance/trend', '/inventory/value', '/finance/plan', '/audit', '/users', '/commissions'])
  console.log(String((await f.s.app.request(p, { headers: { authorization: `Bearer ${t}` } })).status).padEnd(4), p)
