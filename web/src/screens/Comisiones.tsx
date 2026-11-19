import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import type { Me } from '../App'
import { vocab } from '../giros'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

/** Comisiones y propinas por persona. Cada quien ve las suyas; el dueño, las de todos. */
export function Comisiones({ me }: { me: Me }) {
  const tips = vocab(me).tips
  const [from, setFrom] = useState(today().slice(0, 8) + '01')
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  useEffect(() => { api<any>('GET', `/reports/commissions?from=${from}&to=${to}`).then((r) => setRows(r.staff)).catch((e) => setErr(e.message)) }, [from, to])
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <h2>{tips ? 'Comisiones y propinas' : 'Comisiones'}</h2>
      <div className="row"><label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      {err && <p className="error">{err}</p>}
      <div className="table-wrap"><table className="list">
        <thead><tr><th>Persona</th><th className="num hide-sm">Vendido</th><th className="num">Comisión</th>{tips && <th className="num">Propinas</th>}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.staffId}><td>{r.name}<br /><small className="muted">vendió {mxn(r.base)}</small></td><td className="num hide-sm">{mxn(r.base)}</td><td className="num"><b>{mxn(r.commission)}</b></td>{tips && <td className="num">{mxn(r.tips)}<br /><small className="muted">efectivo {mxn(r.tipsCash)}</small></td>}</tr>)}</tbody>
      </table></div>
      {rows.length === 0 && <p className="muted">Sin comisiones en este periodo.</p>}
    </div>
  )
}
