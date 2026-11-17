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
  const [f, setF] = useState({ concept: '', amount: '', days: '', expConcept: '', expAmount: '', expKind: 'variable' })
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

  return (
    <div className="grid2">
      <section className="card">
        <div className="row"><div><label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label></div><div><label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div></div>
        {err && <p className="error">{err}</p>}
        {r && (
          <table className="list"><tbody>
            <tr><td>Ventas ({r.sales.tickets} tickets)</td><td className="num"><b>{mxn(r.sales.total)}</b></td></tr>
            <tr><td className="muted">Efectivo · transferencia · tarjeta · fiado</td><td className="num muted">{mxn(r.sales.efectivo)} · {mxn(r.sales.transferencia)} · {mxn(r.sales.tarjeta)} · {mxn(r.sales.fiado)}</td></tr>
            <tr><td>Costo de lo vendido</td><td className="num">−{mxn(r.costOfSales)}</td></tr>
            <tr><td>Mermas</td><td className="num">−{mxn(r.waste)}</td></tr>
            <tr><td>Gastos</td><td className="num">−{mxn(r.expenses)}</td></tr>
            <tr><td><b>Utilidad</b></td><td className="num"><b>{mxn(r.profit)}</b></td></tr>
            <tr><td className="muted">Cancelaciones</td><td className="num muted">{r.cancelled}</td></tr>
          </tbody></table>
        )}
        <h3 style={{ marginTop: 14 }}>Más vendidos</h3>
        <table className="list"><tbody>{r?.topProducts.map((t: any, i: number) => <tr key={i}><td>{t.description}</td><td className="num">{t.qty}</td><td className="num">{mxn(t.total)}</td></tr>)}</tbody></table>
        <h3 style={{ marginTop: 14 }}>Registrar gasto</h3>
        <div className="row"><input placeholder="Concepto" value={f.expConcept} onChange={(e) => setF({ ...f, expConcept: e.target.value })} /><input inputMode="decimal" placeholder="$0.00" value={f.expAmount} onChange={(e) => setF({ ...f, expAmount: e.target.value })} />
          <select value={f.expKind} onChange={(e) => setF({ ...f, expKind: e.target.value })}><option value="variable">Variable</option><option value="fijo">Fijo</option></select></div>
        <p><button disabled={!(toCents(f.expAmount) > 0 && f.expConcept.trim().length >= 2)} onClick={run(async () => { await api('POST', '/expenses', { id: crypto.randomUUID(), concept: f.expConcept, amount: toCents(f.expAmount), kind: f.expKind, method: 'transferencia' }); setF({ ...f, expConcept: '', expAmount: '' }) })}>Guardar gasto</button></p>
      </section>
      {owner && (
        <section className="card">
          <h2>Retiro sugerido del mes</h2>
          {w && w.suggested != null && <Cascada profit={w.profit} reserve={w.reserve} restock={w.restock} suggested={w.suggested} />}
          {w && (w.suggested == null ? <p>{w.message}</p> : (
            <table className="list"><tbody>
              <tr><td>Utilidad del periodo</td><td className="num">{mxn(w.profit)}</td></tr>
              <tr><td>Reserva ({w.reserveDays} días de gastos fijos)</td><td className="num">−{mxn(w.reserve)}</td></tr>
              <tr><td>Reponer inventario al mínimo</td><td className="num">−{mxn(w.restock)}</td></tr>
              <tr><td><b>Puedes retirar</b></td><td className="num"><b style={{ fontSize: '1.4rem' }}>{mxn(w.suggested)}</b></td></tr>
            </tbody></table>
          ))}
          <div className="row"><input aria-label="Días de reserva" inputMode="numeric" placeholder={String(fixed?.reserveDays ?? '')} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /><button onClick={run(() => api('PUT', '/reserve-days', { days: Number(f.days) }))}>Guardar</button></div>
          <h3 style={{ marginTop: 14 }}>Gastos fijos al mes</h3>
          <table className="list"><tbody>{fixed?.fixedExpenses.map((x: any) => <tr key={x.id}><td>{x.concept}</td><td className="num">{mxn(x.monthlyAmount)}</td></tr>)}</tbody></table>
          <div className="row"><input placeholder="Renta, luz, agua…" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} /><input inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <p><button disabled={!(toCents(f.amount) > 0 && f.concept.trim().length >= 2)} onClick={run(async () => { await api('POST', '/fixed-expenses', { concept: f.concept, monthlyAmount: toCents(f.amount) }); setF({ ...f, concept: '', amount: '' }) })}>Agregar gasto fijo</button></p>
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
            <text x={pad + i * bw + bw / 2} y={top - 6} textAnchor="middle" fill="#F1F5F9" fontSize="14" fontWeight="700">{i === 1 || i === 2 ? '−' : ''}{mxn(Math.abs(s.to - s.from))}</text>
            <text x={pad + i * bw + bw / 2} y={H + 26} textAnchor="middle" fill="#7C8799" fontSize="14">{s.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
