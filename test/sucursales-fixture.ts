import { negocioListo } from './helpers.js'

/**
 * Negocio con DOS sucursales y personal en cada una, con datos reales en las dos.
 *   sucursal 1 (principal): dueño, encargado enc1, empleados e1a y e1b
 *   sucursal 2:             encargado enc2, empleado e2
 * Las ventas, cajas, compras, gastos, citas, cuentas de mesa y apartados de la sucursal 1 llevan identificadores
 * que NO deben aparecer jamás para quien trabaja en la sucursal 2 (y los de un empleado, para otro empleado).
 */
export async function dosSucursales() {
  const n = await negocioListo()
  const { s, o, T } = n
  s.db.prepare("UPDATE businesses SET extra_branches = 1, plan = 'profesional'").run() // 2 sucursales y hasta 10 usuarios
  const owner = (await s.call('GET', '/auth/me', { token: T })).json.user
  const b1: string = owner.branchId
  const b2 = (await s.call('POST', '/branches', { token: T, body: { name: 'Sucursal Centro' } })).json.branch?.id as string
  const mk = async (username: string, template: string, branchId: string, extra: Record<string, unknown> = {}) => {
    const u = await s.createStaff(T, o.business.code, username, template, { branchId, ...extra })
    if (!u.token) throw new Error(`No pudo entrar ${username}`)
    return u
  }
  const enc1 = await mk('enc1', 'encargado', b1)
  const enc2 = await mk('enc2', 'encargado', b2)
  const e1a = await mk('emp1a', 'cajero', b1, { permissions: ['sell', 'open_close_cash', 'customers_credit'] })
  const e1b = await mk('emp1b', 'cajero', b1, { permissions: ['sell', 'open_close_cash', 'customers_credit'] })
  const e2 = await mk('emp2', 'cajero', b2, { permissions: ['sell', 'open_close_cash', 'customers_credit'] })
  for (const u of [enc1, enc2]) await s.call('PUT', `/users/${u.id}/auth-code`, { token: T, body: { code: '4321' } })

  const call = (tok: string, m: string, p: string, body?: object) => s.call(m, p, { token: tok, body })
  // Producto compartido; existencia en cada sucursal (el dueño compra indicando la sucursal).
  const prod = (await call(T, 'POST', '/products', { name: 'Arroz', unit: 'pieza', price: 3000, barcode: '7501234567890' })).json.product
  const buy = (branchId: string, qty: number) => call(T, 'POST', '/purchases', { branchId, payment: 'contado', items: [{ productId: prod.id, quantity: qty, cost: qty * 1000 }] })
  const purchase1 = (await buy(b1, 20)).json
  const purchase2 = (await buy(b2, 20)).json

  // Ventas: e1a y e1b en la sucursal 1; e2 en la 2.
  const open = async (u: { token: string }, fondo = 10000) => (await call(u.token, 'POST', '/shifts/open', { openingFloat: fondo })).json.shift
  const sell = async (u: { token: string }, qty: number, extra: object = {}) => (await call(u.token, 'POST', '/sales', { id: s.uuid(), paymentMethod: 'efectivo', items: [{ productId: prod.id, quantity: qty }], ...extra })).json.sale
  const shift1a = await open(e1a); const sale1a = await sell(e1a, 2) // $60
  const shift1b = await open(e1b); const sale1b = await sell(e1b, 3) // $90
  const shift2 = await open(e2); const sale2 = await sell(e2, 1) // $30
  const exp1 = (await call(T, 'POST', '/expenses', { branchId: b1, concept: 'Luz sucursal 1', amount: 500, kind: 'variable', method: 'transferencia' })).json
  const exp2 = (await call(T, 'POST', '/expenses', { branchId: b2, concept: 'Luz sucursal 2', amount: 700, kind: 'variable', method: 'transferencia' })).json
  const customer = (await call(T, 'POST', '/customers', { name: 'Cliente Común', phone: '9611110000' })).json.customer
  return { ...n, owner, b1, b2, enc1, enc2, e1a, e1b, e2, prod, purchase1, purchase2, shift1a, shift1b, shift2, sale1a, sale1b, sale2, exp1, exp2, customer, call, open, sell }
}
