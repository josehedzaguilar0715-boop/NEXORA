import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

/** Encargos con anticipo: el anticipo entra a la caja; al entregar se cobra el saldo. */
export function Encargos(_: { me: Me }) {
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState({ customerName: '', phone: '', description: '', total: '', deposit: '', dueDate: '', method: 'efectivo' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => setList((await api<any>('GET', '/orders')).orders)
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const save = run(async () => {
    await api('POST', '/orders', { id: crypto.randomUUID(), customerName: f.customerName, phone: f.phone || undefined, description: f.description, total: toCents(f.total), deposit: toCents(f.deposit || '0'), paymentMethod: f.method, dueDate: f.dueDate || undefined })
    setF({ ...f, customerName: '', phone: '', description: '', total: '', deposit: '', dueDate: '' })
  }, 'Encargo guardado y anticipo cobrado.')
  const cancel = (o: any) => {
    const reason = prompt('¿Por qué se cancela?')
    if (!reason) return
    const refund = o.deposit > 0 && confirm(`¿Devolver el anticipo de ${mxn(o.deposit)}?`)
    const code = prompt('Código del dueño:')
    if (!code) return
    void run(() => api('POST', `/orders/${o.id}/cancel`, { refundDeposit: refund, reason, authCode: code }), 'Encargo cancelado.')()
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Nuevo encargo</h2>
        <div className="row"><label>Cliente<input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></label><label>Teléfono<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label></div>
        <label>¿Qué se va a hacer?<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="row"><label>Total<input inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label><label>Anticipo<input inputMode="decimal" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} /></label></div>
        <div className="row"><label>Entrega<input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
          <label>Anticipo en<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></label></div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={!f.customerName.trim() || f.description.trim().length < 3 || !(toCents(f.total) > 0)} onClick={save}>Guardar encargo</button></p>
      </section>
      <section className="card">
        <h2>Encargos pendientes</h2>
        <div className="table-wrap"><table className="list"><tbody>{list.map((o) => (
          <tr key={o.id}>
            <td>#{o.folio} {o.customerName}<br /><small className="muted">{o.description}{o.dueDate ? ` · entrega ${o.dueDate}` : ''} · {o.status}</small></td>
            <td className="num">resta {mxn(o.balance)}</td>
            <td>
              {o.status === 'pendiente' && <button onClick={run(() => api('POST', `/orders/${o.id}/ready`), 'Marcado como listo.')}>Listo</button>}
              <button className="primary" onClick={run(() => api('POST', `/orders/${o.id}/deliver`, { paymentMethod: 'efectivo' }), 'Entregado y saldo cobrado.')}>Entregar</button>
              <button onClick={() => cancel(o)}>Cancelar</button>
            </td>
          </tr>
        ))}</tbody></table></div>
      </section>
    </div>
  )
}
