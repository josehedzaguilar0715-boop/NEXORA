import { useEffect, useState } from 'react'
import { api, mxn } from '../api'

/** Comprobante digital de una compra (enlace privado). Es un comprobante de venta, no una factura (CFDI). */
export function Comprobante({ token }: { token: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<any>('GET', `/public/receipt/${token}`).then(setD).catch((e) => setErr(e.message)) }, [token])
  if (!d) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  const r = d.receipt
  const fecha = new Date(r.date).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short', hour12: true })
  return (
    <main className="login">
      {r.logoUrl && <img src={r.logoUrl} alt={`Logotipo de ${r.business}`} style={{ maxHeight: 72, maxWidth: 200, objectFit: 'contain' }} />}
      <h1>{r.business}</h1>
      {r.branch && <p className="muted">Sucursal {r.branch}</p>}
      <div className="card">
        <p className="muted">Folio {r.folio} · {fecha}{r.cancelled ? ' · CANCELADO' : ''}</p>
        <div className="table-wrap"><table className="list"><tbody>
          {r.items.map((i: any, k: number) => <tr key={k}><td>{i.quantity} × {i.description}</td><td className="num">{mxn(i.total)}</td></tr>)}
          {r.discount > 0 && <tr><td>Descuento</td><td className="num">−{mxn(r.discount)}</td></tr>}
          <tr className="total"><td><b>Total</b></td><td className="num"><b>{mxn(r.total)}</b></td></tr>
        </tbody></table></div>
        <p className="muted">{r.payments.map((p: any) => `${p.method}: ${mxn(p.amount)}`).join(' · ')}{r.change ? ` · Cambio ${mxn(r.change)}` : ''}</p>
        <p className="muted small">Atendió: {r.cashier}</p>
      </div>
      <p className="muted small">{d.legend}</p>
      {r.phone && <p className="muted small">Dudas: {r.phone}</p>}
    </main>
  )
}
