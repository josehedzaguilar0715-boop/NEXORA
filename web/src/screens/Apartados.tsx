import { useEffect, useMemo, useState } from 'react'
import { api, cache, mxn, toCents } from '../api'
import { can, type Me } from '../App'
import { ScanButton } from '../Scanner'
import type { Product } from './Caja'

/**
 * Apartados con anticipo: el cliente aparta mercancía con el precio de hoy, deja un anticipo y abona;
 * se lleva la mercancía cuando liquida. Cancelar pide código.
 */

const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' }
type Status = 'abierto' | 'entregado' | 'cancelado'
const fmtDate = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00-06:00` : d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
const plusDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() + n * 86_400_000))

export function Apartados({ me }: { me: Me }) {
  const [status, setStatus] = useState<Status>('abierto')
  const [list, setList] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => setList((await api<any>('GET', `/layaways?status=${status}`)).layaways)
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [status])
  const shown = list.filter((l) => !q || `${l.folio} ${l.customer.name}`.toLowerCase().includes(q.toLowerCase()))
  const owed = list.filter((l) => l.status === 'abierto').reduce((a, l) => a + l.balance, 0)
  return (
    <div className="page">
      <div className="toolbar">
        <div className="row search"><input aria-label="Buscar apartado" placeholder="Buscar por cliente o folio…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="primary" onClick={() => setAdding(true)}>+ Nuevo apartado</button>
      </div>
      <div className="seg wrap" style={{ marginBottom: 12 }}>
        {(['abierto', 'entregado', 'cancelado'] as Status[]).map((k) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{k === 'abierto' ? 'Abiertos' : k === 'entregado' ? 'Entregados' : 'Cancelados'}</button>)}
      </div>
      {status === 'abierto' && list.length > 0 && <div className="kpis mini"><div><span className="muted">Apartados abiertos</span><b>{list.length}</b></div><div><span className="muted">Por cobrar en apartados</span><b>{mxn(owed)}</b></div></div>}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <section className="card">
        <div className="table-wrap" style={{ border: 0, margin: 0 }}>
          <table className="list">
            <thead><tr><th>Folio</th><th>Cliente</th><th className="num">Total</th><th className="num hide-sm">Pagado</th><th className="num">Resta</th><th className="hide-sm">Recoger antes de</th></tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => setSel(l.id)}>
                  <td><b>#{l.folio}</b></td>
                  <td>{l.customer.name}{l.overdue && <><br /><span className="tag bad">vencido</span></>}</td>
                  <td className="num">{mxn(l.total)}</td>
                  <td className="num hide-sm">{mxn(l.paid)}</td>
                  <td className="num">{l.status === 'abierto' ? <span className={l.balance ? 'pill' : 'pill ok'}>{l.balance ? mxn(l.balance) : 'liquidado'}</span> : <span className="muted">{l.status}</span>}</td>
                  <td className="hide-sm">{l.dueDate ? fmtDate(l.dueDate) : '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="empty">{status === 'abierto' ? 'No hay apartados abiertos. El cliente aparta mercancía con un anticipo y se la lleva al liquidar.' : 'Nada en esta lista.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {adding && <Nuevo me={me} onClose={() => setAdding(false)} onDone={(l) => { setAdding(false); setStatus('abierto'); void load(); setSel(l.id); setMsg({ ok: `Apartado #${l.folio} guardado.` }) }} />}
      {sel && <Detalle me={me} id={sel} onClose={() => setSel(null)} onChanged={() => void load()} />}
    </div>
  )
}

