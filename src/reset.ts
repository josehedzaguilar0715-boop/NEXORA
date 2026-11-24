import { Hono } from 'hono'
import { z } from 'zod'
import { audit } from './audit.js'
import { authorize } from './authcode.js'
import { body, parse, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, forbidden } from './util.js'

/**
 * «Empezar de cero»: borra las ventas y movimientos de prueba que se hicieron al enseñarle el sistema al cliente.
 * No existe borrar UNA venta (sería la forma de robar: cobrar y borrar). Esto borra TODO el movimiento del negocio
 * de una vez, solo el dueño, con su código y escribiendo BORRAR; queda en la bitácora.
 * Se queda: productos, servicios, clientes, proveedores, personal, configuración y compras.
 * Lo vendido de prueba regresa al inventario.
 */

const SALES = '(SELECT id FROM sales WHERE business_id = ?)'
const SHIFTS = '(SELECT id FROM shifts WHERE business_id = ?)'
const TABS = '(SELECT id FROM tabs WHERE business_id = ?)'
const BRANCHES = '(SELECT id FROM branches WHERE business_id = ?)'

/** Tipos de movimiento de inventario que salen de ventas (se deshacen para regresar la existencia). */
const SALE_MOVES = "('venta','cancelacion','devolucion','consumo')"

/** En orden: primero lo que apunta a otra cosa. Cada sentencia recibe el id del negocio en cada `?`. */
export const STEPS: [table: string, sql: string][] = [
  ['asset_rentals', `DELETE FROM asset_rentals WHERE tab_id IN ${TABS}`],
  ['tab_items', `DELETE FROM tab_items WHERE tab_id IN ${TABS}`],
  ['notifications', 'DELETE FROM notifications WHERE business_id = ?'],
  ['comandas', 'DELETE FROM comandas WHERE business_id = ?'],
  ['tabs', 'DELETE FROM tabs WHERE business_id = ?'],
  ['table_reservations', 'DELETE FROM table_reservations WHERE business_id = ?'],
  ['sale_payments', `DELETE FROM sale_payments WHERE sale_id IN ${SALES}`],
  ['sale_promotions', `DELETE FROM sale_promotions WHERE sale_id IN ${SALES}`],
  ['sale_commissions', 'DELETE FROM sale_commissions WHERE business_id = ?'],
  ['tips', 'DELETE FROM tips WHERE business_id = ?'],
  ['staff_payouts', 'DELETE FROM staff_payouts WHERE business_id = ?'],
  ['return_items', 'DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE business_id = ?)'],
  ['returns', 'DELETE FROM returns WHERE business_id = ?'],
  ['entry_tickets', 'DELETE FROM entry_tickets WHERE business_id = ?'],
  ['accesses', 'DELETE FROM accesses WHERE business_id = ?'],
  ['occupancy_events', 'DELETE FROM occupancy_events WHERE business_id = ?'],
  ['appointments', 'DELETE FROM appointments WHERE business_id = ?'],
  ['layaway_payments', 'DELETE FROM layaway_payments WHERE layaway_id IN (SELECT id FROM layaways WHERE business_id = ?)'],
  ['layaway_items', 'DELETE FROM layaway_items WHERE layaway_id IN (SELECT id FROM layaways WHERE business_id = ?)'],
  ['layaways', 'DELETE FROM layaways WHERE business_id = ?'],
  ['orders', 'DELETE FROM orders WHERE business_id = ?'],
  ['quotes', 'DELETE FROM quotes WHERE business_id = ?'],
  ['credit_ledger', 'DELETE FROM credit_ledger WHERE business_id = ?'],
  ['loyalty_ledger', 'DELETE FROM loyalty_ledger WHERE business_id = ?'],
  ['campaign_awards', 'DELETE FROM campaign_awards WHERE campaign_id IN (SELECT id FROM campaigns WHERE business_id = ?)'],
  ['visits', 'DELETE FROM visits WHERE business_id = ?'],
  ['membership_uses', 'DELETE FROM membership_uses WHERE membership_id IN (SELECT id FROM customer_memberships WHERE business_id = ?)'],
  ['customer_memberships', 'DELETE FROM customer_memberships WHERE business_id = ?'],
  ['meat_batches', 'DELETE FROM meat_batches WHERE business_id = ?'],
  ['day_closes', 'DELETE FROM day_closes WHERE business_id = ?'],
  ['daily_menus', 'DELETE FROM daily_menus WHERE business_id = ?'],
  ['staff_attendance', 'DELETE FROM staff_attendance WHERE business_id = ?'],
  // Inventario: lo vendido regresa a su lote y a la existencia.
  ['lots', `UPDATE lots SET qty_remaining_milli = MIN(qty_initial_milli, qty_remaining_milli - (SELECT COALESCE(SUM(m.qty_milli),0) FROM stock_movements m WHERE m.lot_id = lots.id AND m.type IN ${SALE_MOVES})) WHERE business_id = ?`],
  ['stock_movements', `DELETE FROM stock_movements WHERE business_id = ? AND type IN ${SALE_MOVES}`],
  ['consumption_carry', `DELETE FROM consumption_carry WHERE branch_id IN ${BRANCHES}`],
  ['open_bottles', 'DELETE FROM open_bottles WHERE business_id = ?'],
  ['sales', 'DELETE FROM sale_items WHERE sale_id IN ' + SALES],
  ['sales', 'DELETE FROM sales WHERE business_id = ?'],
  ['counter_readings', `DELETE FROM counter_readings WHERE shift_id IN ${SHIFTS}`],
  ['cleaning_log', 'DELETE FROM cleaning_log WHERE business_id = ?'],
  ['owner_withdrawals', 'DELETE FROM owner_withdrawals WHERE business_id = ?'],
  ['balance_entries', 'DELETE FROM balance_entries WHERE business_id = ?'],
  ['cash_movements', `DELETE FROM cash_movements WHERE shift_id IN ${SHIFTS}`],
  ['supplier_payments', `UPDATE supplier_payments SET from_cash_shift = NULL WHERE from_cash_shift IN ${SHIFTS}`],
  ['supplier_returns', `UPDATE supplier_returns SET shift_id = NULL WHERE shift_id IN ${SHIFTS}`],
  ['expenses', 'DELETE FROM expenses WHERE business_id = ?'],
  ['shifts', 'DELETE FROM shifts WHERE business_id = ?'],
  ['sale_counters', `DELETE FROM sale_counters WHERE branch_id IN ${BRANCHES}`],
  ['dining_tables', "UPDATE dining_tables SET status = 'libre' WHERE business_id = ?"],
]

