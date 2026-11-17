import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import type { Me } from '../App'
import type { Service } from './Caja'

/** Baños públicos: cobro al entrar con tarifas combinadas, pases con QR, salidas por tiempo, conteo y limpieza. */
export function Entradas(_: { me: Me }) {
  const [services, setServices] = useState<(Service & { attrs?: any })[]>([])
  const [sel, setSel] = useState<Record<string, number>>({})
  const [code, setCode] = useState('')
  const [count, setCount] = useState<any>(null)
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([])
  const [log, setLog] = useState<any[]>([])
  const [open, setOpen] = useState<any[]>([])
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setServices((await api<any>('GET', '/services')).services.filter((s: any) => s.active))
    setCount(await api('GET', '/reports/accesses').catch(() => null))
    setTasks((await api<any>('GET', '/cleaning/tasks')).tasks.filter((t: any) => t.active))
    setLog((await api<any>('GET', '/cleaning/log')).log)
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const timed = (s: any) => !!s.attrs?.timeRate
  const total = services.filter((s) => sel[s.id] && !timed(s)).reduce((a, s) => a + s.price * sel[s.id]!, 0)
  const charge = async (method: string) => {
    try {
      const r = await api<any>('POST', '/baths/entry', { id: crypto.randomUUID(), paymentMethod: method, services: Object.entries(sel).map(([serviceId, quantity]) => ({ serviceId, quantity })) })
      if (r.sale) setMsg({ ok: `Entrada cobrada: ${mxn(r.sale.total)} · folio ${r.sale.folio}` })
      else setMsg({ ok: 'Entrada registrada. Se cobra a la salida.' })
      const t = services.find((s) => sel[s.id] && timed(s))
      if (t) setOpen([...open, { accessId: r.accessId, name: t.name, at: new Date() }])
      setSel({})
      void load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const pass = async () => {
    try { const r = await api<any>('POST', '/baths/pass-entry', { code }); setMsg({ ok: `Pase válido: ${r.customer}. Bienvenido.` }); setCode(''); void load() } catch (e) { setMsg({ err: (e as Error).message }); setCode('') }
  }
  const exit = async (a: any) => {
    try { const r = await api<any>('POST', `/baths/accesses/${a.accessId}/exit`, { paymentMethod: 'efectivo' }); setMsg({ ok: `${a.name}: ${r.minutes} min, ${mxn(r.sale.total)}` }); setOpen(open.filter((x) => x !== a)); void load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Nueva entrada</h2>
        <div className="results">{services.map((s) => (
          <button key={s.id} className={sel[s.id] ? 'primary' : ''} onClick={() => setSel({ ...sel, [s.id]: (sel[s.id] ?? 0) + 1 })}>
            {s.name}{sel[s.id] ? ` × ${sel[s.id]}` : ''}<small>{timed(s) ? `${mxn(s.attrs.timeRate.blockPrice)} cada ${s.attrs.timeRate.blockMin} min` : mxn(s.price)}</small>
          </button>
        ))}</div>
        <div className="total">{mxn(total)}</div>
        <div className="pay">
          <button className="primary big" disabled={!Object.keys(sel).length} onClick={() => charge('efectivo')}>Efectivo</button>
          <button className="big" disabled={!Object.keys(sel).length} onClick={() => charge('transferencia')}>Transferencia</button>
          <button className="big" disabled={!Object.keys(sel).length} onClick={() => charge('tarjeta')}>Tarjeta</button>
          <button className="big" onClick={() => setSel({})}>Limpiar</button>
        </div>
        <h3 style={{ marginTop: 16 }}>Entrada con pase</h3>
        <div className="row"><input aria-label="Código del pase" placeholder="Escanea el QR del pase" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && pass()} /><button style={{ flex: '0 0 auto' }} disabled={!code} onClick={pass}>Validar</button></div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        {open.length > 0 && (<><h3>Por tiempo (adentro)</h3>{open.map((a) => <p key={a.accessId} className="row"><span>{a.name} · desde {a.at.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span><button className="primary" onClick={() => exit(a)}>Cobrar salida</button></p>)}</>)}
      </section>
      <section>
        <div className="card">
          <h2>Accesos de hoy: {count?.total ?? 0}</h2>
          {count && <p className="muted">{Object.entries(count.byService).map(([k, v]) => `${k}: ${v}`).join(' · ')}{count.byKind?.pase ? ` · con pase: ${count.byKind.pase}` : ''}</p>}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Limpieza</h2>
          <div className="results">{tasks.map((t) => <button key={t.id} onClick={async () => { await api('POST', '/cleaning/log', { taskId: t.id }); void load() }}>✔ {t.name}</button>)}</div>
          <table className="list"><tbody>{log.map((l, i) => <tr key={i}><td>{new Date(l.at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td><td>{l.task}</td><td className="muted">{l.who}</td></tr>)}</tbody></table>
        </div>
      </section>
    </div>
  )
}
