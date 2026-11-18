import { loyaltyText, type Loyalty } from './Caja'
import { useEffect, useMemo, useState } from 'react'
import { api, mxn, toCents } from '../api'
import { can, type Me } from '../App'
import type { Service } from './Caja'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const hm = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' })
const STATUS: Record<string, string> = { pendiente: 'Por confirmar', confirmada: 'Confirmada', en_atencion: 'Atendiendo', atendida: 'Cobrada', cancelada: 'Cancelada', no_asistio: 'No vino' }

/** Agenda por persona (barbería, uñas): citas, clientes sin cita y cobro. */
export function Agenda({ me }: { me: Me }) {
  const [date, setDate] = useState(today())
  const [data, setData] = useState<{ appointments: any[]; blocks: any[] }>({ appointments: [], blocks: [] })
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [form, setForm] = useState<null | { walkIn: boolean }>(null)
  const [checkout, setCheckout] = useState<any>(null)
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
  const link = `${location.origin}/reservar/${me.business.code}`
  // Aviso manual: prepara el mensaje; nada se envía solo.
  const wa = (a: any) => a.phone ? `https://wa.me/52${a.phone}?text=${encodeURIComponent(`Hola ${a.customerName}, tu cita en ${me.business.name} es el ${new Date(a.startsAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })}.`)}` : null

  return (
    <div>
      <div className="toolbar agenda-bar">
        <label className="date-pick">Día<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <button className="primary" onClick={() => setForm({ walkIn: false })}>+ Nueva cita</button>
        <button onClick={() => setForm({ walkIn: true })}>Cliente sin cita</button>
      </div>
      {me.modules?.includes('reservas') && <p className="muted small link-line">Link para que tus clientes reserven: <a href={link} target="_blank" rel="noreferrer">{link}</a></p>}
      {msg.err && <p className="error">{msg.err}</p>}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
      <div className="agenda-cols">
        {staff.map((st) => (
          <section className="card" key={st.id}>
            <h2>{st.name}</h2>
            {data.blocks.filter((b) => b.staffId === st.id).map((b) => <p key={b.id} className="muted">⛔ {hm(b.startsAt)}–{hm(b.endsAt)} {b.reason}</p>)}
            {data.appointments.filter((a) => a.staffId === st.id).map((a) => (
              <div key={a.id} className="card" style={{ marginBottom: 8, opacity: ['cancelada', 'no_asistio'].includes(a.status) ? 0.5 : 1 }}>
                <b>{hm(a.startsAt)}–{hm(a.endsAt)}</b> · {a.customerName}
                <div className="muted">{a.services.map((s: any) => s.name).join(' + ')} · {STATUS[a.status]}{a.source === 'link' ? ' · por link' : ''}{a.atHome ? ' · a domicilio' : ''}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  {a.status === 'pendiente' && <button className="primary" onClick={act(a.id, 'confirm')}>Confirmar</button>}
                  {['pendiente', 'confirmada'].includes(a.status) && <button onClick={act(a.id, 'start')}>Atender</button>}
                  {['confirmada', 'en_atencion'].includes(a.status) && can(me, 'sell') && <button className="primary" onClick={() => setCheckout(a)}>Cobrar</button>}
                  {['pendiente', 'confirmada'].includes(a.status) && <button onClick={act(a.id, 'no-show')}>No vino</button>}
                  {['pendiente', 'confirmada', 'en_atencion'].includes(a.status) && <button onClick={() => { const r = prompt('Motivo de la cancelación:'); if (r) void act(a.id, 'cancel', { reason: r })() }}>Cancelar</button>}
                  {wa(a) && a.status !== 'atendida' && <a className="muted" href={wa(a)!} target="_blank" rel="noreferrer">Preparar WhatsApp</a>}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      {me.modules?.includes('recordatorios') && <Retoques />}
      {staff.length === 0 && <p className="card">Nadie está en la agenda todavía. En <a href="#/usuarios">Personal</a> abre a cada persona → «Horario de agenda» y marca «Atiende citas». Los servicios se dan de alta en <a href="#/configurar">Configurar negocio</a>.</p>}
      {form && <NuevaCita walkIn={form.walkIn} date={date} staff={staff} services={services} onClose={() => setForm(null)} onSaved={() => { setForm(null); setMsg({ ok: 'Cita guardada.' }); void load() }} />}
      {checkout && <Cobro appt={checkout} onClose={() => setCheckout(null)} onDone={(t, l) => { setCheckout(null); setMsg({ ok: `Cobrado: ${mxn(t)}.${l ? ` ${loyaltyText(l)}.` : ''}` }); void load() }} />}
    </div>
  )
}

function NuevaCita({ walkIn, date, staff, services, onClose, onSaved }: { walkIn: boolean; date: string; staff: { id: string; name: string }[]; services: Service[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ staffId: staff[0]?.id ?? '', serviceIds: [] as string[], time: '', name: '', phone: '', atHome: false, address: '', travelMin: '30' })
  const [slots, setSlots] = useState<string[]>([])
  const [err, setErr] = useState('')
  const total = useMemo(() => services.filter((s) => f.serviceIds.includes(s.id)).reduce((a, s) => a + s.price, 0), [f.serviceIds, services])
  useEffect(() => {
    if (walkIn || !f.serviceIds.length || !f.staffId) return setSlots([])
    api<any>('GET', `/agenda/availability?date=${date}&serviceIds=${f.serviceIds.join(',')}&staffId=${f.staffId}&travelMin=${f.atHome ? Number(f.travelMin) || 0 : 0}`).then((r) => setSlots(r.slots)).catch(() => setSlots([]))
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
            {slots.length === 0 ? <p className="muted">No hay horas libres ese día.</p> : <div className="row">{slots.map((t) => <button key={t} className={f.time === t ? 'primary' : ''} style={{ flex: '0 0 90px' }} onClick={() => setF({ ...f, time: t })}>{t}</button>)}</div>}
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

function Cobro({ appt, onClose, onDone }: { appt: any; onClose: () => void; onDone: (total: number, loyalty?: Loyalty | null) => void }) {
  const [method, setMethod] = useState('efectivo')
  const [tip, setTip] = useState('')
  const [err, setErr] = useState('')
  const total = appt.services.reduce((a: number, s: any) => a + s.price, 0)
  const pay = async () => {
    try {
      const r = await api<any>('POST', `/appointments/${appt.id}/checkout`, { id: crypto.randomUUID(), paymentMethod: method, ...(toCents(tip) > 0 ? { tips: [{ staffId: appt.staffId, amount: toCents(tip) }] } : {}) })
      onDone(r.sale.total, r.loyalty)
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
