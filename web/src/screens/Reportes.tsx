import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

export function Reportes({ me }: { me: Me }) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [r, setR] = useState<any>(null)
  const [w, setW] = useState<any>(null)
  const [fixed, setFixed] = useState<any>(null)
  const [f, setF] = useState({ concept: '', amount: '', days: '' })
  const [err, setErr] = useState('')
  const owner = me.user.role === 'owner'
  const load = async () => {
    try {
      setR(await api('GET', `/reports/summary?from=${from}&to=${to}`))
      if (owner) {
        setW(await api('GET', `/reports/suggested-withdrawal?from=${from.slice(0, 8)}01&to=${to}`))
        setFixed(await api('GET', '/fixed-expenses'))
      }
    } catch (e) { setErr((e as Error).message) }
  }
  useEffect(() => { void load() }, [from, to])
  const run = (fn: () => Promise<unknown>) => async () => { try { await fn(); await load(); setErr('') } catch (e) { setErr((e as Error).message) } }

  // Resta sin mostrar "−$0.00".
  const minus = (n: number) => mxn(n ? -n : 0)
  return (
    <div className="grid2 config">
      <section className="card">
        <div className="card-head"><h2>Ventas del periodo</h2></div>
        <div className="row"><label>Desde<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label></div>
        {err && <p className="error">{err}</p>}
        {r && (
          <div className="table-wrap"><table className="list statement"><tbody>
            <tr><td>Ventas ({r.sales.tickets} {r.sales.tickets === 1 ? 'ticket' : 'tickets'})</td><td className="num"><b>{mxn(r.sales.total)}</b></td></tr>
            {(['efectivo', 'transferencia', 'tarjeta', 'fiado'] as const).filter((k) => k !== 'fiado' || r.sales.fiado).map((k) => <tr key={k} className="indent"><td>{k[0]!.toUpperCase() + k.slice(1)}</td><td className="num muted">{mxn(r.sales[k])}</td></tr>)}
            <tr><td>Costo de lo vendido</td><td className="num">{minus(r.costOfSales)}</td></tr>
            {r.waste > 0 && <tr><td>Mermas</td><td className="num">{minus(r.waste)}</td></tr>}
            <tr><td>Gastos</td><td className="num">{minus(r.expenses)}</td></tr>
            {r.commissions > 0 && <tr><td>Comisiones del personal</td><td className="num">{minus(r.commissions)}</td></tr>}
            <tr className={`total ${r.profit < 0 ? 'neg' : ''}`}><td>Utilidad</td><td className="num">{mxn(r.profit)}</td></tr>
            {r.cancelled > 0 && <tr className="muted"><td>Ventas canceladas</td><td className="num">{r.cancelled}</td></tr>}
          </tbody></table></div>
        )}
        <h3 style={{ marginTop: 18 }}>Más vendidos</h3>
        <div className="table-wrap"><table className="list"><tbody>
          {r?.topProducts.map((t: any, i: number) => <tr key={i}><td>{t.description}</td><td className="num muted">{t.qty}</td><td className="num">{mxn(t.total)}</td></tr>)}
          {r && r.topProducts.length === 0 && <tr><td className="empty">Sin ventas en este periodo.</td></tr>}
        </tbody></table></div>
        <p className="muted small" style={{ marginTop: 14 }}>Los gastos se registran en <a href="#/finanzas">Finanzas → Gastos</a>.</p>
      </section>
      {owner && (
        <section className="card">
          <h2>Retiro sugerido del mes</h2>
          <p className="muted small">Cuánto puedes sacar sin descapitalizar el negocio: utilidad − reserva para gastos fijos − lo que cuesta reponer el inventario.</p>
          {w && w.suggested != null && <Cascada profit={w.profit} reserve={w.reserve} restock={w.restock} suggested={w.suggested} />}
          {w && w.suggested != null && (
            <div className="table-wrap"><table className="list statement"><tbody>
              <tr><td>Utilidad del mes</td><td className="num">{mxn(w.profit)}</td></tr>
              <tr><td>Reserva ({w.reserveDays} días de gastos fijos)</td><td className="num">{minus(w.reserve)}</td></tr>
              <tr><td>Reponer inventario al mínimo</td><td className="num">{minus(w.restock)}</td></tr>
              <tr className="total"><td>Puedes retirar</td><td className="num">{mxn(w.suggested)}</td></tr>
            </tbody></table></div>
          )}
          <h3 style={{ marginTop: 18 }}>Días de reserva</h3>
          <p className="muted small">Cuántos días de gastos fijos quieres tener guardados siempre.{fixed?.reserveDays != null ? ` Hoy: ${fixed.reserveDays} días.` : ''}</p>
          <div className="row"><input aria-label="Días de reserva" inputMode="numeric" placeholder={fixed?.reserveDays != null ? String(fixed.reserveDays) : 'Ej. 30'} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /><button style={{ flex: '0 0 auto' }} disabled={f.days.trim() === ''} onClick={run(async () => { await api('PUT', '/reserve-days', { days: Number(f.days) }); setF({ ...f, days: '' }) })}>Guardar días</button></div>
          <h3 style={{ marginTop: 18 }}>Gastos fijos al mes</h3>
          <div className="table-wrap"><table className="list"><tbody>
            {fixed?.fixedExpenses.map((x: any) => <tr key={x.id}><td>{x.concept}</td><td className="num">{mxn(x.monthlyAmount)}</td></tr>)}
            {fixed && fixed.fixedExpenses.length === 0 && <tr><td className="muted">Renta, luz, agua, internet, sueldos fijos…</td></tr>}
          </tbody></table></div>
          <label>Concepto<input placeholder="Ej. Renta del local" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} /></label>
          <div className="row"><label>Cuánto al mes<input inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label><button style={{ flex: '0 0 auto', alignSelf: 'end' }} disabled={!(toCents(f.amount) > 0 && f.concept.trim().length >= 2)} onClick={run(async () => { await api('POST', '/fixed-expenses', { concept: f.concept, monthlyAmount: toCents(f.amount) }); setF({ ...f, concept: '', amount: '' }) })}>Agregar</button></div>
        </section>
      )}
    </div>
  )
}

