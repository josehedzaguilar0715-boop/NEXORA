import { loyaltyText, type Loyalty } from './Caja'
import { useEffect, useMemo, useState } from 'react'
import { api, h12, mxn, toCents, publicSlug } from '../api'
import { ask } from '../Dialog'
import { can, type Me } from '../App'
import type { Service } from './Caja'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const hm = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true })
const STATUS: Record<string, string> = { pendiente: 'Por confirmar', confirmada: 'Confirmada', en_atencion: 'Atendiendo', atendida: 'Cobrada', cancelada: 'Cancelada', no_asistio: 'No vino' }

/** Minutos del día (hora de México) de una fecha ISO. */
const mins = (iso: string) => { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).split(':').map(Number); return h! * 60 + m! }
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m! }
const toHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const fmtDur = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`)
const shift = (date: string, d: number) => new Date(Date.parse(`${date}T12:00:00-06:00`) + d * 86_400_000).toISOString().slice(0, 10)
const dayLabel = (date: string) => { const s = new Date(`${date}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' }); return (date === today() ? 'Hoy, ' : '') + s.charAt(0).toUpperCase() + s.slice(1) }

/** Horas libres dentro del horario: lo que no está ocupado por citas ni bloqueos (hoy, solo desde ahora). Huecos de 15 min o más. */
function freeGaps(date: string, hours: { start: string; end: string }[], busy: [string, string][]) {
  const nowMin = date === today() ? Math.ceil(mins(new Date().toISOString()) / 15) * 15 : date < today() ? 24 * 60 : 0
  const taken = busy.map(([a, b]) => [mins(a), Math.max(mins(a), mins(b) || 24 * 60)] as [number, number]).sort((x, y) => x[0] - y[0])
  const out: { from: number; to: number }[] = []
  for (const h of hours) {
    let cur = Math.max(toMin(h.start), nowMin)
    const end = toMin(h.end)
    for (const [a, b] of taken) {
      if (b <= cur || a >= end) continue
      if (a - cur >= 15) out.push({ from: cur, to: a })
      cur = Math.max(cur, b)
    }
    if (end - cur >= 15) out.push({ from: cur, to: end })
  }
  return out
}

