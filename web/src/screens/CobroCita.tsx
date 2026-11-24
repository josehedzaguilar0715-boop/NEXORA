import { useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Loyalty } from './Caja'

/** Cobro de una cita terminada. Solo se usa desde Caja: la agenda no cobra. */
export function CobroCita({ appt, onClose, onDone }: { appt: any; onClose: () => void; onDone: (total: number, loyalty: Loyalty | null | undefined, saleId: string) => void }) {
  const [method, setMethod] = useState('efectivo')
  const [tip, setTip] = useState('')
  const [err, setErr] = useState('')
  const total = appt.services.reduce((a: number, s: any) => a + s.price, 0)
  const pay = async () => {
    try {
      const r = await api<any>('POST', `/appointments/${appt.id}/checkout`, { id: crypto.randomUUID(), paymentMethod: method, ...(toCents(tip) > 0 ? { tips: [{ staffId: appt.staffId, amount: toCents(tip) }] } : {}) })
      onDone(r.sale.total, r.loyalty, r.sale.id)
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>Cobrar a {appt.customerName}</h2>
        <p className="muted">{appt.services.map((s: any) => `${s.name} ${mxn(s.price)}`).join(' · ')} · atendió {appt.staffName}</p>
        <div className="total">{mxn(total)}</div>
        <div className="tabs">{['efectivo', 'transferencia', 'tarjeta'].map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>)}</div>
        <label>Propina para {appt.staffName} (aparte)<input inputMode="decimal" placeholder="$0.00" value={tip} onChange={(e) => setTip(e.target.value)} /></label>
        {err && <p className="error">{err}</p>}
        <p className="row"><button onClick={onClose}>Volver</button><button className="primary big" onClick={pay}>Cobrar</button></p>
      </div>
    </div>
  )
}
