import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

export function Clientes({ me }: { me: Me }) {
  const [list, setList] = useState<any[]>([])
  const [rec, setRec] = useState<{ customers: any[]; total: number }>({ customers: [], total: 0 })
  const [sel, setSel] = useState<any>(null)
  const [credit, setCredit] = useState<any>(null)
  const [q, setQ] = useState('')
  const [f, setF] = useState({ name: '', phone: '', abono: '', method: 'efectivo', limit: '' })
  const [msg, setMsg] = useState('')
  const load = async () => {
    setList((await api<any>('GET', `/customers?q=${encodeURIComponent(q)}`)).customers)
    setRec(await api('GET', '/receivables'))
  }
  useEffect(() => { void load().catch((e) => setMsg(e.message)) }, [q])
  const open = async (c: any) => { setSel(c); setCredit(await api('GET', `/customers/${c.id}/credit`)); setMsg('') }
  const run = (fn: () => Promise<unknown>) => async () => {
    try { await fn(); setMsg(''); if (sel) await open(sel); await load() } catch (e) { setMsg((e as Error).message) }
  }

  return (
    <div className="grid2">
      <section className="card">
        <h2>Clientes · por cobrar {mxn(rec.total)}</h2>
        <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <table className="list"><tbody>
          {list.map((c) => {
            const r = rec.customers.find((x) => x.id === c.id)
            return <tr key={c.id} onClick={() => open(c)} style={{ cursor: 'pointer' }}><td>{c.name}<br /><small className="muted">{c.phone ?? ''}</small></td><td className="num">{r ? mxn(r.balance) : ''}</td></tr>
          })}
        </tbody></table>
        <h3 style={{ marginTop: 14 }}>Nuevo cliente</h3>
        <div className="row"><input placeholder="Nombre" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /><input placeholder="Teléfono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <p><button className="primary" disabled={f.name.trim().length < 2} onClick={run(async () => { await api('POST', '/customers', { name: f.name, phone: f.phone || undefined }); setF({ ...f, name: '', phone: '' }) })}>Agregar</button></p>
      </section>
      <section className="card">
        {!sel ? <p className="muted">Elige un cliente para ver su cuenta.</p> : (
          <>
            <h2>{sel.name}</h2>
            {sel.code && (
              <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
                <img alt={`QR de ${sel.name}`} src={`/api/public/qr/${sel.code}.svg`} width={120} height={120} style={{ flex: '0 0 auto', background: '#fff', borderRadius: 12, padding: 6 }} />
                <p className="muted" style={{ flex: 1 }}>Su código: <b style={{ color: 'var(--ink)' }}>{sel.code}</b><br /><a href={`/api/public/qr/${sel.code}.svg`} download={`qr-${sel.name}.svg`}>Descargar QR</a> para que lo guarde en su teléfono.</p>
              </div>
            )}
            {credit && <>
              <div className="total">Debe {mxn(credit.balance)}</div>
              <p className="muted">Límite {mxn(credit.limit)} · disponible {mxn(credit.available)}</p>
            </>}
            <h3>Recibir abono</h3>
            <div className="row">
              <input inputMode="decimal" placeholder="$0.00" value={f.abono} onChange={(e) => setF({ ...f, abono: e.target.value })} />
              <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select>
            </div>
            <p><button className="primary" disabled={!(toCents(f.abono) > 0)} onClick={run(async () => { await api('POST', `/customers/${sel.id}/credit-payments`, { id: crypto.randomUUID(), amount: toCents(f.abono), method: f.method }); setF({ ...f, abono: '' }) })}>Registrar abono</button></p>
            {me.user.role === 'owner' && (<>
              <h3>Límite de crédito</h3>
              <div className="row"><input inputMode="decimal" placeholder="$0.00" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /><button onClick={run(() => api('PUT', `/customers/${sel.id}/credit-limit`, { limit: toCents(f.limit) }))}>Guardar límite</button></div>
            </>)}
            {msg && <p className="error">{msg}</p>}
            <h3>Movimientos</h3>
            <table className="list"><tbody>{credit?.ledger.map((l: any, i: number) => <tr key={i}><td>{l.kind}{l.method ? ` (${l.method})` : ''}<br /><small className="muted">{new Date(l.createdAt).toLocaleString('es-MX')}</small></td><td className="num">{mxn(l.delta)}</td></tr>)}</tbody></table>
          </>
        )}
      </section>
    </div>
  )
}
