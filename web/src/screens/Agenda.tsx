import { loyaltyText, type Loyalty } from './Caja'
import { useEffect, useMemo, useState } from 'react'
import { api, h12, mxn, toCents, publicSlug } from '../api'
import { ask } from '../Dialog'
import { can, type Me } from '../App'
import type { Service } from './Caja'
import { Sheet } from '../Sheet'
import { Avatar, Calendario, ETIQUETA_ESTADO, Leyenda, TiraSemana, dateOf, estadoVisual, lunesDe, toHm, type Staff } from './AgendaCalendario'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const hm = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true })
const STATUS: Record<string, string> = { pendiente: 'Por confirmar', confirmada: 'Confirmada', en_atencion: 'Atendiendo', atendida: 'Cobrada', cancelada: 'Cancelada', no_asistio: 'No vino' }

/** Minutos del día (hora de México) de una fecha ISO. */
const mins = (iso: string) => { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).split(':').map(Number); return h! * 60 + m! }
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m! }
const fmtDur = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`)
const shift = (date: string, d: number) => new Date(Date.parse(`${date}T12:00:00-06:00`) + d * 86_400_000).toISOString().slice(0, 10)
const dayLabel = (date: string) => { const s = new Date(`${date}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' }); return (date === today() ? 'Hoy, ' : '') + s.charAt(0).toUpperCase() + s.slice(1) }

const diaCorto = (date: string) => `${date === today() ? 'Hoy · ' : ''}${new Date(`${date}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' }).replace(/\./g, '')}`

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
function Cita({ a, me, wa, act, onOpen }: { a: any; me: Me; wa: string | null; act: (id: string, path: string, body?: unknown) => () => Promise<void>; onOpen?: () => void }) {
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
          {onOpen && <button onClick={onOpen}>Ver / editar</button>}
          {wa && <a className="button" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      )}
    </div>
  )
}