/** Cascada del retiro sugerido: utilidad − reserva − reposición = lo que puedes retirar. */
function Cascada({ profit, reserve, restock, suggested }: { profit: number; reserve: number; restock: number; suggested: number }) {
  const steps = [
    { label: 'Utilidad', from: 0, to: profit, color: '#22D3EE' },
    { label: 'Reserva', from: profit, to: profit - reserve, color: '#F87171' },
    { label: 'Reposición', from: profit - reserve, to: profit - reserve - restock, color: '#F87171' },
    { label: 'Retirar', from: 0, to: suggested, color: '#34D399' },
  ]
  const vals = steps.flatMap((s) => [s.from, s.to])
  const hi = Math.max(1, ...vals), lo = Math.min(0, ...vals)
  const W = 520, H = 220, pad = 20, bw = (W - pad * 2) / steps.length
  const y = (v: number) => pad + ((hi - v) * (H - pad * 2)) / (hi - lo || 1)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H + 40}`} role="img" aria-label={`Retiro sugerido: ${mxn(suggested)}`} style={{ marginBottom: 12 }}>
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#232A3A" />
      {steps.map((s, i) => {
        const top = y(Math.max(s.from, s.to)), h = Math.max(2, Math.abs(y(s.from) - y(s.to)))
        return (
          <g key={s.label}>
            <rect x={pad + i * bw + bw * 0.15} y={top} width={bw * 0.7} height={h} rx={8} fill={s.color} opacity={0.9} />
            <text x={pad + i * bw + bw / 2} y={top - 6} textAnchor="middle" fill="#F1F5F9" fontSize="14" fontWeight="700">{(i === 1 || i === 2) && s.to !== s.from ? '−' : ''}{mxn(Math.abs(s.to - s.from))}</text>
            <text x={pad + i * bw + bw / 2} y={H + 26} textAnchor="middle" fill="#7C8799" fontSize="14">{s.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
