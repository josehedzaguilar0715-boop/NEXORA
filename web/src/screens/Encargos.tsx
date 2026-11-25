import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import { ask, askCode, confirmAsk } from '../Dialog'
import type { Me } from '../App'

/** Encargos con anticipo: el anticipo entra a la caja; al entregar se cobra el saldo. */
export function Encargos(_: { me: Me }) {
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState({ customerName: '', phone: '', description: '', total: '', deposit: '', dueDate: '', method: 'efectivo' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
  const load = async () => setList((await api<any>('GET', '/orders')).orders)
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const save = run(async () => {
    await api('POST', '/orders', { id: crypto.randomUUID(), customerName: f.customerName, phone: f.phone || undefined, description: f.description, total: toCents(f.total), deposit: toCents(f.deposit || '0'), paymentMethod: f.method, dueDate: f.dueDate || undefined })
    setF({ ...f, customerName: '', phone: '', description: '', total: '', deposit: '', dueDate: '' })
  }, 'Encargo guardado y anticipo cobrado.')
  const cancel = async (o: any) => {
    const reason = await ask({ title: 'Cancelar encargo', label: 'Motivo', confirmLabel: 'Continuar', danger: true })
    if (!reason) return
    const refund = o.deposit > 0 && await confirmAsk(`¿Devolver el anticipo de ${mxn(o.deposit)}?`, 'Si dices que sí, sale de la caja.')
    const code = await askCode('Para cancelar el encargo se necesita el código del dueño.')
    if (!code) return
    void run(() => api('POST', `/orders/${o.id}/cancel`, { refundDeposit: refund, reason, authCode: code }), 'Encargo cancelado.')()
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Nuevo encargo</h2>
        <h3 className="form-h">1 · ¿Para quién?</h3>
        <div className="row"><label>Cliente<input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></label><label>Teléfono<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label></div>
        <h3 className="form-h">2 · ¿Qué se va a hacer?</h3>
        <label>Descripción<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <h3 className="form-h">3 · Precio y entrega</h3>
        <div className="row"><label>Total<input inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label><label>Anticipo<input inputMode="decimal" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} /></label></div>
        <div className="row"><label>Entrega<input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
          <label>Anticipo en<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></label></div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={!f.customerName.trim() || f.description.trim().length < 3 || !(toCents(f.total) > 0)} onClick={save}>Guardar encargo</button></p>
      </section>
      <section className="card" aria-label="Tablero de encargos">
        <h2>Encargos</h2>
        {list.length === 0 && <p className="muted">No hay encargos pendientes.</p>}
        {([['pendiente', 'Por hacer'], ['listo', 'Listos para entregar']] as const).map(([st, titulo]) => {
          const items = list.filter((o) => o.status === st)
          if (!items.length) return null
          return (
            <div key={st} className="enc-col">
              <h3 className="form-h">{titulo} · {items.length}</h3>
              {items.map((o) => {
                const dias = o.dueDate ? Math.round((Date.parse(o.dueDate) - Date.parse(hoy)) / 86_400_000) : null
                const urg = dias === null ? null : dias < 0 ? { t: 'Vencido', c: 'danger' } : dias === 0 ? { t: 'Entrega hoy', c: 'warn' } : dias <= 2 ? { t: `En ${dias} día${dias === 1 ? '' : 's'}`, c: 'warn' } : null
                const tel = String(o.phone ?? '').replace(/\D/g, '').slice(-10)
                const aviso = `Hola ${String(o.customerName).split(' ')[0]}, tu encargo #${o.folio} ya está listo para recoger.${o.balance > 0 ? ` Resta ${mxn(o.balance)}.` : ''}`
                return (
                  <article key={o.id} className="enc-card">
                    <div className="enc-top"><b>#{o.folio} {o.customerName}</b>{urg && <span className={`pill ${urg.c === "danger" ? "bad" : ""}`}>{urg.t}</span>}</div>
                    <small className="muted">{o.description}{o.dueDate ? ` · entrega ${o.dueDate}` : ''}</small>
                    <div className="enc-top"><span>Resta <b>{mxn(o.balance)}</b></span>
                      <span className="enc-acc">
                        {o.status === 'pendiente' && <button onClick={run(() => api('POST', `/orders/${o.id}/ready`), 'Marcado como listo.')}>Listo</button>}
                        {o.status === 'listo' && tel.length === 10 && <a className="button" href={`https://wa.me/52${tel}?text=${encodeURIComponent(aviso)}`} target="_blank" rel="noopener noreferrer">Avisar por WhatsApp</a>}
                        <button className="primary" onClick={run(() => api('POST', `/orders/${o.id}/deliver`, { paymentMethod: 'efectivo' }), 'Entregado y saldo cobrado.')}>Entregar</button>
                        <button onClick={() => cancel(o)}>Cancelar</button>
                      </span>
                    </div>
                  </article>
                )
              })}
            </div>
          )
        })}
      </section>
    </div>
  )
}
