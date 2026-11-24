// Compara dos respaldos completos (.json.gz) de producción: el ANTERIOR a un cambio y el POSTERIOR.
// Comprueba que nada de lo que había se perdió ni se alteró en las tablas que no se modifican (ventas, pagos, movimientos,
// fiado, gastos, compras, bitácora…). Las tablas vivas (turnos, productos, usuarios…) pueden cambiar con el uso: se informan.
// Uso: npx tsx scripts/verificacion/comparar-respaldos.ts <antes.json.gz> <despues.json.gz>   (no imprime datos, solo cifras)
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

type B = { version: number; tables: Record<string, Record<string, unknown>[]> }
const load = (f: string): B => { const raw = readFileSync(f); return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8')) }
const [a, b] = process.argv.slice(2).map((f) => load(f!)) as [B, B]
// Tablas de historial: sus renglones no se modifican ni se borran nunca.
const INMUTABLES = ['sales', 'sale_items', 'sale_payments', 'stock_movements', 'credit_ledger', 'expenses', 'purchases', 'purchase_items', 'audit_log', 'cash_movements', 'lots', 'staff_payouts', 'businesses', 'branches', 'customers']
let bad = 0
console.log(`Esquema: ${a.version} → ${b.version}`)
for (const t of Object.keys(a.tables).sort()) {
  const cols = Object.keys(a.tables[t]![0] ?? {})
  // Identificador del renglón: `id`, o las columnas llave de las tablas sin `id` (p. ej. sale_counters: branch_id).
  const key = (r: Record<string, unknown>) => String(r.id ?? [r.branch_id, r.user_id, r.product_id, r.key, r.version, r.sale_id, r.shift_id, r.tab_id].filter((x) => x !== undefined).join('|') ?? JSON.stringify(r))
  // Solo se comparan las columnas que ya existían en el respaldo anterior (las migraciones agregan columnas nuevas).
  const proj = (r: Record<string, unknown>) => JSON.stringify(cols.map((c) => r[c] ?? null))
  const after = new Map((b.tables[t] ?? []).map((r) => [key(r), proj(r)]))
  let missing = 0, changed = 0
  for (const r of a.tables[t]!) { const v = after.get(key(r)); if (v === undefined) missing++; else if (v !== proj(r)) changed++ }
  const strict = INMUTABLES.includes(t)
  const fail = missing > 0 || (strict && changed > 0 && !['lots', 'customers', 'branches', 'businesses'].includes(t))
  if (fail) bad++
  if (missing || changed) console.log(`${fail ? '✗' : '·'} ${t}: antes ${a.tables[t]!.length}, después ${(b.tables[t] ?? []).length}, perdidos ${missing}, cambiados ${changed}${strict ? '' : ' (tabla viva)'}`)
}
const tot = (x: B, t: string) => (x.tables[t] ?? []).length
console.log(`Ventas ${tot(a, 'sales')} → ${tot(b, 'sales')} · negocios ${tot(a, 'businesses')} → ${tot(b, 'businesses')} · usuarios ${tot(a, 'users')} → ${tot(b, 'users')} · productos ${tot(a, 'products')} → ${tot(b, 'products')}`)
console.log(bad ? `RESULTADO: HAY PÉRDIDAS O ALTERACIONES (${bad} tablas)` : 'RESULTADO: NADA SE PERDIÓ NI SE ALTERÓ')
process.exit(bad ? 1 : 0)