/** Una cita: hora y estado arriba, cliente y servicios, y los botones acomodados en cuadrícula (no se enciman en el celular). */
function Cita({ a, me, wa, act }: { a: any; me: Me; wa: string | null; act: (id: string, path: string, body?: unknown) => () => Promise<void> }) {
  const off = ['cancelada', 'no_asistio'].includes(a.status)
  return (
    <div className={`appt appt-${a.status}`} style={{ opacity: off ? 0.55 : 1 }}>
      <div className="appt-top"><b>{hm(a.startsAt)} – {hm(a.endsAt)}</b><span className="pill">{a.toCharge ? 'Pendiente de cobro' : STATUS[a.status]}</span></div>
      <div className="appt-name">{a.customerName}</div>
      <div className="muted small">{a.services.map((s: any) => s.name).join(' + ')}{a.source === 'link' ? ' · reservó por link' : ''}{a.atHome ? ' · a domicilio' : ''}</div>
      {!off && a.status !== 'atendida' && (
        <div className="appt-actions">
          {a.status === 'pendiente' && <button className="primary" onClick={act(a.id, 'confirm')}>Confirmar</button>}
          {a.toCharge && can(me, 'sell') && <button className="primary" onClick={() => { try { sessionStorage.setItem('nx_cita_cobrar', a.id) } catch { /* sin almacenamiento */ } location.hash = '#/caja' }}>Ver en Caja</button>}
          {['pendiente', 'confirmada'].includes(a.status) && <button onClick={act(a.id, 'start')}>Atender</button>}
          {['pendiente', 'confirmada', 'en_atencion'].includes(a.status) && !a.completedAt && <button onClick={act(a.id, 'complete')}>Terminar</button>}
          {['pendiente', 'confirmada'].includes(a.status) && <button onClick={act(a.id, 'no-show')}>No vino</button>}
          {['pendiente', 'confirmada', 'en_atencion'].includes(a.status) && <button onClick={async () => { const r = await ask({ title: 'Cancelar cita', label: 'Motivo', placeholder: 'Ej. el cliente no puede venir', confirmLabel: 'Cancelar cita', danger: true }); if (r) void act(a.id, 'cancel', { reason: r })() }}>Cancelar</button>}
          {wa && <a className="button" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      )}
    </div>
  )
}

/** Agenda por persona (barbería, uñas): citas, clientes sin cita y cobro. */
export function Agenda({ me }: { me: Me }) {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<{ appointments: any[]; blocks: any[]; hours?: { staffId: string; start: string; end: string }[] }>({ appointments: [], blocks: [] })
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [form, setForm] = useState<null | { walkIn: boolean; staffId?: string; time?: string }>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setData(await api('GET', `/agenda?date=${date}`))
    setStaff((await api<any>('GET', '/agenda/staff')).staff)
    setServices((await api<any>('GET', '/services')).services.filter((s: Service) => s.active && s.durationMin))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [date])
  const act = (id: string, path: string, body?: unknown) => async () => {
    try { await api('POST', `/appointments/${id}/${path}`, body); setMsg({}); await load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const [slug, setSlug] = useState('')
  useEffect(() => { if (me.modules?.includes('reservas')) void publicSlug().then(setSlug).catch(() => {}) }, [])
  const link = slug ? `${location.origin}/reservar/${slug}` : ''
  // Aviso manual: prepara el mensaje; nada se envía solo.
  const wa = (a: any) => a.phone ? `https://wa.me/52${a.phone}?text=${encodeURIComponent(`Hola ${a.customerName}, tu cita en ${me.business.name} es el ${new Date(a.startsAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short', hour12: true })}.`)}` : null

  return (
    <div>
      <div className="toolbar agenda-bar">
        <div className="day-nav">
          <button aria-label="Día anterior" onClick={() => setDate(shift(date, -1))}>‹</button>
          <label className="day-label">{dayLabel(date)}<input type="date" aria-label="Día" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <button aria-label="Día siguiente" onClick={() => setDate(shift(date, 1))}>›</button>
          {date !== today() && <button onClick={() => setDate(today())}>Hoy</button>}
        </div>
        <button className="primary" onClick={() => setForm({ walkIn: false })}>+ Nueva cita</button>
        <button onClick={() => setForm({ walkIn: true })}>Cliente sin cita</button>
      </div>
      {me.modules?.includes('reservas') && link && <p className="muted small link-line">Link para que tus clientes reserven: <a href={link} target="_blank" rel="noreferrer">{link}</a></p>}
      {msg.err && <p className="error">{msg.err}</p>}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
      <div className="agenda-cols">
        {staff.map((st) => {
          const hours = (data.hours ?? []).filter((h) => h.staffId === st.id)
          const appts = data.appointments.filter((a) => a.staffId === st.id)
          const blocks = data.blocks.filter((b) => b.staffId === st.id)
          const live = appts.filter((a) => !['cancelada', 'no_asistio'].includes(a.status))
          const gaps = freeGaps(date, hours, [...live.map((a) => [a.startsAt, a.endsAt] as [string, string]), ...blocks.map((b) => [b.startsAt, b.endsAt] as [string, string])])
          const freeMin = gaps.reduce((acc, g) => acc + (g.to - g.from), 0)
          type Row = { at: number; kind: 'cita'; a: any } | { at: number; kind: 'libre'; from: number; to: number } | { at: number; kind: 'bloqueo'; b: any }
          const rows: Row[] = [...appts.map((a) => ({ at: mins(a.startsAt), kind: 'cita' as const, a })), ...gaps.map((g) => ({ at: g.from, kind: 'libre' as const, from: g.from, to: g.to })), ...blocks.map((b) => ({ at: mins(b.startsAt), kind: 'bloqueo' as const, b }))].sort((x, y) => x.at - y.at)
          return (
            <section className="card agenda-staff" key={st.id}>
              <div className="agenda-head">
                <h2>{st.name}</h2>
                <span className="muted small">{hours.length ? `${hours.map((h) => `${h12(h.start)} – ${h12(h.end)}`).join(' y ')}` : 'Descansa este día'}</span>
                <span className="small">{live.length} {live.length === 1 ? 'cita' : 'citas'}{hours.length ? ` · ${fmtDur(freeMin)} libres` : ''}</span>
              </div>
              {rows.map((r, i) => r.kind === 'libre' ? (
                <button key={`l${i}`} className="slot-free" onClick={() => setForm({ walkIn: false, staffId: st.id, time: toHm(r.from) })}>
                  <span><b>Libre</b> {h12(toHm(r.from))} – {h12(toHm(r.to))}</span><span className="slot-add">+ Agendar</span>
                </button>
              ) : r.kind === 'bloqueo' ? (
                <div key={r.b.id} className="slot-block">⛔ {hm(r.b.startsAt)} – {hm(r.b.endsAt)} · {r.b.reason}</div>
              ) : (
                <Cita key={r.a.id} a={r.a} me={me} wa={wa(r.a)} act={act} />
              ))}
              {!rows.length && <p className="muted">{hours.length ? 'Sin citas.' : 'No trabaja este día.'}</p>}
            </section>
          )
        })}
      </div>
      <Recordatorios />
      {me.modules?.includes('recordatorios') && <Retoques />}
      {staff.length === 0 && <p className="card">Nadie está en la agenda todavía. En <a href="#/usuarios">Personal</a> abre a cada persona → «Horario de agenda» y marca «Atiende citas». Los servicios se dan de alta en <a href="#/configurar">Configurar negocio</a>.</p>}
      {form && <NuevaCita walkIn={form.walkIn} preset={form.staffId ? { staffId: form.staffId, time: form.time } : undefined} date={date} staff={staff} services={services} onClose={() => setForm(null)} onSaved={() => { setForm(null); setMsg({ ok: 'Cita guardada.' }); void load() }} />}
    </div>
  )
}

function NuevaCita({ walkIn, preset, date, staff, services, onClose, onSaved }: { walkIn: boolean; preset?: { staffId: string; time?: string }; date: string; staff: { id: string; name: string }[]; services: Service[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ staffId: preset?.staffId ?? staff[0]?.id ?? '', serviceIds: [] as string[], time: '', name: '', phone: '', atHome: false, address: '', travelMin: '30' })
  const [slots, setSlots] = useState<string[]>([])
  const [err, setErr] = useState('')
  const total = useMemo(() => services.filter((s) => f.serviceIds.includes(s.id)).reduce((a, s) => a + s.price, 0), [f.serviceIds, services])
  useEffect(() => {
    if (walkIn || !f.serviceIds.length || !f.staffId) { setSlots([]); return }
    // Con internet lento las respuestas pueden llegar en desorden: solo cuenta la de lo último que se eligió.
    let stale = false
    api<any>('GET', `/agenda/availability?date=${date}&serviceIds=${f.serviceIds.join(',')}&staffId=${f.staffId}&travelMin=${f.atHome ? Number(f.travelMin) || 0 : 0}`).then((r) => {
      if (stale) return
      setSlots(r.slots)
      // Una hora elegida que ya no cabe (p. ej. al agregar el traslado a domicilio) se quita.
      setF((x) => (x.time && !r.slots.includes(x.time) ? { ...x, time: '' } : x))
      // Si se abrió desde una hora libre, queda elegida esa hora (si cabe el servicio).
      if (preset?.time && r.slots.includes(preset.time)) setF((x) => (x.time ? x : { ...x, time: preset.time! }))
    }).catch(() => { if (!stale) setSlots([]) })
    return () => { stale = true }
  }, [f.serviceIds, f.staffId, date, walkIn, f.atHome, f.travelMin])
  const save = async () => {
    try {
      await api('POST', '/appointments', { staffId: f.staffId, serviceIds: f.serviceIds, customerName: f.name, phone: f.phone || undefined, ...(f.atHome ? { atHome: true, address: f.address, travelMin: Number(f.travelMin) || 0 } : {}), ...(walkIn ? { walkIn: true } : { startsAt: new Date(`${date}T${f.time}:00-06:00`).toISOString() }) })
      onSaved()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{walkIn ? 'Cliente sin cita' : 'Nueva cita'}</h2>
        <label>¿Quién atiende?<select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value, time: '' })}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <h3 style={{ marginTop: 12 }}>Servicios</h3>
        <div className="results">{services.map((s) => (
          <button key={s.id} className={f.serviceIds.includes(s.id) ? 'primary' : ''} onClick={() => setF({ ...f, time: '', serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter((x) => x !== s.id) : [...f.serviceIds, s.id] })}>{s.name}<small>{mxn(s.price)} · {s.durationMin} min</small></button>
        ))}</div>
        {!walkIn && f.serviceIds.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Hora</h3>
            {slots.length === 0 ? <p className="muted">No hay horas libres ese día.</p> : <div className="row">{slots.map((t) => <button key={t} className={f.time === t ? 'primary' : ''} style={{ flex: '0 0 110px' }} onClick={() => setF({ ...f, time: t })}>{h12(t)}</button>)}</div>}
          </>
        )}
        <div className="row"><label>Nombre del cliente<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label>Teléfono<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label></div>
        {!walkIn && (<>
          <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={f.atHome} onChange={(e) => setF({ ...f, atHome: e.target.checked, time: '' })} />A domicilio</label>
          {f.atHome && <div className="row"><label>Dirección (solo la ve el negocio)<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label><label style={{ flex: '0 0 180px' }}>Traslado (min)<input inputMode="numeric" value={f.travelMin} onChange={(e) => setF({ ...f, travelMin: e.target.value, time: '' })} /></label></div>}
        </>)}
        <p className="muted">Total: {mxn(total)}</p>
        {err && <p className="error">{err}</p>}
        <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!f.serviceIds.length || f.name.trim().length < 2 || (!walkIn && !f.time)} onClick={save}>Guardar</button></p>
      </div>
    </div>
  )
}

