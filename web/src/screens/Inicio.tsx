import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import { FIADO_GIROS, hasGiro, screensFor, toneStyle, type Me } from '../App'

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
      <Pendientes />
      <QuickActions me={me} />
      <div className="kpis">
        <div className="card kpi"><div className="label">Ventas de hoy</div><div className="value">{sum ? mxn(sum.sales.total) : '—'}</div><div className="hint">{sum ? `${sum.sales.tickets} tickets${sum.cancelled ? ` · ${sum.cancelled} canceladas` : ''}` : ''}</div></div>
        <div className="card kpi"><div className="label">Utilidad del mes</div><div className={`value ${month && month.profit < 0 ? 'neg' : ''}`}>{month ? mxn(month.profit) : '—'}</div><div className="hint">ventas − costo − gastos · <a href="#/finanzas">ver finanzas</a></div></div>
        {hasGiro(me, ...FIADO_GIROS) && <div className="card kpi"><div className="label">Por cobrar (fiado)</div><div className="value">{rec == null ? '—' : mxn(rec)}</div><div className="hint">saldo de clientes</div></div>}
        <div className="card kpi"><div className="label">Productos por surtir</div><div className={`value ${low ? 'neg' : 'pos'}`}>{low ?? '—'}</div><div className="hint">debajo del mínimo</div></div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <section className="card">
          <h2>Ventas de la semana</h2>
          <svg className="chart" viewBox={`0 0 ${W} ${H + 30}`} role="img" aria-label="Ventas de los últimos 7 días">
            <defs>
              <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22D3EE" /><stop offset="1" stopColor="#0891B2" /></linearGradient>
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
          <div className="table-wrap"><table className="list"><tbody>{moves.map((m, i) => (
            <tr key={i}>
              <td>{KIND[m.kind] ?? m.kind}<br /><small className="muted">{m.label} · {new Date(m.at).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })}{m.status === 'cancelada' ? ' · cancelada' : ''}</small></td>
              <td className={`num ${m.kind === 'venta' || m.kind === 'deposito' ? (m.status === 'cancelada' ? 'muted' : 'pos') : 'neg'}`}>{m.kind === 'venta' || m.kind === 'deposito' ? '+' : '−'}{mxn(m.amount)}</td>
            </tr>
          ))}</tbody></table></div>
          {moves.length === 0 && <p className="muted">Todavía no hay movimientos.</p>}
        </section>
      </div>
    </div>
  )
}

/** Lo que más usa cada tipo de negocio, a un toque. */
const QUICK: Record<string, string[]> = {
  barberia: ['caja', 'agenda', 'escanear', 'clientes'], unas: ['caja', 'agenda', 'escanear', 'clientes'],
  restaurante: ['mesas', 'caja', 'cocina', 'pedidos'], palapa: ['mesas', 'caja', 'cocina', 'precios'], taqueria: ['caja', 'mesas', 'carne', 'menu'],
  comedor: ['caja', 'menu', 'clientes'], banos: ['entradas', 'caja', 'escanear'], turistico: ['taquilla', 'acceso', 'caja'],
  verduleria: ['caja', 'precios', 'pedidos', 'cierre'], abarrotes: ['caja', 'productos', 'apartados', 'clientes'],
  ferreteria: ['caja', 'cotizaciones', 'productos', 'clientes'], papeleria: ['caja', 'encargos', 'productos', 'clientes'],
  perfumeria: ['caja', 'productos', 'clientes', 'devoluciones'],
}

function QuickActions({ me }: { me: Me }) {
  const allowed = screensFor(me)
  const giros = me.business.giros ?? [me.business.giro]
  const keys = [...new Set([...giros.flatMap((g) => QUICK[g] ?? []), 'caja', 'productos', 'clientes', 'reportes'])]
  const list = keys.map((k) => allowed.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s).slice(0, 6)
  if (!list.length) return null
  return (
    <div className="quick-actions">
      {list.map((s) => (
        <a key={s.key} href={`#/${s.key}`} className="quick-action" style={toneStyle(s.group)}>
          <span className="qa-icon"><s.icon size={26} strokeWidth={1.9} aria-hidden /></span>
          <b>{s.label}</b>
          {s.desc && <small>{s.desc}</small>}
        </a>
      ))}
    </div>
  )
}

const TONE_TASK: Record<string, string> = { urgente: 'var(--danger)', aviso: 'var(--accent)', info: 'var(--cyan)' }

/** Lo que toca hacer hoy, armado por el sistema: con el botón para resolverlo y los mensajes de WhatsApp listos. */
function Pendientes() {
  const [tasks, setTasks] = useState<any[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [sent, setSent] = useState<string[]>([])
  useEffect(() => {
    const load = () => api<any>('GET', '/today').then((r) => setTasks(r.tasks)).catch(() => setTasks([]))
    void load(); const t = setInterval(load, 60_000); return () => clearInterval(t)
  }, [])
  if (!tasks) return null
  if (!tasks.length) return <section className="card tasks-empty"><b>✓ Todo al día</b><span className="muted">No hay pendientes por ahora. El sistema te avisa aquí cuando haya algo que hacer.</span></section>
  const wa = (phone: string | null | undefined, msg: string) => `https://wa.me/${phone && String(phone).replace(/\D/g, '').length >= 10 ? `52${String(phone).replace(/\D/g, '').slice(-10)}` : ''}?text=${encodeURIComponent(msg)}`
  return (
    <section className="card tasks">
      <h2>Pendientes de hoy <span className="pill">{tasks.length}</span></h2>
      {tasks.map((t) => (
        <div key={t.key} className="task" style={{ '--task': TONE_TASK[t.tone] } as React.CSSProperties}>
          <div className="task-head">
            <div><b>{t.title}</b><small className="muted">{t.detail}</small></div>
            <div className="row" style={{ flex: '0 0 auto', gap: 6 }}>
              {t.items?.length ? <button className="mini" onClick={() => setOpen(open === t.key ? null : t.key)}>{open === t.key ? 'Ocultar' : 'Ver'}</button> : null}
              <a className="button mini-link" href={`#/${t.screen}`} onClick={() => { if (t.key === 'surtir') sessionStorage.setItem('nx_open', 'pedido') }}>{t.action ?? 'Ir'}</a>
            </div>
          </div>
          {open === t.key && t.items?.length > 0 && (
            <div className="table-wrap"><table className="list"><tbody>
              {t.items.map((it: any, i: number) => (
                <tr key={i}>
                  <td>{it.label}{it.sub && <><br /><small className="muted">{it.sub}</small></>}</td>
                  <td className="num">{it.message && <a className={`button mini-link ${sent.includes(t.key + i) ? '' : 'primary'}`} href={wa(it.phone, it.message)} target="_blank" rel="noreferrer" onClick={() => setSent([...sent, t.key + i])}>{sent.includes(t.key + i) ? '✓ Enviado' : 'WhatsApp'}</a>}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      ))}
    </section>
  )
}
