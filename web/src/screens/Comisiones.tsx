import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import { can, hasGiro, type Me } from '../App'
import { ask, askCode } from '../Dialog'
import { vocab } from '../giros'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const when = (iso: string) => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Comisiones y propinas por persona. Cada quien ve las suyas; el dueño, las de todos. También: lo que falta pagar y los pagos hechos. */
export function Comisiones({ me }: { me: Me }) {
  const tips = vocab(me).tips
  // Restaurante y palapa: solo propinas por mesero (no hay comisiones).
  const comm = hasGiro(me, 'barberia', 'unas', 'perfumeria')
  const manager = me.user.role === 'owner' || can(me, 'cancel_discount')
  const [from, setFrom] = useState(today().slice(0, 8) + '01')
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState<any[]>([])
  const [pending, setPending] = useState<any[] | null>(null)
  const [paid, setPaid] = useState<any[]>([])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => { api<any>('GET', `/reports/commissions?from=${from}&to=${to}`).then((r) => setRows(r.staff)).catch((e) => setErr(e.message)) }, [from, to])
  const loadPay = () => Promise.all([
    api<any>('GET', '/staff-payouts/pending').then((r) => setPending(r.staff)),
    api<any>('GET', '/staff-payouts').then((r) => setPaid(r.payouts)),
  ]).catch((e) => setErr(e.message))
  useEffect(() => { void loadPay() }, [])

  const pay = async (r: any) => {
    setErr(''); setOk('')
    const method = await ask({
      title: `Pagar a ${r.name} ${mxn(r.amount)}`,
      hint: `${comm ? `Comisiones ${mxn(r.commission)}` : ''}${comm && tips ? ' + ' : ''}${tips ? `propinas ${mxn(r.tips)}` : ''}${r.adjustments ? ` − ${mxn(-r.adjustments)} de ventas canceladas ya pagadas` : ''}. Se paga todo lo pendiente hasta hoy.`,
      choices: [{ value: 'efectivo', label: 'Efectivo de mi caja' }, { value: 'transferencia', label: 'Transferencia' }],
    })
    if (!method) return
    const authCode = me.user.role === 'owner' ? undefined : await askCode('Para pagar al personal se necesita el código del dueño.')
    if (me.user.role !== 'owner' && !authCode) return
    setBusy(r.staffId)
    try {
      await api('POST', '/staff-payouts', { id: crypto.randomUUID(), staffId: r.staffId, method, authCode })
      setOk(`Pago a ${r.name} registrado.`)
      await loadPay()
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      {err && <p className="error">{err}</p>}
      {ok && <p className="okmsg">{ok}</p>}
      {pending && pending.length > 0 && <section className="card">
        <h2>{manager ? 'Por pagar' : 'Lo que te deben'}</h2>
        <div className="table-wrap"><table className="list">
          <thead><tr><th>Persona</th>{comm && <th className="num">Comisión</th>}{tips && <th className="num hide-sm">Propinas</th>}<th className="num">Total</th>{manager && <th></th>}</tr></thead>
          <tbody>{pending.map((r) => <tr key={r.staffId}>
            <td>{r.name}{r.adjustments < 0 && <><br /><small className="muted">− {mxn(-r.adjustments)} de ventas canceladas</small></>}</td>
            {comm && <td className="num">{mxn(r.commission)}</td>}{tips && <td className="num hide-sm">{mxn(r.tips)}</td>}
            <td className="num"><b>{mxn(r.amount)}</b></td>
            {manager && <td className="num">{r.amount > 0 ? <button className="primary" disabled={busy === r.staffId} onClick={() => pay(r)}>Pagar</button> : <small className="muted">Se descuenta del siguiente</small>}</td>}
          </tr>)}</tbody>
        </table></div>
      </section>}
      <section className="card">
        <h2>{!comm ? 'Propinas' : tips ? 'Comisiones y propinas' : 'Comisiones'}</h2>
        <div className="row"><label>Desde<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
        <div className="table-wrap"><table className="list">
          <thead><tr><th>Persona</th>{comm && <><th className="num hide-sm">Vendido</th><th className="num">Comisión</th></>}{tips && <th className="num">Propinas</th>}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.staffId}><td>{r.name}{comm && <><br /><small className="muted">vendió {mxn(r.base)}</small></>}</td>{comm && <><td className="num hide-sm">{mxn(r.base)}</td><td className="num"><b>{mxn(r.commission)}</b></td></>}{tips && <td className="num">{mxn(r.tips)}<br /><small className="muted">efectivo {mxn(r.tipsCash)}</small></td>}</tr>)}</tbody>
        </table></div>
        {rows.length === 0 && <p className="muted">{comm ? 'Sin comisiones en este periodo.' : 'Sin propinas en este periodo.'}</p>}
      </section>
      {paid.length > 0 && <section className="card">
        <h2>Pagos hechos</h2>
        <div className="table-wrap"><table className="list">
          <thead><tr><th>Fecha</th><th>Persona</th><th className="num">Importe</th></tr></thead>
          <tbody>{paid.map((p) => <tr key={p.id}><td className="nowrap">{when(p.createdAt)}</td><td>{p.name}<br /><small className="muted">{p.method === 'efectivo' ? 'Efectivo' : 'Transferencia'}</small></td><td className="num">{mxn(p.amount)}</td></tr>)}</tbody>
        </table></div>
      </section>}
    </div>
  )
}