/** Agenda por persona (barbería, uñas): calendario gráfico (vista principal) o lista; citas, clientes sin cita y cobro en Caja. */
export function Agenda({ me }: { me: Me }) {
  const [date, setDate] = useState(today())
  const [vista, setVista] = useState<'cal' | 'lista'>('cal')
  const [modo, setModo] = useState<'dia' | 'semana'>('dia')
  const [staffSel, setStaffSel] = useState('todos')
  const rango = vista === 'cal' && modo === 'semana' ? 7 : 1
  const inicio = rango === 7 ? lunesDe(date) : date
  const [data, setData] = useState<{ appointments: any[]; blocks: any[]; hours?: { staffId: string; start: string; end: string }[]; hoursByDay?: Record<string, { staffId: string; start: string; end: string }[]> }>({ appointments: [], blocks: [] })
  const [staff, setStaff] = useState<Staff[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [form, setForm] = useState<null | { walkIn: boolean; staffId?: string; time?: string; date?: string }>(null)
  const [detalle, setDetalle] = useState<string | null>(null)
  const [fotos, setFotos] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  // Una cita nunca se esconde: si su profesional ya no atiende en la agenda (o se desactivó), aparece en su propia columna.
  const staffVista = useMemo<Staff[]>(() => {
    const conocidos = new Set(staff.map((x) => x.id))
    const extra = new Map<string, Staff>()
    for (const a of data.appointments) {
      const id = a.staffId ?? 'sin-asignar'
      if (conocidos.has(id) || extra.has(id)) continue
      extra.set(id, { id, name: a.staffId ? `${a.staffName ?? 'Profesional'} (ya no atiende)` : 'Sin profesional' })
    }
    return [...staff, ...extra.values()]
  }, [staff, data.appointments])
  const load = async () => {
    setData(await api('GET', `/agenda?date=${inicio}&days=${rango}`))
    setStaff((await api<any>('GET', '/agenda/staff')).staff)
    setServices((await api<any>('GET', '/services')).services.filter((s: Service) => s.active && s.durationMin))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [inicio, rango])
  // En la semana se ve a una persona a la vez: si no hay una elegida, la propia (si atiende) o la primera.
  useEffect(() => { if (modo === 'semana' && staffSel === 'todos' && staffVista.length) setStaffSel(staffVista.find((x) => x.id === me.user.id)?.id ?? staffVista[0]!.id) }, [modo, staffVista.length])
  const act = (id: string, path: string, body?: unknown) => async () => {
    try { await api('POST', `/appointments/${id}/${path}`, body); setMsg({}); await load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const [slug, setSlug] = useState('')
  useEffect(() => { if (me.modules?.includes('reservas')) void publicSlug().then(setSlug).catch(() => {}) }, [])
  const link = slug ? `${location.origin}/reservar/${slug}` : ''
  // Aviso manual: prepara el mensaje; nada se envía solo.
  const wa = (a: any) => a.phone ? `https://wa.me/52${a.phone}?text=${encodeURIComponent(`Hola ${a.customerName}, tu cita en ${me.business.name} es el ${new Date(a.startsAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short', hour12: true })}. ¡Te esperamos!`)}` : null
  const dias = useMemo(() => Array.from({ length: rango }, (_, i) => shift(inicio, i)), [inicio, rango])
  const paso = vista === 'cal' && modo === 'semana' ? 7 : 1
  const titulo = vista === 'cal' && modo === 'semana'
    ? `${new Date(`${dias[0]}T12:00:00-06:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' })} – ${new Date(`${dias[6]}T12:00:00-06:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' })}`
    : diaCorto(date)
  const mover = async (a: any, to: { date: string; time: string; staffId: string }) => {
    try {
      await api('POST', `/appointments/${a.id}/reschedule`, { startsAt: new Date(`${to.date}T${to.time}:00-06:00`).toISOString(), ...(to.staffId !== a.staffId ? { staffId: to.staffId } : {}) })
      setMsg({ ok: `Cita de ${a.customerName} movida a las ${h12(to.time)}${to.date !== dateOf(a.startsAt) ? ` del ${dayLabel(to.date).toLowerCase()}` : ''}` }); await load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const abierta = detalle ? data.appointments.find((x) => x.id === detalle) : null
  const esDueno = me.user.role === 'owner'

  return (
    <div className="agenda-pantalla">
      <h1 className="sr-only">Agenda</h1>
      <div className="toolbar agenda-bar">
        <div className="day-nav">
          <button aria-label={paso === 7 ? 'Semana anterior' : 'Día anterior'} onClick={() => setDate(shift(date, -paso))}>‹</button>
          <label className="day-label">{titulo}<input type="date" aria-label="Día" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <button aria-label={paso === 7 ? 'Semana siguiente' : 'Día siguiente'} onClick={() => setDate(shift(date, paso))}>›</button>
          {date !== today() && <button onClick={() => setDate(today())}>Hoy</button>}
        </div>
        <div className="seg" role="group" aria-label="Vista de la agenda">
          {([['dia', 'Día'], ['semana', 'Semana'], ['lista', 'Lista']] as const).map(([k, t]) => {
            const on = k === 'lista' ? vista === 'lista' : vista === 'cal' && modo === k
            return <button key={k} className={on ? 'on' : ''} aria-pressed={on} onClick={() => { if (k === 'lista') setVista('lista'); else { setVista('cal'); setModo(k) } }}>{t}</button>
          })}
        </div>
        <button className="primary agenda-nueva" onClick={() => setForm({ walkIn: false, date })}><span aria-hidden>+</span><span className="agenda-nueva-txt"> Nueva cita</span></button>
        <button className="agenda-sincita" aria-label="Cliente sin cita" onClick={() => setForm({ walkIn: true, date: today() })}><span className="solo-compu">Cliente sin cita</span><span className="solo-movil" aria-hidden>Sin cita</span></button>
      </div>
      {vista === 'cal' && modo === 'dia' && <TiraSemana date={date} onDay={setDate} />}
      {(() => {
        const vivas = data.appointments.filter((x) => !['cancelada', 'no_asistio'].includes(x.status))
        const porConfirmar = vivas.filter((x) => x.status === 'pendiente').length
        const porCobrar = vivas.filter((x) => x.toCharge).length
        return <p className="agenda-resumen" aria-live="polite"><span className="agenda-resumen-n"><b>{vivas.length}</b> {vivas.length === 1 ? 'cita' : 'citas'}{rango === 7 ? ' esta semana' : ''}</span>{porConfirmar > 0 && <span className="estado warn">{porConfirmar} por confirmar</span>}{porCobrar > 0 && <span className="estado ok">{porCobrar} por cobrar</span>}</p>
      })()}
      {vista === 'cal' && staffVista.length > 0 && (
        <div className="cal-filtros">
          <div className="row chips" role="group" aria-label="Profesional">
            {modo === 'dia' && <button className={staffSel === 'todos' ? 'on' : ''} aria-pressed={staffSel === 'todos'} onClick={() => setStaffSel('todos')}>Todos</button>}
            {staffVista.map((x) => <button key={x.id} className={staffSel === x.id ? 'on' : ''} aria-pressed={staffSel === x.id} onClick={() => setStaffSel(x.id)}><Avatar staff={x} size={24} />{x.name}</button>)}
            {esDueno && <button className="foto-btn" onClick={() => setFotos(true)}>Fotos del equipo</button>}
          </div>
        </div>
      )}
      {me.modules?.includes('reservas') && link && <p className="muted small link-line">Link para que tus clientes reserven: <a href={link} target="_blank" rel="noreferrer">{link}</a></p>}
      {msg.err && <p className="error" role="alert">{msg.err}</p>}
      {msg.ok && <p className="okmsg" role="status">{msg.ok}</p>}
      {vista === 'cal' ? (
        <>
          <Calendario view={modo} date={date} days={dias} staff={staffVista} staffSel={staffSel} appointments={data.appointments} blocks={data.blocks} hoursByDay={data.hoursByDay ?? {}}
            onNew={(staffId, d, time) => setForm({ walkIn: false, staffId, time, date: d })} onOpen={(a) => setDetalle(a.id)} onMove={(a, to) => void mover(a, to)} onDay={(d) => { setDate(d); setModo('dia'); setStaffSel('todos') }} />
          <Leyenda />
        </>
      ) : (
      <div className="agenda-cols">
        {staffVista.map((st) => {
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
                <h2><Avatar staff={st} size={32} /> {st.name}</h2>
                <span className="muted small">{hours.length ? `${hours.map((h) => `${h12(h.start)} – ${h12(h.end)}`).join(' y ')}` : 'Descansa este día'}</span>
                <span className="small">{live.length} {live.length === 1 ? 'cita' : 'citas'}{hours.length ? ` · ${fmtDur(freeMin)} libres` : ''}</span>
              </div>
              {rows.map((r, i) => r.kind === 'libre' ? (
                <button key={`l${i}`} className="slot-free" onClick={() => setForm({ walkIn: false, staffId: st.id, time: toHm(r.from), date })}>
                  <span><b>Libre</b> {h12(toHm(r.from))} – {h12(toHm(r.to))}</span><span className="slot-add">+ Agendar</span>
                </button>
              ) : r.kind === 'bloqueo' ? (
                <div key={r.b.id} className="slot-block">⛔ {hm(r.b.startsAt)} – {hm(r.b.endsAt)} · {r.b.reason}</div>
              ) : (
                <Cita key={r.a.id} a={r.a} me={me} wa={wa(r.a)} act={act} onOpen={() => setDetalle(r.a.id)} />
              ))}
              {!rows.length && <p className="muted">{hours.length ? 'Sin citas.' : 'No trabaja este día.'}</p>}
            </section>
          )
        })}
      </div>
      )}
      <Recordatorios />
      {me.modules?.includes('recordatorios') && <Retoques />}
      {staffVista.length === 0 && <p className="card">Nadie está en la agenda todavía. En <a href="#/usuarios">Personal</a> abre a cada persona → «Horario de agenda» y marca «Atiende citas». Los servicios se dan de alta en <a href="#/configurar">Configurar negocio</a> → Servicios.</p>}
      {form && <NuevaCita walkIn={form.walkIn} preset={form.staffId ? { staffId: form.staffId, time: form.time } : undefined} date={form.date ?? date} staff={staff} services={services} onClose={() => setForm(null)} onSaved={() => { const d = form.date; setForm(null); setMsg({ ok: 'Cita guardada.' }); if (d && d !== date && rango === 1) setDate(d); void load() }} />}
      {abierta && <DetalleCita a={abierta} me={me} staff={staff} services={services} wa={wa(abierta)} onClose={() => setDetalle(null)} onChanged={async (m) => { setMsg({ ok: m }); await load() }} onError={(e) => setMsg({ err: e })} />}
      {fotos && <FotosEquipo staff={staff} onClose={() => setFotos(false)} onSaved={() => void load()} />}
    </div>
  )
}

/** Detalle de una cita (panel lateral): ver, confirmar, atender, terminar, reprogramar, editar, cancelar y mandar WhatsApp. El cobro siempre es en Caja. */
function DetalleCita({ a, me, staff, services, wa, onClose, onChanged, onError }: { a: any; me: Me; staff: Staff[]; services: Service[]; wa: string | null; onClose: () => void; onChanged: (m: string) => Promise<void>; onError: (e: string) => void }) {
  const [modo, setModo] = useState<'ver' | 'reprogramar' | 'editar'>('ver')
  const pro = staff.find((x) => x.id === a.staffId)
  const est = estadoVisual(a)
  const cerrada = ['cancelada', 'no_asistio', 'atendida'].includes(a.status)
  const total = a.services.reduce((t: number, x: any) => t + (x.price ?? 0), 0)
  const post = async (path: string, body: unknown, ok: string) => { try { await api('POST', `/appointments/${a.id}/${path}`, body); await onChanged(ok); if (path !== 'confirm' && path !== 'start') onClose() } catch (e) { onError((e as Error).message) } }
  // Reprogramar
  const [r, setR] = useState({ date: dateOf(a.startsAt), time: toHm(mins(a.startsAt)), staffId: a.staffId as string })
  const [slots, setSlots] = useState<string[]>([])
  useEffect(() => {
    if (modo !== 'reprogramar') return
    let stale = false
    api<any>('GET', `/agenda/availability?date=${r.date}&serviceIds=${a.services.map((x: any) => x.serviceId).join(',')}&staffId=${r.staffId}&travelMin=${a.travelMin ?? 0}`).then((x) => { if (!stale) setSlots(x.slots) }).catch(() => { if (!stale) setSlots([]) })
    return () => { stale = true }
  }, [modo, r.date, r.staffId])
  // Editar
  const [e, setE] = useState({ name: a.customerName as string, phone: (a.phone ?? '') as string, notes: (a.notes ?? '') as string, serviceIds: a.services.map((x: any) => x.serviceId) as string[] })
  const [err, setErr] = useState('')
  const guardarEdicion = async () => {
    try { await api('PATCH', `/appointments/${a.id}`, { customerName: e.name, phone: e.phone || null, notes: e.notes || null, serviceIds: e.serviceIds }); await onChanged('Cita actualizada.'); onClose() } catch (x) { setErr((x as Error).message) }
  }
  const guardarHora = async () => {
    try { await api('POST', `/appointments/${a.id}/reschedule`, { startsAt: new Date(`${r.date}T${r.time}:00-06:00`).toISOString(), ...(r.staffId !== a.staffId ? { staffId: r.staffId } : {}) }); await onChanged(`Cita reprogramada a las ${h12(r.time)}.`); onClose() } catch (x) { setErr((x as Error).message) }
  }
  const abierta = ['pendiente', 'confirmada', 'en_atencion'].includes(a.status)
  return (
    <Sheet onClose={onClose}>
      <div className="cita-det">
        <div className="cita-det-cab"><span className={`cb-sw cb-${est}`} aria-hidden /><div><h2>{a.customerName}</h2><span className="pill">{ETIQUETA_ESTADO[est]}</span></div><button className="icon-btn2" aria-label="Cerrar" onClick={onClose}>✕</button></div>
        {modo === 'ver' && (
          <>
            <div className="info-row"><span className="muted">Cuándo</span><b>{new Date(a.startsAt).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Mexico_City' })} · {hm(a.startsAt)} – {hm(a.endsAt)}</b></div>
            <div className="info-row"><span className="muted">Profesional</span><b className="cita-pro">{pro && <Avatar staff={pro} size={28} />}{a.staffName ?? pro?.name}</b></div>
            <div className="info-row"><span className="muted">Servicios</span><b>{a.services.map((x: any) => x.name).join(' + ')}</b></div>
            <div className="info-row"><span className="muted">Duración</span><b>{fmtDur(Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000))}</b></div>
            <div className="info-row"><span className="muted">Total</span><b>{mxn(total)}</b></div>
            {a.phone && <div className="info-row"><span className="muted">Teléfono</span><b>{a.phone}</b></div>}
            {a.atHome && <div className="info-row"><span className="muted">A domicilio</span><b>{a.address ?? 'Sí'}</b></div>}
            {a.notes && <div className="info-row"><span className="muted">Notas</span><b>{a.notes}</b></div>}
            {a.source === 'link' && <p className="muted small">Reservó por el link público.</p>}
            {a.toCharge && <p className="okmsg">Servicio terminado: se cobra desde Caja.</p>}
            {!cerrada && (
              <div className="appt-actions">
                {a.status === 'pendiente' && <button className="primary" onClick={() => void post('confirm', undefined, 'Cita confirmada.')}>Confirmar</button>}
                {a.toCharge && can(me, 'sell') && <button className="primary" onClick={() => { try { sessionStorage.setItem('nx_cita_cobrar', a.id) } catch { /* sin almacenamiento */ } location.hash = '#/caja' }}>Ver en Caja</button>}
                {['pendiente', 'confirmada'].includes(a.status) && <button onClick={() => void post('start', undefined, 'Atención iniciada.')}>Atender</button>}
                {abierta && !a.completedAt && <button className="primary" onClick={() => void post('complete', undefined, 'Servicio terminado: queda pendiente de cobro en Caja.')}>Terminar</button>}
                {['pendiente', 'confirmada'].includes(a.status) && <button onClick={() => setModo('reprogramar')}>Reprogramar</button>}
                {abierta && !a.completedAt && <button onClick={() => setModo('editar')}>Editar</button>}
                {['pendiente', 'confirmada'].includes(a.status) && <button onClick={() => void post('no-show', undefined, 'Marcada como «No vino».')}>No vino</button>}
                {abierta && <button className="danger" onClick={async () => { const m = await ask({ title: 'Cancelar cita', label: 'Motivo', placeholder: 'Ej. el cliente no puede venir', confirmLabel: 'Cancelar cita', danger: true }); if (m) await post('cancel', { reason: m }, 'Cita cancelada.') }}>Cancelar cita</button>}
                {wa && <a className="button" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
              </div>
            )}
          </>
        )}
        {modo === 'reprogramar' && (
          <>
            <h3>Reprogramar</h3>
            <label>Profesional<select value={r.staffId} onChange={(x) => setR({ ...r, staffId: x.target.value, time: '' })}>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Día<input type="date" min={today()} value={r.date} onChange={(x) => x.target.value && setR({ ...r, date: x.target.value, time: '' })} /></label>
            <h3 style={{ marginTop: 8 }}>Horas libres</h3>
            {slots.length === 0 ? <p className="muted">No hay horas libres ese día para estos servicios.</p> : <div className="row">{slots.map((t) => <button key={t} className={r.time === t ? 'primary' : ''} style={{ flex: '0 0 104px' }} onClick={() => setR({ ...r, time: t })}>{h12(t)}</button>)}</div>}
            <label>O escribe otra hora<input type="time" step={900} value={r.time} onChange={(x) => setR({ ...r, time: x.target.value })} /></label>
            <p className="muted small">El sistema revisa horario, descansos, bloqueos y otras citas: no permite cruces.</p>
            {err && <p className="error" role="alert">{err}</p>}
            <p className="row"><button onClick={() => { setModo('ver'); setErr('') }}>Volver</button><button className="primary" disabled={!r.time} onClick={() => void guardarHora()}>Guardar nueva hora</button></p>
          </>
        )}
        {modo === 'editar' && (
          <>
            <h3>Editar cita</h3>
            <div className="row"><label>Cliente<input value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></label><label>Teléfono<input inputMode="tel" value={e.phone} onChange={(x) => setE({ ...e, phone: x.target.value })} /></label></div>
            <h3 style={{ marginTop: 8 }}>Servicios</h3>
            <div className="results">{services.map((sv) => <button key={sv.id} className={e.serviceIds.includes(sv.id) ? 'primary' : ''} onClick={() => setE({ ...e, serviceIds: e.serviceIds.includes(sv.id) ? e.serviceIds.filter((y) => y !== sv.id) : [...e.serviceIds, sv.id] })}>{sv.name}<small>{mxn(sv.price)} · {sv.durationMin} min</small></button>)}</div>
            <label>Notas<textarea rows={2} maxLength={1000} value={e.notes} onChange={(x) => setE({ ...e, notes: x.target.value })} /></label>
            <p className="muted small">Si cambias los servicios, la duración se recalcula y no puede cruzarse con la siguiente cita.</p>
            {err && <p className="error" role="alert">{err}</p>}
            <p className="row"><button onClick={() => { setModo('ver'); setErr('') }}>Volver</button><button className="primary" disabled={e.name.trim().length < 2 || !e.serviceIds.length} onClick={() => void guardarEdicion()}>Guardar cambios</button></p>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** Fotos del equipo (solo el dueño): dirección https de cada foto; sin foto se muestra su inicial. */
function FotosEquipo({ staff, onClose, onSaved }: { staff: Staff[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(staff.map((x) => [x.id, x.photoUrl ?? ''])))
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const guardar = async (id: string) => { try { await api('PUT', `/staff/${id}/photo`, { url: v[id]?.trim() || null }); setMsg({ ok: 'Foto guardada.' }); onSaved() } catch (e) { setMsg({ err: (e as Error).message }) } }
  return (
    <Sheet onClose={onClose}>
      <div className="cita-det">
        <div className="cita-det-cab"><div><h2>Fotos del equipo</h2><p className="muted small">Pega la dirección https de la foto de cada profesional. Si la dejas vacía se muestra su inicial.</p></div><button className="icon-btn2" aria-label="Cerrar" onClick={onClose}>✕</button></div>
        {staff.map((x) => (
          <div key={x.id} className="foto-fila">
            <Avatar staff={{ name: x.name, photoUrl: v[x.id]?.startsWith('https://') ? v[x.id] : x.photoUrl }} size={44} />
            <label>{x.name}<input value={v[x.id] ?? ''} placeholder="https://…" onChange={(e) => setV({ ...v, [x.id]: e.target.value })} /></label>
            <button onClick={() => void guardar(x.id)}>Guardar</button>
          </div>
        ))}
        {msg.err && <p className="error" role="alert">{msg.err}</p>}{msg.ok && <p className="okmsg" role="status">{msg.ok}</p>}
      </div>
    </Sheet>
  )
}

function NuevaCita({ walkIn, preset, date, staff, services, onClose, onSaved }: { walkIn: boolean; preset?: { staffId: string; time?: string }; date: string; staff: Staff[]; services: Service[]; onClose: () => void; onSaved: () => void }) {
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
