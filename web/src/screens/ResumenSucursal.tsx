import { useEffect, useState } from 'react'
import { api, everyVisible, mxn, toCents } from '../api'
import type { Me } from '../App'

/** Resumen operativo de la sucursal para el encargado: lo que se vendió hoy, sin utilidades ni nada financiero. */
export function ResumenSucursal() {
  const [d, setD] = useState<any>(null)
  useEffect(() => { const l = () => api<any>('GET', '/sucursal/resumen').then(setD).catch(() => setD(null)); void l(); return everyVisible(l, 30_000) }, [])
  if (!d) return null
  const c = d.comparison
  const cmp = (x: any) => x && <li key={x.label}>{x.label}: {mxn(x.sales)} en {x.tickets} {x.tickets === 1 ? 'operación' : 'operaciones'}{x.salesChangePct !== null ? ` · hoy ${x.salesChangePct >= 0 ? '+' : ''}${x.salesChangePct}%` : ''}</li>
  return (
    <section className="card">
      <h2>Mi sucursal hoy{d.branch?.name ? ` · ${d.branch.name}` : ''}</h2>
      <div className="kpis">
        <div className="card kpi"><div className="label">Ventas del día</div><div className="value pos">{mxn(d.today.sales)}</div></div>
        <div className="card kpi"><div className="label">Operaciones</div><div className="value">{d.today.tickets}</div><div className="hint">{d.today.cancelled > 0 ? `${d.today.cancelled} canceladas` : ''}</div></div>
        <div className="card kpi"><div className="label">Venta promedio</div><div className="value">{mxn(d.today.avgTicket)}</div></div>
      </div>
      {d.goal && (
        <div style={{ margin: '12px 0' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>Objetivo del día: {mxn(d.goal.amount)}</b><span>{d.goal.pct}%</span></div>
          <div className="bar-track" role="progressbar" aria-valuenow={Math.min(100, d.goal.pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del objetivo del día"><div className="bar-fill profit" style={{ width: `${Math.min(100, d.goal.pct)}%` }} /></div>
          <p className="muted small">{d.goal.missing > 0 ? `Faltan ${mxn(d.goal.missing)} para llegar.` : '¡Objetivo cumplido!'}</p>
        </div>
      )}
      {(c.yesterday || c.lastWeek || c.avg7) && (
        <ul className="plan-reasons">{cmp(c.yesterday)}{cmp(c.lastWeek)}{c.avg7 && <li>Promedio de los últimos {c.avg7.days} días con ventas: {mxn(c.avg7.sales)} y {c.avg7.tickets} operaciones al día.</li>}</ul>
      )}
      {d.sold.length > 0 && (
        <>
          <h3>Lo que se vendió hoy</h3>
          <div className="table-wrap cards-sm"><table className="list"><tbody>
            {d.sold.map((s: any) => <tr key={s.description}><td data-label="Producto o servicio">{s.description}</td><td data-label="Cantidad" className="num">{s.qty}</td><td data-label="Cobrado" className="num">{mxn(s.total)}</td></tr>)}
          </tbody></table></div>
        </>
      )}
      {d.notes.map((n: string) => <p key={n} className="muted small">{n}</p>)}
    </section>
  )
}

/** Objetivo de ventas diario por sucursal (lo fija el dueño; el encargado solo lo ve). */
export function MetasSucursal({ me }: { me: Me }) {
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [vals, setVals] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (me.user.role !== 'owner') return
    void (async () => {
      const b = (await api<any>('GET', '/branches')).branches ?? []
      setBranches(b)
      const next: Record<string, string> = {}
      for (const x of b) { const r = await api<any>('GET', `/sucursal/resumen?branchId=${x.id}`).catch(() => null); next[x.id] = r?.goal ? String(r.goal.amount / 100) : '' }
      setVals(next)
    })().catch(() => {})
  }, [])
  if (me.user.role !== 'owner' || branches.length === 0) return null
  return (
    <section className="card">
      <h2>Objetivo de ventas por sucursal</h2>
      <p className="muted small">Lo ve el encargado en su resumen del día. Déjalo vacío si no quieres objetivo.</p>
      {branches.map((b) => (
        <div key={b.id} className="row">
          <label style={{ flex: 1 }}>{b.name}<input inputMode="decimal" placeholder="$0.00 al día" value={vals[b.id] ?? ''} onChange={(e) => setVals({ ...vals, [b.id]: e.target.value })} /></label>
          <button onClick={async () => { try { await api('PUT', '/sucursal/meta', { branchId: b.id, amount: Math.max(0, toCents(vals[b.id] || '0') || 0) }); setMsg(`Objetivo de ${b.name} guardado.`) } catch (e) { setMsg((e as Error).message) } }}>Guardar</button>
        </div>
      ))}
      {msg && <p className="okmsg">{msg}</p>}
    </section>
  )
}
