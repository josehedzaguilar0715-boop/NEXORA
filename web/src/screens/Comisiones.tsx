import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import type { Me } from '../App'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

/** Comisiones y propinas por persona. Cada quien ve las suyas; el dueño, las de todos. */
export function Comisiones(_: { me: Me }) {
  const [from, setFrom] = useState(today().slice(0, 8) + '01')
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  useEffect(() => { api<any>('GET', `/reports/commissions?from=${from}&to=${to}`).then((r) => setRows(r.staff)).catch((e) => setErr(e.message)) }, [from, to])
  return (
    <div className="card" style={{ maxWidth: 900 }}>
      <h2>Comisiones y propinas</h2>
      <div className="row"><label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      {err && <p className="error">{err}</p>}
      <table className="list">
        <thead><tr><th>Persona</th><th className="num">Vendido</th><th className="num">Comisión</th><th className="num">Propinas</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.staffId}><td>{r.name}</td><td className="num">{mxn(r.base)}</td><td className="num"><b>{mxn(r.commission)}</b></td><td className="num">{mxn(r.tips)}<br /><small className="muted">efectivo {mxn(r.tipsCash)}</small></td></tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className="muted">Sin comisiones en este periodo.</p>}
    </div>
  )
}
