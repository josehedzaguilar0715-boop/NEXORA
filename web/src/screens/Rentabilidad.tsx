import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import { hasGiro, type Me } from '../App'
import { AGENDA_GIROS, FOOD_GIROS } from '../giros'

/**
 * Rentabilidad por giro, en lenguaje sencillo. Solo muestra lo que el negocio ya registró:
 * si falta algo, dice qué capturar y no recomienda sobre eso (el servidor decide qué falta).
 */
const TIENDAS = ['abarrotes', 'ferreteria', 'papeleria', 'perfumeria', 'verduleria']

function Falta({ items }: { items?: string[] }) {
  if (!items?.length) return null
  return <div className="notice"><b>Para ver más claro, falta capturar:</b><ul className="plan-reasons">{items.map((f) => <li key={f}>{f}</li>)}</ul></div>
}
const Pct = ({ v }: { v: number | null }) => <>{v === null ? '—' : `${v}%`}</>

function Servicios({ from, to }: { from: string; to: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); api<any>('GET', `/auto/servicios?from=${from}&to=${to}`).then(setD).catch((e) => setErr(e.message)) }, [from, to])
  if (err) return <p className="error">{err}</p>
  if (!d) return <p className="muted">Calculando…</p>
  return (
    <>
      <Falta items={d.falta} />
      {d.consejos.length > 0 && <section className="card"><h2>Lo que conviene revisar</h2><ul className="plan-reasons">{d.consejos.map((c: string) => <li key={c}>{c}</li>)}</ul></section>}
      <section className="card">
        <h2>Ganancia por servicio</h2>
        <p className="muted small">Lo que cobras, menos lo que gastas en materiales y lo que pagas de comisión.</p>
        <div className="table-wrap cards-sm"><table className="list"><thead><tr><th>Servicio</th><th className="num">Hechos</th><th className="num">Cobrado</th><th className="num">Te queda</th><th className="num">%</th></tr></thead><tbody>
          {d.services.map((s: any) => <tr key={s.id}><td data-label="Servicio"><b>{s.name}</b>{!s.costKnown && <><br /><small className="muted">sin costo capturado</small></>}{s.materials.length > 0 && <><br /><small className="muted">usa: {s.materials.map((m: any) => `${m.qty} ${m.name}`).join(', ')}</small></>}</td><td data-label="Hechos" className="num">{s.sold}</td><td data-label="Cobrado" className="num">{mxn(s.revenue)}</td><td data-label="Te queda" className={`num ${s.profit < 0 ? 'neg' : ''}`}>{mxn(s.profit)}</td><td data-label="%" className="num">{s.costKnown ? <Pct v={s.marginPct} /> : '—'}</td></tr>)}
          {d.services.length === 0 && <tr><td className="empty" colSpan={5}>Todavía no hay servicios cobrados en este periodo.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="card">
        <h2>Ganancia por persona</h2>
        <p className="muted small">Lo que dejó cada quien después de materiales y su comisión (sin contar sueldos fijos).</p>
        <div className="table-wrap cards-sm"><table className="list"><thead><tr><th>Persona</th><th className="num">Servicios</th><th className="num">Cobrado</th><th className="num">Comisión</th><th className="num">Te queda</th></tr></thead><tbody>
          {d.staff.map((s: any, i: number) => <tr key={s.staffId ?? i}><td data-label="Persona"><b>{s.name ?? 'Sin responsable registrado'}</b></td><td data-label="Servicios" className="num">{s.services}</td><td data-label="Cobrado" className="num">{mxn(s.revenue)}</td><td data-label="Comisión" className="num">{mxn(s.commission)}</td><td data-label="Te queda" className={`num ${s.profit < 0 ? 'neg' : ''}`}>{mxn(s.profit)}</td></tr>)}
          {d.staff.length === 0 && <tr><td className="empty" colSpan={5}>Sin datos todavía.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}

function Platillos({ from, to }: { from: string; to: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); api<any>('GET', `/auto/platillos?from=${from}&to=${to}`).then(setD).catch((e) => setErr(e.message)) }, [from, to])
  if (err) return <p className="error">{err}</p>
  if (!d) return <p className="muted">Calculando…</p>
  return (
    <>
      <Falta items={d.falta} />
      {d.alertas.length > 0 && <section className="card"><h2>Alertas</h2><ul className="plan-reasons">{d.alertas.map((a: string) => <li key={a}>{a}</li>)}</ul></section>}
      <section className="card">
        <h2>Costo y ganancia de cada platillo</h2>
        <p className="muted small">El costo sale de la receta con el último costo de cada ingrediente.</p>
        <div className="table-wrap cards-sm"><table className="list"><thead><tr><th>Platillo</th><th className="num">Precio</th><th className="num">Cuesta</th><th className="num">Ganas</th><th className="num">%</th><th className="num">Vendidos</th></tr></thead><tbody>
          {d.platillos.map((p: any) => <tr key={p.id}><td data-label="Platillo"><b>{p.name}</b>{!p.complete && <><br /><small className="muted">receta incompleta</small></>}</td><td data-label="Precio" className="num">{mxn(p.price)}</td><td data-label="Cuesta" className="num">{p.recipeCost === null ? '—' : mxn(p.recipeCost)}</td><td data-label="Ganas" className="num">{p.gain === null ? '—' : mxn(p.gain)}</td><td data-label="%" className="num"><Pct v={p.marginPct} /></td><td data-label="Vendidos" className="num">{p.sold}</td></tr>)}
          {d.platillos.length === 0 && <tr><td className="empty" colSpan={6}>Ningún platillo tiene receta todavía.</td></tr>}
        </tbody></table></div>
      </section>
      <div className="grid2">
        <section className="card">
          <h2>Lo que se gastó de ingredientes</h2>
          <div className="table-wrap cards-sm"><table className="list"><tbody>
            {d.ingredientes.map((i: any) => <tr key={i.id}><td data-label="Ingrediente"><b>{i.name}</b><br /><small className="muted">hay {Math.round(i.stock * 100) / 100} {i.unit}{i.belowMin ? ' · por debajo del mínimo' : ''}{i.costChangePct !== null ? ` · costo ${i.costChangePct > 0 ? '+' : ''}${i.costChangePct}%` : ''}</small></td><td data-label="Usado" className="num">{Math.round(i.used * 100) / 100} {i.unit}</td><td data-label="Costo" className="num">{mxn(i.cost)}</td></tr>)}
            {d.ingredientes.length === 0 && <tr><td className="empty">Aún no se han vendido platillos con receta en este periodo.</td></tr>}
          </tbody></table></div>
        </section>
        <section className="card">
          <h2>Desperdicio</h2>
          <div className="plan-amount" style={{ color: 'var(--ink)' }}>{mxn(d.desperdicio.total)}</div>
          {d.desperdicio.pctOfSales !== null && <p className="muted small">{d.desperdicio.pctOfSales}% de lo vendido en platillos.</p>}
          {d.desperdicio.nota && <p className="muted">{d.desperdicio.nota}</p>}
          <div className="table-wrap cards-sm"><table className="list"><tbody>{d.desperdicio.items.map((w: any) => <tr key={w.id}><td data-label="Producto">{w.name}</td><td data-label="Cantidad" className="num">{Math.round(w.qty * 100) / 100} {w.unit}</td><td data-label="Costo" className="num">{mxn(w.cost)}</td></tr>)}</tbody></table></div>
        </section>
      </div>
    </>
  )
}

