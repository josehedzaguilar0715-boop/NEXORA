import { useState } from 'react'
import { api, mxn } from '../api'
import { hasGiro, type Me } from '../App'

/** Devoluciones con ticket original (por folio) o sin ticket. Siempre piden código. */
export function Devoluciones({ me }: { me: Me }) {
  const perfume = hasGiro(me, 'perfumeria')
  const [sealed, setSealed] = useState<Record<string, boolean>>({})
  const [folio, setFolio] = useState('')
  const [sale, setSale] = useState<any>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [f, setF] = useState({ method: 'efectivo', reason: '', code: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const find = async () => {
    try { setSale((await api<any>('GET', `/sales/folio/${folio}`)).sale); setMsg({}); setQty({}) } catch (e) { setSale(null); setMsg({ err: (e as Error).message }) }
  }
  const save = async () => {
    try {
      const items = sale.items.filter((i: any) => Number(qty[i.id]) > 0).map((i: any) => ({ saleItemId: i.id, quantity: Number(qty[i.id]), ...(perfume ? { sealed: !!sealed[i.id] } : {}) }))
      const r = await api<any>('POST', '/returns', { id: crypto.randomUUID(), saleId: sale.id, items, refundMethod: sale.paymentMethod === 'fiado' ? 'saldo' : f.method, reason: f.reason, authCode: f.code })
      setMsg({ ok: `Devolución registrada: ${mxn(r.amount)}.` })
      setSale(null); setFolio(''); setF({ ...f, reason: '', code: '' })
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h2>Devolución con ticket</h2>
      <div className="row"><input aria-label="Folio del ticket" inputMode="numeric" placeholder="Folio del ticket" value={folio} onChange={(e) => setFolio(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} /><button className="primary" style={{ flex: '0 0 auto' }} onClick={find}>Buscar</button></div>
      {sale && (
        <>
          <p className="muted">Folio {sale.folio} · {new Date(sale.createdAt).toLocaleString('es-MX')} · {sale.paymentMethod} · {mxn(sale.total)}</p>
          <div className="table-wrap"><table className="list"><tbody>{sale.items.map((i: any) => (
            <tr key={i.id}><td>{i.description}<br /><small className="muted">vendió {i.quantity}</small></td><td style={{ width: 140 }}><input aria-label={`Devolver de ${i.description}`} inputMode="decimal" placeholder="0" value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />{perfume && <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 6 }} checked={!!sealed[i.id]} onChange={(e) => setSealed({ ...sealed, [i.id]: e.target.checked })} />Sellado</label>}</td></tr>
          ))}</tbody></table></div>
          {sale.paymentMethod !== 'fiado' ? (
            <label>Se devuelve en<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo (sale de la caja)</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></label>
          ) : <p className="muted">Venta fiada: se abona a la cuenta del cliente.</p>}
          <label>Motivo<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
          <label>Código de autorización<input type="password" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          <p><button className="primary big" style={{ width: '100%' }} disabled={!Object.values(qty).some((v) => Number(v) > 0) || f.reason.trim().length < 3 || f.code.length < 4} onClick={save}>Registrar devolución</button></p>
        </>
      )}
      {msg.err && <p className="error">{msg.err}</p>}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
    </div>
  )
}