/** Tablas cuyos candados contra borrado se quitan un momento (dentro de la misma transacción) y se vuelven a poner. */
const LOCKED = ['balance_entries', 'tab_items', 'tabs', 'sale_payments', 'sale_commissions', 'tips', 'staff_payouts', 'entry_tickets', 'accesses', 'layaway_payments', 'layaways', 'credit_ledger', 'loyalty_ledger', 'visits', 'membership_uses', 'staff_attendance', 'stock_movements', 'sale_items', 'sales', 'cleaning_log', 'cash_movements', 'expenses', 'shifts']

export function resetDemoData(db: Db, businessId: string): { sales: number } {
  const sales = (db.prepare('SELECT COUNT(*) n FROM sales WHERE business_id = ?').get(businessId) as { n: number }).n
  db.transaction(() => {
    const triggers = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%no_delete' AND tbl_name IN (${LOCKED.map(() => '?').join(',')})`).all(...LOCKED) as { name: string; sql: string }[]
    for (const t of triggers) db.exec(`DROP TRIGGER ${t.name}`)
    try {
      for (const [, sql] of STEPS) db.prepare(sql).run(...Array(sql.split('?').length - 1).fill(businessId))
    } finally {
      for (const t of triggers) db.exec(t.sql)
    }
  })()
  return { sales }
}

export const reset = new Hono<Env>()

reset.post('/business/reset-demo', async (c) => {
  const deps = c.get('deps')
  const u = c.get('session').user
  if (u.role !== 'owner') throw forbidden('Solo el dueño puede borrar los datos de prueba.')
  const d = parse(z.object({ authCode: z.string().optional(), confirm: z.string() }), await body(c))
  if (d.confirm.trim().toUpperCase() !== 'BORRAR') throw bad('Escribe BORRAR para confirmar.')
  authorize(deps, u, d.authCode, 'cancel_discount', 'empezar de cero', { ownerOnly: true })
  const r = resetDemoData(deps.db, u.business_id)
  audit(deps.db, deps.now, { businessId: u.business_id, userId: u.id, action: 'negocio.empezar_de_cero', newValue: r })
  return c.json(r)
})