function Productos({ from, to }: { from: string; to: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setD(null); api<any>('GET', `/auto/productos?from=${from}&to=${to}`).then(setD).catch((e) => setErr(e.message)) }, [from, to])
  if (err) return <p className="error">{err}</p>
  if (!d) return <p className="muted">Calculando…</p>
  return (
    <>
      <Falta items={d.falta} />
      {d.consejos.length > 0 && <section className="card"><h2>Lo que conviene revisar</h2><ul className="plan-reasons">{d.consejos.map((c: string) => <li key={c}>{c}</li>)}</ul></section>}
      <section className="card">
        <h2>Lo que más ganancia deja</h2>
        <div className="table-wrap cards-sm"><table className="list"><thead><tr><th>Producto</th><th className="num">Vendidos</th><th className="num">Te queda</th><th className="num">%</th></tr></thead><tbody>
          {d.top.map((p: any) => <tr key={p.id}><td data-label="Producto"><b>{p.name}</b></td><td data-label="Vendidos" className="num">{p.sold}</td><td data-label="Te queda" className="num">{mxn(p.profit)}</td><td data-label="%" className="num"><Pct v={p.marginPct} /></td></tr>)}
          {d.top.length === 0 && <tr><td className="empty" colSpan={4}>Sin ventas con costo capturado en este periodo.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}

export function Rentabilidad({ me, from, to }: { me: Me; from: string; to: string }) {
  const servicios = hasGiro(me, ...AGENDA_GIROS)
  const comida = hasGiro(me, ...FOOD_GIROS)
  const tienda = hasGiro(me, ...TIENDAS)
  return (
    <div className="stack">
      {servicios && <Servicios from={from} to={to} />}
      {comida && <Platillos from={from} to={to} />}
      {tienda && <Productos from={from} to={to} />}
      {!servicios && !comida && !tienda && <section className="card"><p className="muted">Para tu tipo de negocio todavía no hay un análisis de rentabilidad específico.</p></section>}
    </div>
  )
}
