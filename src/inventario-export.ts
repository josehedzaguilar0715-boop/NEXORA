import { Hono } from 'hono'
import { audit } from './audit.js'
import { canFinance, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, localDate } from './util.js'
import { FORMATS, money2, slugify, toCsv, toPdf, toXlsx, type Cell, type Doc, type Format, type Hoja } from './exportar.js'

/**
 * Exportar el inventario completo a Excel (.xlsx), CSV o PDF, para llevarlo a otro sistema o tenerlo en papel.
 * Solo lectura. El costo y el valor del inventario salen únicamente para quien puede ver costos.
 * Los encabezados coinciden con los de «Importar datos» (Nombre, Código de barras, Precio de venta, Costo, Existencia, Unidad, Mínimo, Categoría).
 */
export interface InvRow { code: string; name: string; category: string; unit: string; price: number; wholesale: number | null; wholesaleFrom: number | null; cost: number | null; stock: number | null; min: number; value: number | null }
export interface InvData { business: string; branch: string; date: string; costs: boolean; rows: InvRow[] }

const pesos = (c: number) => Math.round(c) / 100

export function inventoryData(db: Db, businessId: string, branchId: string, costs: boolean, date: string): InvData {
  const business = (db.prepare('SELECT name FROM businesses WHERE id = ?').get(businessId) as { name: string }).name
  const branch = (db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId) as { name: string } | undefined)?.name ?? ''
  const list = db.prepare(`SELECT p.id, p.name, p.barcode, p.unit, p.price, p.min_stock_milli, p.last_cost, p.track_stock, COALESCE(c.name, '') AS category,
      (SELECT COALESCE(SUM(qty_milli), 0) FROM stock_movements m WHERE m.branch_id = ? AND m.product_id = p.id) AS stock_milli,
      (SELECT price FROM price_tiers t WHERE t.product_id = p.id ORDER BY min_milli LIMIT 1) AS tier_price,
      (SELECT min_milli FROM price_tiers t WHERE t.product_id = p.id ORDER BY min_milli LIMIT 1) AS tier_min
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.business_id = ? AND p.active = 1 ORDER BY p.name COLLATE NOCASE`).all(branchId, businessId) as {
      name: string; barcode: string | null; unit: string; price: number; min_stock_milli: number; last_cost: number; track_stock: number | null; category: string; stock_milli: number; tier_price: number | null; tier_min: number | null }[]
  const rows: InvRow[] = list.map((p) => {
    const tracked = p.track_stock !== 0
    const stock = tracked ? p.stock_milli / 1000 : null
    const cost = costs ? pesos(p.last_cost) : null
    return {
      code: p.barcode ?? '', name: p.name, category: p.category, unit: p.unit, price: pesos(p.price),
      wholesale: p.tier_price != null ? pesos(p.tier_price) : null, wholesaleFrom: p.tier_min != null ? p.tier_min / 1000 : null,
      cost, stock, min: p.min_stock_milli / 1000, value: costs && stock != null ? Math.round(stock * p.last_cost) / 100 : null,
    }
  })
  return { business, branch, date, costs, rows }
}

const HEAD = (costs: boolean) => ['Código de barras', 'Nombre', 'Categoría', 'Unidad', 'Precio de venta', 'Precio de mayoreo', 'Mayoreo desde', ...(costs ? ['Costo'] : []), 'Existencia', 'Mínimo', ...(costs ? ['Valor a costo'] : [])]
const cells = (r: InvRow, costs: boolean): Cell[] => [r.code, r.name, r.category, r.unit, r.price, r.wholesale, r.wholesaleFrom, ...(costs ? [r.cost] : []), r.stock, r.min, ...(costs ? [r.value] : [])]
const qty = (v: number | null) => (v == null ? '' : String(Math.round(v * 1000) / 1000))

export function inventoryDoc(d: InvData): { doc: Doc; hoja: Hoja } {
  const c = d.costs
  const total = c ? d.rows.reduce((a, r) => a + (r.value ?? 0), 0) : null
  const hoja: Hoja = {
    name: 'Inventario', title: 'Inventario', head: HEAD(c), rows: d.rows.map((r) => cells(r, c)),
    widths: c ? [18, 42, 18, 9, 14, 16, 14, 12, 12, 10, 14] : [18, 42, 18, 9, 14, 16, 14, 12, 10],
    money: c ? [4, 5, 7, 10] : [4, 5],
    pdf: c
      ? [{ w: 14, head: 'Código' }, { w: 38, head: 'Nombre' }, { w: 15, head: 'Categoría' }, { w: 6, head: 'Unid.' }, { w: 10, head: 'Precio', right: true }, { w: 10, head: 'Mayoreo', right: true }, { w: 10, head: 'Costo', right: true }, { w: 9, head: 'Exist.', right: true }, { w: 6, head: 'Mín.', right: true }, { w: 12, head: 'Valor', right: true }]
      : [{ w: 15, head: 'Código' }, { w: 46, head: 'Nombre' }, { w: 18, head: 'Categoría' }, { w: 6, head: 'Unid.' }, { w: 11, head: 'Precio', right: true }, { w: 11, head: 'Mayoreo', right: true }, { w: 10, head: 'Exist.', right: true }, { w: 7, head: 'Mín.', right: true }],
    pdfRows: d.rows.map((r) => (c
      ? [r.code, r.name, r.category, r.unit, money2(r.price), money2(r.wholesale), money2(r.cost), qty(r.stock), qty(r.min), money2(r.value)]
      : [r.code, r.name, r.category, r.unit, money2(r.price), money2(r.wholesale), qty(r.stock), qty(r.min)])),
  }
  return { hoja, doc: { title: `Inventario - ${d.business}`, subtitle: `${d.branch ? d.branch + '  |  ' : ''}al ${d.date}  |  ${d.rows.length} productos${total != null ? `  |  Valor a costo: $${money2(total)}` : ''}`, hojas: [hoja] } }
}

// ---------- Ruta ----------
export const inventarioExport = new Hono<Env>()

inventarioExport.get('/inventory/export', requirePerm('view_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const format = (c.req.query('format') ?? 'xlsx') as Format
  if (!FORMATS[format]) throw bad('Elige el formato: xlsx, csv o pdf.')
  const branchId = c.req.query('branchId') ?? u.branch_id ?? (db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1 ORDER BY created_at LIMIT 1').get(u.business_id) as { id: string } | undefined)?.id
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(branchId, u.business_id)) throw bad('Sucursal no válida.')
  const costs = canFinance(u, 'costs')
  const date = localDate(now())
  const data = inventoryData(db, u.business_id, branchId, costs, date)
  const { doc, hoja } = inventoryDoc(data)
  const bytes = format === 'xlsx' ? toXlsx([hoja]) : format === 'csv' ? toCsv(hoja) : toPdf(doc)
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'inventario.exportado', newValue: { format, productos: data.rows.length, conCostos: costs } })
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': FORMATS[format].type, 'content-disposition': `attachment; filename="inventario-${slugify(data.business)}-${date}.${FORMATS[format].ext}"`, 'cache-control': 'no-store' } })
})
