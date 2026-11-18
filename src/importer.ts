import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { customerCode } from './common.js'
import { body, ownerOnly, parse, type Env } from './context.js'
import type { Db } from './db.js'
import { addLot, consume, currentPrice, stockOf, type ProductRow } from './inventory.js'
import { iso, newId } from './util.js'

/**
 * Importar datos de otro sistema o de Excel (productos con existencia, clientes con su fiado y proveedores),
 * para que el negocio no empiece de cero. Llega por partes (hasta 500 filas); cada fila se procesa sola
 * y se puede volver a mandar sin duplicar: se busca por código de barras, teléfono o nombre.
 */
export const importer = new Hono<Env>()

type Result = { row: number; status: 'creado' | 'actualizado' | 'omitido' | 'error'; message?: string }
const MAX = 500
const toMilli = (n: number) => Math.round(n * 1000)

function eachRow<T>(rows: T[], fn: (r: T, i: number) => Omit<Result, 'row'>, db: Db): Result[] {
  return rows.map((r, i) => {
    try {
      let out!: Omit<Result, 'row'>
      db.transaction(() => { out = fn(r, i) })()
      return { row: i, ...out }
    } catch (e) {
      return { row: i, status: 'error', message: (e as Error).message }
    }
  })
}

const productRow = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(150),
  barcode: z.string().trim().max(50).optional().nullable(),
  unit: z.enum(['pieza', 'kg', 'metro', 'litro']).optional(),
  price: z.number().int().min(0, 'Precio no válido'),
  cost: z.number().int().min(0).optional().nullable(),
  stock: z.number().min(-1_000_000).max(10_000_000).optional().nullable(),
  minStock: z.number().min(0).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
})

importer.post('/import/products', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ rows: z.array(z.unknown()).min(1).max(MAX), onExisting: z.enum(['actualizar', 'omitir']).default('actualizar') }), await body(c))
  const branchId = u.branch_id ?? (db.prepare('SELECT id FROM branches WHERE business_id = ? ORDER BY created_at LIMIT 1').get(u.business_id) as { id: string }).id
  const ctx = { db, now, businessId: u.business_id, branchId, userId: u.id }
  const categoryId = (name: string) => {
    const hit = db.prepare('SELECT id FROM categories WHERE business_id = ? AND lower(name) = lower(?)').get(u.business_id, name) as { id: string } | undefined
    if (hit) return hit.id
    const id = newId()
    db.prepare('INSERT INTO categories (id, business_id, name, created_at) VALUES (?,?,?,?)').run(id, u.business_id, name, iso(now()))
    return id
  }
  const results = eachRow(d.rows, (raw) => {
    const r = parse(productRow, raw)
    const barcode = r.barcode && r.barcode.length >= 3 ? r.barcode : null
    let p = (barcode ? db.prepare('SELECT * FROM products WHERE business_id = ? AND barcode = ?').get(u.business_id, barcode) : undefined) as ProductRow | undefined
    p ??= db.prepare('SELECT * FROM products WHERE business_id = ? AND lower(name) = lower(?)').get(u.business_id, r.name) as ProductRow | undefined
    if (p && d.onExisting === 'omitir') return { status: 'omitido', message: 'Ya existe' }
    const t = iso(now())
    let status: Result['status']
    if (!p) {
      if (barcode && db.prepare('SELECT 1 FROM presentations pr JOIN products x ON x.id = pr.product_id WHERE x.business_id = ? AND pr.barcode = ?').get(u.business_id, barcode)) throw new Error(`El código ${barcode} ya es de una presentación`)
      const id = newId()
      db.prepare('INSERT INTO products (id, business_id, name, category_id, barcode, unit, price, min_stock_milli, last_cost, attrs, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
        id, u.business_id, r.name, r.category ? categoryId(r.category) : null, barcode, r.unit ?? 'pieza', r.price, toMilli(r.minStock ?? 0), r.cost ?? 0, '{}', t, t,
      )
      p = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow
      status = 'creado'
    } else {
      db.prepare('UPDATE products SET price = ?, last_cost = ?, min_stock_milli = ?, category_id = COALESCE(?, category_id), barcode = COALESCE(barcode, ?), version = version + 1, updated_at = ? WHERE id = ?').run(
        r.price, r.cost ?? p.last_cost, r.minStock == null ? p.min_stock_milli : toMilli(r.minStock), r.category ? categoryId(r.category) : null, barcode, t, p.id,
      )
      // El precio nuevo aplica también a lo que ya está en existencia.
      db.prepare('UPDATE lots SET price = ? WHERE product_id = ? AND qty_remaining_milli > 0').run(r.price, p.id)
      p = db.prepare('SELECT * FROM products WHERE id = ?').get(p.id) as ProductRow
      status = 'actualizado'
    }
    // Existencia: queda igual a lo que dice el archivo (como un conteo); repetir la importación no la duplica.
    if (r.stock != null) {
      const diff = toMilli(r.stock) - stockOf(db, branchId, p.id)
      const ref = newId()
      if (diff < 0) consume(ctx, p.id, -diff, 'ajuste', ref, 'Inventario inicial (importado)')
      if (diff > 0) addLot(ctx, { productId: p.id, qtyMilli: diff, unitCost: r.cost ?? p.last_cost, price: currentPrice(db, branchId, p), type: 'ajuste', refId: ref })
    }
    return { status }
  }, db)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'importacion.productos', newValue: summary(results) })
  return c.json({ results, ...summary(results) })
})

