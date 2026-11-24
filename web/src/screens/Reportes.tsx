import { useEffect, useState } from 'react'
import { api, fechaHora, hora, mxn, toCents } from '../api'
import type { Me } from '../App'
import { vocab } from '../giros'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()
const monthRange = (ym: string) => {
  const end = `${ym}-${String(lastDay(ym)).padStart(2, '0')}`
  const t = today()
  return { from: `${ym}-01`, to: end > t && t >= `${ym}-01` ? t : end }
}
const addMonth = (ym: string, d: number) => { const x = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + d, 1)); return x.toISOString().slice(0, 7) }
const METODO: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', fiado: 'Fiado' }
const metodo = (m: string) => m.split(' + ').map((x) => METODO[x] ?? x).join(' + ')

/** Descarga un CSV que Excel abre directo (con BOM para los acentos). */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export function Reportes({ me }: { me: Me }) {
  const [month, setMonth] = useState(today().slice(0, 7))
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState(monthRange(today().slice(0, 7)).from)
  const [to, setTo] = useState(monthRange(today().slice(0, 7)).to)
  const [day, setDay] = useState(today())
  const [cashier, setCashier] = useState('')
  const [board, setBoard] = useState<any>(null)
  const [log, setLog] = useState<any[]>([])
  const [r, setR] = useState<any>(null)
  const [fixed, setFixed] = useState<any>(null)
  const [f, setF] = useState({ concept: '', amount: '', days: '' })
  const [err, setErr] = useState('')
  const owner = me.user.role === 'owner'
  const load = async () => {
    try {
      const [s, bd, lg] = await Promise.all([
        api<any>('GET', `/reports/summary?from=${from}&to=${to}`),
        api<any>('GET', `/reports/board?from=${from}&to=${to}&day=${day}${cashier ? `&cashierId=${cashier}` : ''}`),
        api<any>('GET', `/reports/stock-log?from=${from}&to=${to}`),
      ])
      setR(s); setBoard(bd); setLog(lg.movements)
      if (owner) {
        setFixed(await api('GET', '/fixed-expenses'))
      }
    } catch (e) { setErr((e as Error).message) }
  }
  useEffect(() => { void load() }, [from, to, day, cashier])
  const goMonth = (ym: string) => { const m = monthRange(ym); setMonth(ym); setCustom(false); setFrom(m.from); setTo(m.to); setDay(m.to) }
  const isCurrent = month === today().slice(0, 7)
  const D = board?.dayKpis, P = board?.period
  const dayLabel = day === today() ? 'hoy' : new Date(`${day}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  const periodLabel = custom ? 'del periodo' : 'del mes'
  const exportTickets = () => downloadCsv(`ventas-${day}.csv`, [
    ['Folio', 'Fecha y hora', 'Cajero', 'Cliente', 'Artículos', 'Forma de pago', 'Estado', 'Total'],
    ...board.tickets.map((x: any) => [x.folio, fechaHora(x.at), x.cashier, x.customer ?? '', x.items, metodo(x.method), x.status === 'cancelada' ? 'Cancelada' : 'Pagada', (x.total / 100).toFixed(2)]),
  ])
  const exportLog = () => downloadCsv(`movimientos-${from}-a-${to}.csv`, [
    ['Fecha y hora', 'Movimiento', 'Producto', 'Cantidad', 'Costo', 'Usuario', 'Motivo'],
    ...log.map((m: any) => [fechaHora(m.at), m.label, m.product, m.qty, (Math.abs(m.cost) / 100).toFixed(2), m.user, m.reason ?? '']),
  ])
  const run = (fn: () => Promise<unknown>) => async () => { try { await fn(); await load(); setErr('') } catch (e) { setErr((e as Error).message) } }

  // Resta sin mostrar "−$0.00".
  const minus = (n: number) => mxn(n ? -n : 0)
  return (
    <div>
      <div className="rep-head">
        <div className="month-nav">
          <button className="mini nav-btn" aria-label="Mes anterior" onClick={() => goMonth(addMonth(month, -1))}>‹</button>
          <b>{custom ? 'Periodo personalizado' : `${MESES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`}</b>
          <button className="mini nav-btn" aria-label="Mes siguiente" disabled={isCurrent && !custom} onClick={() => goMonth(addMonth(month, 1))}>›</button>
        </div>
        <div className="rep-filters">
          {custom ? <>
            <label>Desde<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>Hasta<input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setDay(e.target.value) }} /></label>
            <button className="mini" onClick={() => goMonth(month)}>Ver por mes</button>
          </> : <button className="mini" onClick={() => setCustom(true)}>Elegir fechas</button>}
          {board?.cashiers.length > 1 && <label>Cajero<select value={cashier} onChange={(e) => setCashier(e.target.value)}><option value="">Todos</option>{board.cashiers.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="dash-kpis rep-kpis">
        <div className="card dkpi"><span className="dkpi-label">Ventas de {dayLabel}</span><div className="dkpi-value pos">{D ? mxn(D.sales) : '—'}</div><div className="dkpi-sub">{D ? `${D.tickets} ${D.tickets === 1 ? 'ticket' : 'tickets'}` : ''}</div></div>
        <div className="card dkpi"><span className="dkpi-label">Ganancia de {dayLabel}</span><div className={`dkpi-value ${D?.profit < 0 ? 'neg' : 'pos'}`}>{D ? mxn(D.profit) : '—'}</div><div className="dkpi-sub">ventas − costo de lo vendido</div></div>
        <div className="card dkpi"><span className="dkpi-label">Ventas {periodLabel}</span><div className="dkpi-value">{P ? mxn(P.sales) : '—'}</div><div className="dkpi-sub">{P ? `${P.tickets} tickets` : ''}</div></div>
        <div className="card dkpi"><span className="dkpi-label">Ganancia {periodLabel}</span><div className={`dkpi-value ${P?.profit < 0 ? 'neg' : 'pos'}`}>{P ? mxn(P.profit) : '—'}</div><div className="dkpi-sub">antes de gastos</div></div>
        <div className="card dkpi"><span className="dkpi-label">Ticket promedio</span><div className="dkpi-value">{P ? mxn(P.avgTicket) : '—'}</div><div className="dkpi-sub">por venta {periodLabel}</div></div>
        {board?.sellsBulk && <div className="card dkpi"><span className="dkpi-label">{vocab(me).bulk} {periodLabel}</span><div className="dkpi-value warn">{P ? mxn(P.bulk) : '—'}</div><div className="dkpi-sub">por kilo, litro o metro</div></div>}
      </div>
      <div className="grid2 config">
      <section className="card">
        <div className="card-head"><h2>Tickets del día</h2>{board?.tickets.length > 0 && <button className="mini" onClick={exportTickets}>Exportar a Excel</button>}</div>
        <label className="tk-day">Día<input type="date" value={day} min={from} max={to} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
        <div className="table-wrap tickets-wrap"><table className="list tickets"><thead><tr><th>Folio</th><th>Hora</th><th>Cajero</th><th>Pago</th><th className="num">Total</th></tr></thead><tbody>
          {board?.tickets.map((x: any) => <tr key={x.id} className={x.status === 'cancelada' ? 'muted strike' : ''}><td>#{x.folio}</td><td>{hora(x.at)}</td><td>{x.cashier}{x.customer && <><br /><small className="muted">{x.customer}</small></>}</td><td>{metodo(x.method)}{x.status === 'cancelada' && <><br /><small>Cancelada</small></>}</td><td className="num"><b>{mxn(x.total)}</b></td></tr>)}
          {board && board.tickets.length === 0 && <tr><td colSpan={5} className="empty">Sin ventas este día.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Estado {periodLabel}</h2></div>
        {r && (
          <div className="table-wrap"><table className="list statement"><tbody>
            <tr><td>Ventas ({r.sales.tickets} {r.sales.tickets === 1 ? 'ticket' : 'tickets'})</td><td className="num"><b>{mxn(r.sales.total)}</b></td></tr>
            {(['efectivo', 'transferencia', 'tarjeta', 'fiado'] as const).filter((k) => k !== 'fiado' || r.sales.fiado).map((k) => <tr key={k} className="indent"><td>{k[0]!.toUpperCase() + k.slice(1)}</td><td className="num muted">{mxn(r.sales[k])}</td></tr>)}
            <tr><td>Costo de lo vendido</td><td className="num">{minus(r.costOfSales)}</td></tr>
            {r.waste > 0 && <tr><td>Mermas</td><td className="num">{minus(r.waste)}</td></tr>}
            <tr><td>Gastos</td><td className="num">{minus(r.expenses)}</td></tr>
            {r.commissions > 0 && <tr><td>Comisiones del personal</td><td className="num">{minus(r.commissions)}</td></tr>}
            <tr className={`total ${r.profit < 0 ? 'neg' : ''}`}><td>Utilidad</td><td className="num">{mxn(r.profit)}</td></tr>
            {r.cancelled > 0 && <tr className="muted"><td>Ventas canceladas</td><td className="num">{r.cancelled}</td></tr>}
          </tbody></table></div>
        )}
        <h3 style={{ marginTop: 18 }}>Más vendidos</h3>
        <div className="table-wrap"><table className="list"><tbody>
          {r?.topProducts.map((t: any, i: number) => <tr key={i}><td>{t.description}</td><td className="num muted">{t.qty}</td><td className="num">{mxn(t.total)}</td></tr>)}
          {r && r.topProducts.length === 0 && <tr><td className="empty">Sin ventas en este periodo.</td></tr>}
        </tbody></table></div>
        <p className="muted small" style={{ marginTop: 14 }}>Los gastos se registran en <a href="#/finanzas">Finanzas → Gastos</a>.</p>
      </section>
      <section className="card plan-wrap">
        <div className="card-head"><h2>Bitácora de movimientos {periodLabel}</h2>{log.length > 0 && <button className="mini" onClick={exportLog}>Exportar a Excel</button>}</div>
        <p className="muted small">Entradas por compra, mermas, ajustes y traspasos, con quién los hizo. Las ventas están en los tickets.</p>
        <div className="table-wrap moves-log"><table className="list"><tbody>
          {log.map((m: any, i: number) => <tr key={i}><td><b>{m.product}</b><br /><small className="muted">{m.label}{m.reason ? ` · ${m.reason}` : ''} · {m.user} · {fechaHora(m.at)}</small></td><td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}><b>{m.qty > 0 ? '+' : ''}{m.qty} {m.unit === 'pieza' ? 'pzas' : m.unit}</b></td></tr>)}
          {log.length === 0 && <tr><td className="empty">Sin movimientos de inventario en este periodo.</td></tr>}
        </tbody></table></div>
      </section>
      {owner && (
        <section className="card">
          <h2>Gastos fijos y reserva</h2>
          <p className="muted small">En Finanzas → Mi dinero, el dinero «por reservar» guarda primero estos días de gastos fijos para que el negocio nunca se quede en 0.</p>
          <h3 style={{ marginTop: 18 }}>Días de reserva</h3>
          <p className="muted small">Cuántos días de gastos fijos quieres tener guardados siempre. {fixed?.reserveDays != null ? `Hoy: ${fixed.reserveDays} días.` : 'Si no lo cambias, se guardan 30 días.'}</p>
          <div className="row"><input aria-label="Días de reserva" inputMode="numeric" placeholder={fixed?.reserveDays != null ? String(fixed.reserveDays) : 'Ej. 30'} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /><button style={{ flex: '0 0 auto' }} disabled={f.days.trim() === ''} onClick={run(async () => { await api('PUT', '/reserve-days', { days: Number(f.days) }); setF({ ...f, days: '' }) })}>Guardar días</button></div>
          <h3 style={{ marginTop: 18 }}>Gastos fijos al mes</h3>
          <div className="table-wrap"><table className="list"><tbody>
            {fixed?.fixedExpenses.map((x: any) => <tr key={x.id}><td>{x.concept}</td><td className="num">{mxn(x.monthlyAmount)}</td></tr>)}
            {fixed && fixed.fixedExpenses.length === 0 && <tr><td className="muted">Renta, luz, agua, internet, sueldos fijos…</td></tr>}
          </tbody></table></div>
          <label>Concepto<input placeholder="Ej. Renta del local" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} /></label>
          <div className="row"><label>Cuánto al mes<input inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label><button style={{ flex: '0 0 auto', alignSelf: 'end' }} disabled={!(toCents(f.amount) > 0 && f.concept.trim().length >= 2)} onClick={run(async () => { await api('POST', '/fixed-expenses', { concept: f.concept, monthlyAmount: toCents(f.amount) }); setF({ ...f, concept: '', amount: '' }) })}>Agregar</button></div>
        </section>
      )}
      </div>
    </div>
  )
}