function Nuevo({ me, onClose, onDone }: { me: Me; onClose: () => void; onDone: (l: any) => void }) {
  const [catalog, setCatalog] = useState<(Product & { reserved?: number; active?: boolean })[]>(cache.get('catalog', []))
  const [customers, setCustomers] = useState<{ id: string; name: string; phone?: string | null }[]>([])
  const [cust, setCust] = useState<{ id: string; name: string } | null>(null)
  const [findCust, setFindCust] = useState('')
  const [newCust, setNewCust] = useState({ name: '', phone: '' })
  const [find, setFind] = useState('')
  const [items, setItems] = useState<{ productId: string; name: string; price: number; quantity: string; free: number }[]>([])
  const [f, setF] = useState({ deposit: '', method: 'efectivo', dueDate: plusDays(30) })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api<any>('GET', '/products').then((r) => setCatalog(r.products.filter((p: any) => p.active !== false && p.sellable !== false && p.trackStock !== false))).catch(() => {})
    api<any>('GET', '/customers').then((r) => setCustomers(r.customers)).catch(() => {})
  }, [])
  const total = items.reduce((a, i) => a + Math.round((Number(i.quantity) || 0) * i.price), 0)
  const matches = useMemo(() => (find.trim() ? catalog.filter((p) => p.name.toLowerCase().includes(find.trim().toLowerCase()) || p.barcode === find.trim()).slice(0, 6) : []), [find, catalog])
  const custMatches = findCust.trim() ? customers.filter((c) => c.name.toLowerCase().includes(findCust.toLowerCase()) || (c.phone ?? '').includes(findCust)).slice(0, 6) : customers.slice(0, 6)
  const addP = (p: Product & { reserved?: number }) => {
    if (items.some((i) => i.productId === p.id)) return setFind('')
    setItems([...items, { productId: p.id, name: p.name, price: p.price, quantity: '1', free: Math.max(0, (p.stock ?? 0) - (p.reserved ?? 0)) }])
    setFind('')
  }
  const deposit = toCents(f.deposit || '0')
  const save = async () => {
    setErr(''); setBusy(true)
    try {
      let c = cust
      if (!c) {
        if (newCust.name.trim().length < 2) throw new Error('Elige al cliente o escribe su nombre.')
        c = (await api<any>('POST', '/customers', { name: newCust.name, phone: newCust.phone || undefined })).customer
      }
      const r = await api<any>('POST', '/layaways', { id: crypto.randomUUID(), customerId: c!.id, items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })), deposit, method: f.method, dueDate: f.dueDate || undefined })
      onDone(r.layaway)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>Nuevo apartado</h2><button className="mini" onClick={onClose}>Cerrar</button></div>
        <h3>1. Cliente</h3>
        {cust ? (
          <div className="info-row" style={{ marginTop: 0 }}><b>{cust.name}</b><button className="mini" onClick={() => setCust(null)}>Cambiar</button></div>
        ) : (<>
          <input aria-label="Buscar cliente" placeholder="Buscar cliente por nombre o teléfono…" value={findCust} onChange={(e) => setFindCust(e.target.value)} />
          <div className="chips" style={{ marginTop: 8 }}>{custMatches.map((c) => <button key={c.id} className="chip" onClick={() => setCust(c)}>{c.name}</button>)}</div>
          <p className="muted small" style={{ margin: '10px 0 4px' }}>¿Cliente nuevo? Escribe sus datos:</p>
          <div className="row"><input aria-label="Nombre del cliente nuevo" placeholder="Nombre" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /><input aria-label="Teléfono del cliente nuevo" inputMode="tel" placeholder="Teléfono" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
        </>)}
        <h3 style={{ marginTop: 16 }}>2. Mercancía</h3>
        <div className="row"><input aria-label="Agregar producto al apartado" placeholder="Busca o escanea el producto…" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) addP(matches[0]) }} /><ScanButton onCode={(c) => { const p = catalog.find((x) => x.barcode === c); if (p) addP(p); else setFind(c) }} /></div>
        {matches.length > 0 && <div className="results">{matches.map((p) => <button key={p.id} onClick={() => addP(p)}>{p.name}<small>{mxn(p.price)} · disponibles {Math.max(0, (p.stock ?? 0) - ((p as any).reserved ?? 0))}</small></button>)}</div>}
        <div className="table-wrap"><table className="list" style={{ marginTop: 8 }}><tbody>
          {items.map((i, k) => (
            <tr key={i.productId}>
              <td>{i.name}<br /><small className="muted">{mxn(i.price)} c/u · disponibles {i.free}</small></td>
              <td style={{ width: '6em' }}><input aria-label={`Cantidad de ${i.name}`} inputMode="numeric" value={i.quantity} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, quantity: e.target.value } : x)))} /></td>
              <td className="num">{mxn(Math.round((Number(i.quantity) || 0) * i.price))}</td>
              <td className="num"><button className="mini" onClick={() => setItems(items.filter((_, j) => j !== k))}>✕</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted">Agrega lo que se va a apartar.</td></tr>}
        </tbody></table></div>
        <div className="total">{mxn(total)}</div>
        <h3>3. Anticipo</h3>
        <div className="row">
          <label>Anticipo<input inputMode="decimal" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} placeholder={total ? `Ej. ${mxn(Math.round(total * 0.2))}` : '$0.00'} /></label>
          <label>Forma de pago<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        {total > 0 && <div className="quick">{[0.1, 0.2, 0.3, 0.5].map((x) => <button key={x} type="button" onClick={() => setF({ ...f, deposit: String(Math.round(total * x) / 100) })}>{x * 100}% · {mxn(Math.round(total * x))}</button>)}</div>}
        <label>Recoger a más tardar<input type="date" value={f.dueDate} min={plusDays(0)} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
        {total > 0 && deposit > 0 && <p className="muted">Resta {mxn(Math.max(0, total - deposit))} para llevarse la mercancía.</p>}
        {err && <p className="error">{err}</p>}
        <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary big" disabled={busy || !items.length || !(deposit > 0) || deposit > total} onClick={save}>Apartar y cobrar anticipo</button></p>
        {!can(me, 'open_close_cash') && <p className="muted small">El anticipo en efectivo entra a tu caja abierta.</p>}
      </div>
    </div>
  )
}