const customerRow = z.object({
  name: z.string().trim().min(2, 'Falta el nombre').max(100),
  phone: z.string().trim().max(20).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  creditLimit: z.number().int().min(0).optional().nullable(),
  balance: z.number().int().min(0).optional().nullable(),
  stamps: z.number().int().min(0).max(100000).optional().nullable(),
})

importer.post('/import/customers', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ rows: z.array(z.unknown()).min(1).max(MAX), onExisting: z.enum(['actualizar', 'omitir']).default('actualizar') }), await body(c))
  const results = eachRow(d.rows, (raw) => {
    const r = parse(customerRow, raw)
    const phone = r.phone ? r.phone.replace(/\D/g, '').slice(-10) || null : null
    let cu = (phone ? db.prepare('SELECT id FROM customers WHERE business_id = ? AND phone = ?').get(u.business_id, phone) : undefined) as { id: string } | undefined
    cu ??= db.prepare('SELECT id FROM customers WHERE business_id = ? AND lower(name) = lower(?)').get(u.business_id, r.name) as { id: string } | undefined
    if (cu && d.onExisting === 'omitir') return { status: 'omitido', message: 'Ya existe' }
    if (cu) {
      db.prepare('UPDATE customers SET name = ?, phone = COALESCE(?, phone), notes = COALESCE(?, notes), credit_limit = COALESCE(?, credit_limit) WHERE id = ?').run(r.name, phone, r.notes ?? null, r.creditLimit ?? null, cu.id)
      if (r.stamps != null) db.prepare('UPDATE customers SET loyalty_enrolled = 1 WHERE id = ?').run(cu.id)
      // El saldo solo se carga al crear al cliente, para que repetir la importación no lo duplique.
      return { status: 'actualizado', ...(r.balance || r.stamps ? { message: 'Ya existía: su saldo y sus sellos no se cambiaron' } : {}) }
    }
    const id = newId()
    // Quien trae columna de sellos (aunque sea 0) ya estaba en el programa de fidelidad: queda inscrito.
    db.prepare('INSERT INTO customers (id, business_id, name, phone, notes, code, credit_limit, loyalty_enrolled, created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, u.business_id, r.name, phone, r.notes ?? null, customerCode(), r.creditLimit ?? Math.max(r.balance ?? 0, 0), r.stamps != null ? 1 : 0, iso(now()))
    // Sellos o puntos que ya traía de su sistema anterior (solo al crear, para no duplicarlos).
    if (r.stamps) db.prepare("INSERT INTO loyalty_ledger (id, business_id, customer_id, delta, reason, created_by, created_at) VALUES (?,?,?,?,'importado',?,?)").run(newId(), u.business_id, id, r.stamps, u.id, iso(now()))
    if (r.balance) db.prepare("INSERT INTO credit_ledger (id, business_id, customer_id, delta, kind, note, created_by, created_at) VALUES (?,?,?,?,'cargo',?,?,?)").run(newId(), u.business_id, id, r.balance, 'Saldo inicial (importado)', u.id, iso(now()))
    return { status: 'creado' }
  }, db)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'importacion.clientes', newValue: summary(results) })
  return c.json({ results, ...summary(results) })
})

const supplierRow = z.object({ name: z.string().trim().min(2, 'Falta el nombre').max(100), phone: z.string().trim().max(30).optional().nullable(), notes: z.string().max(1000).optional().nullable() })

importer.post('/import/suppliers', ownerOnly, async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const d = parse(z.object({ rows: z.array(z.unknown()).min(1).max(MAX), onExisting: z.enum(['actualizar', 'omitir']).default('actualizar') }), await body(c))
  const results = eachRow(d.rows, (raw) => {
    const r = parse(supplierRow, raw)
    const s = db.prepare('SELECT id FROM suppliers WHERE business_id = ? AND lower(name) = lower(?)').get(u.business_id, r.name) as { id: string } | undefined
    if (s && d.onExisting === 'omitir') return { status: 'omitido', message: 'Ya existe' }
    if (s) {
      db.prepare('UPDATE suppliers SET phone = COALESCE(?, phone), notes = COALESCE(?, notes) WHERE id = ?').run(r.phone ?? null, r.notes ?? null, s.id)
      return { status: 'actualizado' }
    }
    db.prepare('INSERT INTO suppliers (id, business_id, name, phone, notes, created_at) VALUES (?,?,?,?,?,?)').run(newId(), u.business_id, r.name, r.phone ?? null, r.notes ?? null, iso(now()))
    return { status: 'creado' }
  }, db)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'importacion.proveedores', newValue: summary(results) })
  return c.json({ results, ...summary(results) })
})

function summary(results: Result[]) {
  const n = (s: Result['status']) => results.filter((r) => r.status === s).length
  return { created: n('creado'), updated: n('actualizado'), skipped: n('omitido'), failed: n('error') }
}
