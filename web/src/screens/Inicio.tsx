import { useEffect, useState } from 'react'
import { api, hora, mxn } from '../api'
import { FIADO_GIROS, hasGiro, screensFor, toneStyle, type Me } from '../App'
import { vocab } from '../giros'
import { productOf } from '../products'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const day = (d: string) => new Date(`${d}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })
const KIND: Record<string, string> = { venta: 'Venta', retiro: 'Retiro de caja', deposito: 'Depósito', compra: 'Compra', gasto: 'Gasto' }

/** Inicio (dashboard): indicadores del día, gráfica de la semana y movimientos recientes. Se actualiza solo. */
export function Inicio({ me }: { me: Me }) {
  const [db, setDb] = useState<any>(null)
  const [days, setDays] = useState<any[]>([])
  const [moves, setMoves] = useState<any[]>([])
  const [rec, setRec] = useState<number | null>(null)
  const owner = me.user.role === 'owner'
  const load = async () => {
    const [a, c, d] = await Promise.all([
      api<any>('GET', '/dashboard/panel'),
      api<any>('GET', '/reports/daily?days=7'),
      api<any>('GET', '/reports/recent?limit=8'),
    ])
    setDb(a); setDays(c.days); setMoves(d.movements)
    if (hasGiro(me, ...FIADO_GIROS)) api<any>('GET', '/receivables').then((r) => setRec(r.total)).catch(() => setRec(null))
  }
  useEffect(() => { void load().catch(() => {}); const t = setInterval(() => void load().catch(() => {}), 30_000); return () => clearInterval(t) }, [])
  const max = Math.max(1, ...days.map((d) => d.total))
  const W = 640, H = 220, pad = 28, bw = (W - pad * 2) / Math.max(1, days.length)
  const T = db?.today, M = db?.month, R = db?.real
  const [goalOpen, setGoalOpen] = useState(false)
  const setGoal = () => setGoalOpen(true)
  return (
    <div>
      <div className="dash-head">
        <div>
          <h1>Hola, {me.user.name.split(' ')[0]}</h1>
          <p className="muted" style={{ marginTop: -6 }}>{me.business.name}</p>
        </div>
        <div className="dash-status">
          <Clock />
          {db?.lowStockCount > 0 && <a className="stock-badge" href="#/productos">⚠ {db.lowStockCount} bajo stock</a>}
        </div>
      </div>
      {/* Indicadores del día y del mes, comparados contra ayer y contra el mes anterior. */}
      <div className="dash-kpis">
        <div className="card dkpi">
          <div className="dkpi-top"><span className="dkpi-label">Ventas de hoy</span>{T?.goal ? <GoalRing value={T.sales} goal={T.goal} /> : owner && <button className="link goal-link" onClick={setGoal}>+ Meta</button>}</div>
          <div className="dkpi-value pos">{T ? mxn(T.sales) : '—'}</div>
          <div className="dkpi-sub">{T ? `${T.tickets} ${T.tickets === 1 ? 'venta' : 'ventas'}` : ''}</div>
          {T && <Trend pct={T.vsYesterday} label="vs ayer" />}
          {T?.goal ? <div className="dkpi-sub">Meta {mxn(T.goal)} · {Math.min(999, Math.round((T.sales / T.goal) * 100))}%{owner && <> · <button className="link" onClick={setGoal}>cambiar</button></>}</div> : null}
        </div>
        <div className="card dkpi">
          <div className="dkpi-top"><span className="dkpi-label">Ingresos del mes</span></div>
          <div className="dkpi-value">{M ? mxn(M.sales) : '—'}</div>
          {M && <Trend pct={M.vsPrev.sales} label="vs mes anterior" />}
          <Spark data={db?.series.map((x: any) => x.sales) ?? []} color="var(--chart-in)" />
        </div>
        <div className="card dkpi">
          <div className="dkpi-top"><span className="dkpi-label">Egresos del mes</span></div>
          <div className="dkpi-value neg">{M ? mxn(M.out) : '—'}</div>
          {M && <Trend pct={M.vsPrev.out} label="vs mes anterior" inverse />}
          <Spark data={db?.series.map((x: any) => x.out) ?? []} color="var(--chart-out)" />
        </div>
        <div className="card dkpi">
          <div className="dkpi-top"><span className="dkpi-label">Utilidad del mes</span></div>
          <div className={`dkpi-value ${M && M.profit < 0 ? 'neg' : 'pos'}`}>{M ? mxn(M.profit) : '—'}</div>
          {M && <Trend pct={M.vsPrev.profit} label="vs mes anterior" />}
          <Spark data={db?.series.map((x: any) => x.profit) ?? []} color="var(--chart-profit)" />
        </div>
        {T?.bulk != null && (
          <div className="card dkpi">
            <div className="dkpi-top"><span className="dkpi-label">{vocab(me).bulk} hoy</span></div>
            <div className="dkpi-value" style={{ color: 'var(--accent)' }}>{mxn(T.bulk)}</div>
            <div className="dkpi-sub">por kilo, litro o metro</div>
          </div>
        )}
        {rec != null && rec > 0 && (
          <div className="card dkpi">
            <div className="dkpi-top"><span className="dkpi-label">Por cobrar (fiado)</span></div>
            <div className="dkpi-value">{mxn(rec)}</div>
            <div className="dkpi-sub"><a href="#/clientes">ver clientes</a></div>
          </div>
        )}
      </div>
      {/* Barbería y uñas: lo más importante del día es la agenda. */}
      {productOf(me.business.giro).home === 'agenda' && <AgendaHoy me={me} />}
      {/* Ganancia real: lo que de verdad entró, por forma de pago, menos costos y egresos. */}
      {R && (
        <GananciaReal R={R} title="Ganancia real del mes" />
      )}
      <Pendientes />
      <QuickActions me={me} />
      <div className="grid2 dash-grid">
        <section className="card">
          <h2>Lo que más ganancia dejó hoy</h2>
          <div className="table-wrap"><table className="list"><tbody>
            {db?.topProfit.map((p: any) => <tr key={p.name}><td>{p.name}<br /><small className="muted">{Math.round(p.qty * 1000) / 1000} vendidos · {mxn(p.sales)}</small></td><td className="num pos">{mxn(p.profit)}</td></tr>)}
            {db && db.topProfit.length === 0 && <tr><td className="muted">Todavía no hay ventas hoy.</td></tr>}
          </tbody></table></div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Stock bajo</h2>{db?.lowStockCount > 0 && <a className="mini-link" href="#/productos">Armar pedido</a>}</div>
          <div className="table-wrap"><table className="list"><tbody>
            {db?.lowStock.map((p: any) => <tr key={p.name}><td>{p.name}</td><td className="num"><span className="stock-badge">{p.stock} {p.unit === 'pieza' ? 'pzas' : p.unit}</span></td></tr>)}
            {db && db.lowStock.length === 0 && <tr><td className="pos">Todo surtido ✓</td></tr>}
          </tbody></table></div>
        </section>
      </div>
      <div className="grid2 dash-grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <section className="card">
          <h2>Ventas de la semana</h2>
          <svg className="chart" viewBox={`0 0 ${W} ${H + 30}`} role="img" aria-label="Ventas de los últimos 7 días">
            <defs>
              <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--chart-bar-1)' }} /><stop offset="1" style={{ stopColor: 'var(--chart-bar-2)' }} /></linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={pad} x2={W - pad} y1={H - (H - 20) * f} y2={H - (H - 20) * f} style={{ stroke: 'var(--chart-grid)' }} strokeDasharray="4 6" />)}
            {days.map((d, i) => {
              const h = ((H - 20) * d.total) / max
              return (
                <g key={d.date}>
                  <rect x={pad + i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={Math.max(h, 2)} rx={8} fill="url(#bar)" opacity={d.date === today() ? 1 : 0.65}>
                    <title>{`${day(d.date)}: ${mxn(d.total)} (${d.tickets} tickets)`}</title>
                  </rect>
                  <text x={pad + i * bw + bw / 2} y={H + 22} textAnchor="middle" style={{ fill: 'var(--muted)' }} fontSize="14">{day(d.date)}</text>
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
      {goalOpen && <MetaDiaria current={T?.goal ?? null} avg={M?.tickets ? Math.round(M.sales / Math.max(1, Number(T.date.slice(8, 10)))) : 0} onClose={() => setGoalOpen(false)} onSaved={() => { setGoalOpen(false); void load() }} />}
    </div>
  )
}

/** Meta de ventas del día: la pone el dueño; sugiere un poco arriba del promedio diario del mes. */
function MetaDiaria({ current, avg, onClose, onSaved }: { current: number | null; avg: number; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(current ? String(current / 100) : avg ? String(Math.ceil((avg * 1.1) / 10000) * 100) : '')
  const [err, setErr] = useState('')
  const save = async (amount: number) => {
    try { await api('PUT', '/dashboard/goal', { amount }); onSaved() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>Meta de ventas del día</h2><button className="mini" onClick={onClose}>Cerrar</button></div>
        <p className="muted">Se muestra en el anillo de «Ventas de hoy» para que tú y tu equipo vean cuánto falta.</p>
        <label>Meta en pesos<input inputMode="decimal" value={v} autoFocus onChange={(e) => setV(e.target.value)} placeholder="Ej. 5000" /></label>
        {avg > 0 && <p className="muted">Este mes vendes en promedio {mxn(avg)} al día.</p>}
        {err && <p className="error">{err}</p>}
        <div className="row-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={() => void save(Math.round(Number(v.replace(/[$,\s]/g, '')) * 100) || 0)}>Guardar meta</button>
          {current ? <button onClick={() => void save(0)}>Quitar meta</button> : null}
        </div>
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
  const keys = [...new Set([...productOf(me.business.giro).quick, ...giros.flatMap((g) => QUICK[g] ?? []), 'caja', 'productos', 'clientes', 'reportes'])]
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

/** Reloj con fecha (hora de México, 12 horas). */
function Clock() {
  const [n, setN] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setN(new Date()), 15_000); return () => clearInterval(t) }, [])
  return <span className="clock">{n.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })} · {n.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })}</span>
}

/** ▲ 12.5% vs ayer (verde si sube; en egresos al revés). */
function Trend({ pct, label, inverse = false }: { pct: number | null; label: string; inverse?: boolean }) {
  if (pct == null) return <div className="trend"><span className="muted">Sin datos para comparar {label.replace(/^vs /, 'con ')}</span></div>
  if (pct === 0) return <div className="trend"><span className="muted">Igual {label.replace(/^vs /, 'que ')}</span></div>
  const good = inverse ? pct < 0 : pct > 0
  return <div className={`trend ${good ? 'pos' : 'neg'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% <span className="muted">{label}</span></div>
}

/** Minigráfica de línea del mes. */
function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <svg className="spark" viewBox="0 0 120 32" aria-hidden />
  const lo = Math.min(0, ...data), hi = Math.max(1, ...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 120},${30 - ((v - lo) / (hi - lo || 1)) * 28}`).join(' ')
  return <svg className="spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" style={{ stroke: color }} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
}

/** Anillo de avance contra la meta del día. */
function GoalRing({ value, goal }: { value: number; goal: number }) {
  const p = goal > 0 ? Math.min(1, value / goal) : 0
  const r = 18, c = 2 * Math.PI * r
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-label={`${Math.round(p * 100)}% de la meta`}>
      <circle cx="24" cy="24" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
      <circle cx="24" cy="24" r={r} fill="none" stroke={p >= 1 ? 'var(--ok)' : 'var(--accent)'} strokeWidth="5" strokeDasharray={`${c * p} ${c}`} strokeLinecap="round" transform="rotate(-90 24 24)" />
      <text x="24" y="28" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--ink)">{Math.round(p * 100)}%</text>
    </svg>
  )
}

/** Ganancia real por forma de cobro: lo que entró, lo que salió y lo que queda. */
export function GananciaReal({ R, title }: { R: any; title: string }) {
  return (
    <section className="card real">
      <div className="card-head"><h2>{title}</h2><span className="pill">por forma de cobro</span></div>
      <div className="real-grid">
        {[['Efectivo', R.efectivo, 'pos'], ['Transferencia', R.transferencia, ''], ['Tarjeta', R.tarjeta, ''], ...(R.abonos ? [['Abonos de fiado', R.abonos, 'warn']] : []), ...(R.apartados ? [['Apartados', R.apartados, 'warn']] : [])].map(([l, v, c]) => (
          <div key={l as string} className="real-cell"><span>{l}</span><b className={c as string}>{mxn(v as number)}</b><small>{R.ingresado ? `${Math.round(((v as number) / R.ingresado) * 1000) / 10}% del ingreso` : '—'}</small></div>
        ))}
        <div className="real-cell"><span>Total ingresado</span><b>{mxn(R.ingresado)}</b><small>dinero que entró</small></div>
        <div className="real-cell"><span>Costo + egresos</span><b className="neg">{mxn(R.costo + R.egresos)}</b><small>mercancía, gastos, comisiones</small></div>
        <div className="real-cell hi"><span>Utilidad real</span><b className={R.utilidad < 0 ? 'neg' : 'pos'}>{mxn(R.utilidad)}</b><small>lo que te queda</small></div>
      </div>
      <div className="bar-track" style={{ marginTop: 12 }}><div className="bar-fill profit" style={{ width: `${R.ingresado > 0 ? Math.max(0, Math.min(100, (R.utilidad / R.ingresado) * 100)) : 0}%` }} /></div>
      {R.fiado > 0 && <p className="muted small" style={{ marginTop: 8 }}>Además se vendieron {mxn(R.fiado)} a crédito (fiado) que todavía no entran como dinero.</p>}
    </section>
  )
}

const ESTADO: Record<string, string> = { pendiente: 'Por confirmar', confirmada: 'Confirmada', en_atencion: 'En atención', atendida: 'Atendida', cancelada: 'Cancelada', no_asistio: 'No vino' }

/** Agenda de hoy en el Inicio (barbería y uñas): lo que sigue, lo que falta confirmar y quién atiende. */
function AgendaHoy({ me }: { me: Me }) {
  const [d, setD] = useState<any>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const load = () => api<any>('GET', '/agenda').then(setD).catch(() => setD(null))
    void load(); const t = setInterval(() => { void load(); setNow(Date.now()) }, 60_000); return () => clearInterval(t)
  }, [])
  if (!d) return null
  const list = (d.appointments as any[]).filter((a) => !['cancelada'].includes(a.status))
  const next = list.filter((a) => ['pendiente', 'confirmada', 'en_atencion'].includes(a.status) && Date.parse(a.endsAt) > now).slice(0, 5)
  const pending = list.filter((a) => a.status === 'pendiente').length
  const done = list.filter((a) => a.status === 'atendida').length
  const who = vocab(me).staff
  return (
    <section className="card agenda-today">
      <div className="card-head"><h2>Agenda de hoy</h2><a className="mini-link" href="#/agenda">Abrir agenda</a></div>
      <div className="at-stats">
        <div><b>{list.length}</b><span>citas</span></div>
        <div><b>{done}</b><span>atendidas</span></div>
        <div className={pending ? 'warn' : ''}><b>{pending}</b><span>por confirmar</span></div>
      </div>
      {next.length === 0 ? <p className="muted">{list.length ? 'Ya no quedan citas por atender hoy.' : 'Hoy no hay citas. Comparte tu link de reservas para llenar la agenda.'}</p> : (
        <ul className="at-list">
          {next.map((a) => (
            <li key={a.id} className={a.status}>
              <span className="at-time">{hora(a.startsAt)}</span>
              <span className="at-who"><b>{a.customerName}</b><small>{a.services.map((s: any) => s.name).join(' + ')}{a.staffName ? ` · ${a.staffName}` : ''}</small></span>
              <span className={`at-state ${a.status}`}>{ESTADO[a.status] ?? a.status}</span>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && <p className="muted small">Por {who}: {[...new Set(list.map((a) => a.staffName).filter(Boolean))].map((n) => `${n} ${list.filter((a) => a.staffName === n).length}`).join(' · ')}</p>}
    </section>
  )
}