function Detalle({ me, id, onClose, onChanged }: { me: Me; id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null)
  const [mode, setMode] = useState<'' | 'abonar' | 'entregar' | 'cancelar'>('')
  const [f, setF] = useState({ amount: '', method: 'efectivo', reason: '', code: '', refund: true })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [ticket, setTicket] = useState('')
  const load = async () => { setD(await api('GET', `/layaways/${id}`)); setTicket((await api<any>('GET', `/layaways/${id}/ticket`)).text) }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [id])
  const go = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); setMode(''); setF({ ...f, amount: '', reason: '', code: '' }); await load(); onChanged(); setMsg({ ok }) } catch (e) { setMsg({ err: (e as Error).message }) } }
  if (!d) return <div className="modal" onClick={onClose}><div className="card" onClick={(e) => e.stopPropagation()}><p className="muted">Cargando…</p></div></div>
  const l = d.layaway
  const open = l.status === 'abierto'
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>Apartado #{l.folio} · {l.customer.name}</h2><button className="mini" onClick={onClose}>Cerrar</button></div>
        <div className="kpis mini">
          <div><span className="muted">Total</span><b>{mxn(l.total)}</b></div>
          <div><span className="muted">Pagado</span><b>{mxn(l.paid)}</b></div>
          <div><span className="muted">Resta</span><b className={l.balance && open ? 'neg' : ''}>{mxn(l.balance)}</b></div>
          {l.dueDate && <div><span className="muted">Recoger antes de</span><b className={l.overdue ? 'neg' : ''}>{fmtDate(l.dueDate)}</b></div>}
        </div>
        {!open && <p className="muted">{l.status === 'entregado' ? `Entregado el ${fmtDate(l.closedAt)}.` : `Cancelado el ${fmtDate(l.closedAt)}: ${l.cancelReason}`}</p>}
        <div className="table-wrap"><table className="list"><tbody>{d.items.map((i: any, k: number) => <tr key={k}><td>{i.quantity} × {i.description}</td><td className="num">{mxn(i.total)}</td></tr>)}</tbody></table></div>
        <h3 style={{ marginTop: 12 }}>Pagos</h3>
        <div className="table-wrap"><table className="list"><tbody>{d.payments.map((p: any, k: number) => <tr key={k}><td>{p.kind === 'anticipo' ? 'Anticipo' : p.kind === 'abono' ? 'Abono' : 'Devolución'} · {METHOD[p.method]}<br /><small className="muted">{new Date(p.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</small></td><td className={`num ${p.amount < 0 ? 'neg' : ''}`}>{mxn(p.amount)}</td></tr>)}</tbody></table></div>
        {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
        {open && mode === '' && (
          <div className="pay" style={{ marginTop: 12 }}>
            {l.balance > 0 && <button className="primary big" onClick={() => setMode('abonar')}>Abonar</button>}
            <button className={l.balance > 0 ? 'big' : 'primary big'} onClick={() => setMode('entregar')}>{l.balance > 0 ? 'Liquidar y entregar' : 'Entregar mercancía'}</button>
            {can(me, 'cancel_discount') && <button className="big" onClick={() => setMode('cancelar')}>Cancelar apartado</button>}
            <button className="big" onClick={() => window.print()}>Imprimir comprobante</button>
          </div>
        )}
        {mode === 'abonar' && (
          <div className="danger-zone">
            <div className="row">
              <label>Abono<input inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder={mxn(l.balance)} /></label>
              <label>Forma de pago<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
            <p className="row"><button onClick={() => setMode('')}>Regresar</button><button className="primary" disabled={!(toCents(f.amount) > 0)} onClick={() => go(() => api('POST', `/layaways/${id}/payments`, { amount: toCents(f.amount), method: f.method }), `Abono de ${mxn(toCents(f.amount))} registrado.`)}>Registrar abono</button></p>
          </div>
        )}
        {mode === 'entregar' && (
          <div className="danger-zone">
            {l.balance > 0 ? (<>
              <p>Resta <b>{mxn(l.balance)}</b>. Cóbralo y entrega la mercancía.</p>
              <label>Forma de pago<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </>) : <p>Está liquidado. Al entregar, la mercancía sale del inventario y se registra la venta.</p>}
            <p className="row"><button onClick={() => setMode('')}>Regresar</button><button className="primary" onClick={() => go(() => api('POST', `/layaways/${id}/deliver`, l.balance > 0 ? { method: f.method } : {}), 'Entregado. Se registró la venta.')}>{l.balance > 0 ? `Cobrar ${mxn(l.balance)} y entregar` : 'Entregar'}</button></p>
          </div>
        )}
        {mode === 'cancelar' && (
          <div className="danger-zone">
            <label>Motivo<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ej. el cliente ya no lo quiere" /></label>
            {l.paid > 0 && (
              <div className="tabs">
                <button className={f.refund ? 'on' : ''} onClick={() => setF({ ...f, refund: true })}>Devolverle {mxn(l.paid)}</button>
                <button className={!f.refund ? 'on' : ''} onClick={() => setF({ ...f, refund: false })}>No se devuelve</button>
              </div>
            )}
            {l.paid > 0 && f.refund && <label>Se devuelve en<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
            <label>Código de autorización<input type="password" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
            <p className="row"><button onClick={() => setMode('')}>Regresar</button><button className="danger" disabled={f.reason.trim().length < 3 || !f.code} onClick={() => go(() => api('POST', `/layaways/${id}/cancel`, { reason: f.reason, authCode: f.code, refund: l.paid > 0 && f.refund, refundMethod: f.method }), 'Apartado cancelado. La mercancía vuelve a estar disponible.')}>Cancelar apartado</button></p>
          </div>
        )}
        <div className="ticket">{ticket}</div>
      </div>
    </div>
  )
}