/** Recordatorios de retoque (si el módulo está activo): solo prepara el mensaje. */
function Retoques() {
  const [list, setList] = useState<any[] | null>(null)
  useEffect(() => { api<any>('GET', '/reminders/retouch').then((r) => setList(r.reminders)).catch(() => setList(null)) }, [])
  if (!list || list.length === 0) return null
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Les toca retoque</h2>
      <div className="table-wrap"><table className="list"><tbody>{list.map((r, i) => (
        <tr key={i}><td>{r.customerName}<br /><small className="muted">{r.service} · última vez {new Date(r.lastVisit).toLocaleDateString('es-MX')}</small></td><td>{r.whatsapp ? <a href={r.whatsapp} target="_blank" rel="noreferrer">Preparar WhatsApp</a> : <span className="muted">sin teléfono</span>}</td></tr>
      ))}</tbody></table></div>
    </section>
  )
}

/** Citas de mañana: el mensaje ya viene escrito; al abrir WhatsApp la cita queda marcada como «avisada». */
function Recordatorios() {
  const [list, setList] = useState<any[] | null>(null)
  const load = () => api<{ reminders: any[] }>('GET', '/agenda/reminders').then((r) => setList(r.reminders)).catch(() => setList(null))
  useEffect(() => { void load() }, [])
  if (!list || list.length === 0) return null
  const pendientes = list.filter((r) => !r.reminded).length
  return (
    <section className="card">
      <h2>Recordatorios para mañana <span className="muted small">· {pendientes === 0 ? 'todos avisados' : `${pendientes} por avisar`}</span></h2>
      <div className="table-wrap cards-sm"><table className="list"><tbody>
        {list.map((r) => (
          <tr key={r.id}>
            <td data-label="Cita"><b>{r.customerName}</b><br /><small className="muted">{hm(r.startsAt)} · {r.services.join(' + ')}</small></td>
            <td>{r.reminded ? <span className="estado ok">Avisado</span> : r.whatsapp
              ? <a className="button primary" href={r.whatsapp} target="_blank" rel="noreferrer" onClick={() => { void api('POST', `/appointments/${r.id}/reminded`).then(load) }}>Recordarle</a>
              : <small className="muted">sin teléfono</small>}</td>
          </tr>
        ))}
      </tbody></table></div>
    </section>
  )
}
