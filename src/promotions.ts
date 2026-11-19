import type { Db } from './db.js'

export interface PromoLine { ref?: string | null; category?: string | null; quantity: number; total: number }
export interface PromotionRow {
  id: string; name: string; kind: 'porcentaje' | 'monto'; value: number; starts_at: string; ends_at: string
  applies_to: string; combinable: number; min_quantity: number
}
interface Target { all?: boolean; refs?: string[]; categories?: string[] }

function matches(t: Target, l: PromoLine) {
  return !!t.all || (!!l.ref && !!t.refs?.includes(l.ref)) || (!!l.category && !!t.categories?.includes(l.category))
}

/** Descuento de una promoción sobre las partidas a las que aplica (centavos). */
export function promoAmount(p: PromotionRow, lines: PromoLine[]): number {
  const t = JSON.parse(p.applies_to) as Target
  const hit = lines.filter((l) => matches(t, l))
  const qty = hit.reduce((a, l) => a + l.quantity, 0)
  const base = hit.reduce((a, l) => a + l.total, 0)
  if (!hit.length || base === 0 || qty < p.min_quantity) return 0
  // porcentaje: value en puntos base (1000 = 10 %). monto: centavos, una vez por venta.
  const raw = p.kind === 'porcentaje' ? Math.round((base * p.value) / 10_000) : p.value
  return Math.min(raw, base)
}

/**
 * Elige el mejor conjunto válido: una promoción no combinable sola, o todas las combinables juntas.
 * Nunca descuenta más que el subtotal.
 */
export function bestPromotions(promos: PromotionRow[], lines: PromoLine[]) {
  const subtotal = lines.reduce((a, l) => a + l.total, 0)
  const scored = promos.map((p) => ({ p, amount: promoAmount(p, lines) })).filter((x) => x.amount > 0)
  const candidates: { p: PromotionRow; amount: number }[][] = scored.filter((x) => !x.p.combinable).map((x) => [x])
  const combos = scored.filter((x) => x.p.combinable)
  if (combos.length) candidates.push(combos)
  let best: { p: PromotionRow; amount: number }[] = []
  let bestTotal = 0
  for (const c of candidates) {
    const tot = Math.min(c.reduce((a, x) => a + x.amount, 0), subtotal)
    if (tot > bestTotal) { best = c; bestTotal = tot }
  }
  // Si las combinables suman más que el subtotal, se recorta la última.
  let left = bestTotal
  const applied = best.map((x) => { const a = Math.min(x.amount, left); left -= a; return { id: x.p.id, name: x.p.name, amount: a } }).filter((x) => x.amount > 0)
  return { total: bestTotal, applied }
}

export function activePromotions(db: Db, businessId: string, at: string): PromotionRow[] {
  return db.prepare('SELECT * FROM promotions WHERE business_id = ? AND active = 1 AND starts_at <= ? AND ends_at > ?').all(businessId, at, at) as PromotionRow[]
}
