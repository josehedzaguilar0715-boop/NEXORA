import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import type { Me } from '../App'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const day = (d: string) => new Date(`${d}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
const KIND: Record<string, string> = { venta: 'Venta', retiro: 'Retiro de caja', deposito: 'Depósito', compra: 'Compra', gasto: 'Gasto' }

/** Inicio (dashboard): indicadores del día, gráfica de la semana y movimientos recientes. Se actualiza solo. */
export function Inicio({ me }: { me: Me }) {
  const [sum, setSum] = useState<any>(null)
  const [month, setMonth] = useState<any>(null)
  const [days, setDays] = useState<any[]>([])
  const [moves, setMoves] = useState<any[]>([])
  const [rec, setRec] = useState<number | null>(null)
  const [low, setLow] = useState<number | null>(null)
  const load = async () => {
    const t = today()
    const [a, b, c, d] = await Promise.all([
      api('GET', `/reports/summary?from=${t}&to=${t}`),
      api('GET', `/reports/summary?from=${t.slice(0, 8)}01&to=${t}`),
      api<any>('GET', '/reports/daily?days=7'),
      api<any>('GET', '/reports/recent?limit=10'),
    ])
    setSum(a); setMonth(b); setDays(c.days); setMoves(d.movements)
    api<any>('GET', '/receivables').then((r) => setRec(r.total)).catch(() => setRec(null))
    api<any>('GET', '/inventory/low-stock').then((r) => setLow(r.products.length)).catch(() => setLow(null))
  }
  useEffect(() => { void load().catch(() => {}); const t = setInterval(() => void load().catch(() => {}), 30_000); return () => clearInterval(t) }, [])
  const max = Math.max(1, ...days.map((d) => d.total))
  const W = 640, H = 220, pad = 28, bw = (W - pad * 2) / Math.max(1, days.length)
  return (
    <div>
      <h1>Hola, {me.user.name.split(' ')[0]}</h1>
      <p className="muted" style={{ marginTop: -6 }}>{me.business.name} · {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div className="kpis">
        <div className="card kpi"><div className="label">Ventas de hoy</div><div className="value">{sum ? mxn(sum.sales.total) : '—'}</div><div className="hint">{sum ? `${sum.sales.tickets} tickets${sum.cancelled ? ` · ${sum.cancelled} canceladas` : ''}` : ''}</div></div>
        <div className="card kpi"><div className="label">Utilidad del mes</div><div className={`value ${month && month.profit < 0 ? 'neg' : ''}`}>{month ? mxn(month.profit) : '—'}</div><div className="hint">ventas − costo − mermas − gastos</div></div>
        <div className="card kpi"><div className="label">Por cobrar (fiado)</div><div className="value">{rec == null ? '—' : mxn(rec)}</div><div className="hint">saldo de clientes</div></div>
        <div className="card kpi"><div className="label">Productos por surtir</div><div className={`value ${low ? 'neg' : 'pos'}`}>{low ?? '—'}</div><div className="hint">debajo del mínimo</div></div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <section className="card">
          <h2>Ventas de la semana</h2>
          <svg className="chart" viewBox={`0 0 ${W} ${H + 30}`} role="img" aria-label="Ventas de los últimos 7 días">
            <defs>
              <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22D3EE" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={W - pad} y1={H - (H - 20) * f} y2={H - (H - 20) * f} stroke="#232A3A" strokeDasharray="4 6" />)}
            {days.map((d, i) => {
              const h = ((H - 20) * d.total) / max
              return (
                <g key={d.date}>
                  <rect x={pad + i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={Math.max(h, 2)} rx={8} fill="url(#bar)" opacity={d.date === today() ? 1 : 0.65}>
                    <title>{`${day(d.date)}: ${mxn(d.total)} (${d.tickets} tickets)`}</title>
                  </rect>
                  <text x={pad + i * bw + bw / 2} y={H + 22} textAnchor="middle" fill="#7C8799" fontSize="14">{day(d.date)}</text>
                </g>
              )
            })}
          </svg>
          <p className="muted">Total de la semana: <b style={{ color: 'var(--ink)' }}>{mxn(days.reduce((a, d) => a + d.total, 0))}</b></p>
        </section>
        <section className="card">
          <h2>Movimientos recientes</h2>
          <table className="list"><tbody>{moves.map((m, i) => (
            <tr key={i}>
              <td>{KIND[m.kind] ?? m.kind}<br /><small className="muted">{m.label} · {new Date(m.at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}{m.status === 'cancelada' ? ' · cancelada' : ''}</small></td>
              <td className={`num ${m.kind === 'venta' || m.kind === 'deposito' ? (m.status === 'cancelada' ? 'muted' : 'pos') : 'neg'}`}>{m.kind === 'venta' || m.kind === 'deposito' ? '+' : '−'}{mxn(m.amount)}</td>
            </tr>
          ))}</tbody></table>
          {moves.length === 0 && <p className="muted">Todavía no hay movimientos.</p>}
        </section>
      </div>
    </div>
  )
}
