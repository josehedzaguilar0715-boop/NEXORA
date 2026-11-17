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
