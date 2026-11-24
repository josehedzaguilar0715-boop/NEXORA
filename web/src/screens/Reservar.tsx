import { useEffect, useState } from 'react'
import { applyPublicProduct } from '../products'
import { api, h12, mxn } from '../api'
import { confirmAsk } from '../Dialog'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const STATUS: Record<string, string> = { pendiente: 'Por confirmar: te avisaremos', confirmada: 'Confirmada', en_atencion: 'En atención', atendida: 'Atendida', cancelada: 'Cancelada', no_asistio: 'No asistió' }

/** Página pública: el cliente elige servicio, quién lo atiende o "el primero disponible", día y hora libre. */
export function Reservar({ code }: { code: string }) {
  const [info, setInfo] = useState<any>(null)
  const [f, setF] = useState({ serviceIds: [] as string[], staffId: 'any', date: today(), time: '', name: '', phone: '' })
  const [slots, setSlots] = useState<string[]>([])
  const [err, setErr] = useState('')
  useEffect(() => { api<any>('GET', `/public/book/${code}`).then((r) => { applyPublicProduct(r.business?.giro); setInfo(r) }).catch((e) => setErr(e.message)) }, [code])
  useEffect(() => {
    if (!f.serviceIds.length) return setSlots([])
    api<any>('GET', `/public/book/${code}/availability?date=${f.date}&serviceIds=${f.serviceIds.join(',')}&staffId=${f.staffId}`).then((r) => setSlots(r.slots)).catch(() => setSlots([]))
  }, [f.serviceIds, f.staffId, f.date])
  const book = async () => {
    try {
      const r = await api<any>('POST', `/public/book/${code}`, { serviceIds: f.serviceIds, staffId: f.staffId, date: f.date, time: f.time, name: f.name, phone: f.phone })
      location.href = `/cita/${r.token}`
    } catch (e) { setErr((e as Error).message) }
  }
  if (!info) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  return (
    <main className="login" style={{ maxWidth: 720 }}>
      {info.business.logoUrl && <img src={info.business.logoUrl} alt={`Logotipo de ${info.business.name}`} style={{ maxHeight: 72, maxWidth: 200, objectFit: 'contain' }} />}
      <h1>{info.business.name}</h1>
      {info.hours?.length > 0 && <p className="muted small">Horario: {info.hours.map((h: any) => `${['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][h.weekday]} ${h.start}–${h.end}`).join(' · ')}</p>}
      <p className="muted">Reserva tu cita</p>
      <div className="card">
        <h2>1. ¿Qué te vas a hacer?</h2>
        <div className="results">{info.services.map((s: any) => (
          <button key={s.id} className={f.serviceIds.includes(s.id) ? 'primary' : ''} onClick={() => setF({ ...f, time: '', serviceIds: f.serviceIds.includes(s.id) ? f.serviceIds.filter((x) => x !== s.id) : [...f.serviceIds, s.id] })}>{s.name}<small>{mxn(s.price)} · {s.duration} min</small></button>
        ))}</div>
        <h2 style={{ marginTop: 16 }}>2. ¿Con quién?</h2>
        <div className="row chips">{[{ id: 'any', name: 'El primero disponible' }, ...info.staff].map((s: any) => <button key={s.id} className={f.staffId === s.id ? 'primary' : ''} onClick={() => setF({ ...f, staffId: s.id, time: '' })}>{s.name}</button>)}</div>
        <h2 style={{ marginTop: 16 }}>3. Día y hora</h2>
        <label>Día<input type="date" min={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, time: '' })} /></label>
        {f.serviceIds.length === 0 ? <p className="muted">Elige un servicio para ver las horas libres.</p> : slots.length === 0 ? <p className="muted">No hay horas libres ese día.</p> : (
          <div className="row" style={{ marginTop: 8 }}>{slots.map((t) => <button key={t} style={{ flex: '0 0 110px' }} className={f.time === t ? 'primary' : ''} onClick={() => setF({ ...f, time: t })}>{h12(t)}</button>)}</div>
        )}
        <h2 style={{ marginTop: 16 }}>4. Tus datos</h2>
        <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Teléfono (10 dígitos)<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        {err && <p className="error">{err}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={!f.time || f.name.trim().length < 2 || f.phone.replace(/\D/g, '').length < 10} onClick={book}>Reservar</button></p>
        <p className="muted">Tu cita queda por confirmar hasta que el negocio la acepte. Verás el estado en el siguiente link.</p>
      </div>
    </main>
  )
}

export function EstadoCita({ token }: { token: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const load = () => api<any>('GET', `/public/appointments/${token}`).then((r) => { applyPublicProduct(r.business?.giro); setD(r) }).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [token])
  if (!d) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  const a = d.appointment
  return (
    <main className="login">
      <h1>{d.business.name}</h1>
      <div className="card">
        <h2>{STATUS[a.status]}</h2>
        <p>{new Date(a.startsAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short', hour12: true })}</p>
        <p>{a.services.map((s: any) => s.name).join(' + ')}{a.staffName ? ` · con ${a.staffName}` : ''}</p>
        {d.business.phone && <p className="muted">Dudas: {d.business.phone}</p>}
        <p className="muted">Guarda este link para ver el estado de tu cita.</p>
        {['pendiente', 'confirmada'].includes(a.status) && <button onClick={async () => { if (await confirmAsk('¿Cancelar tu cita?', 'El negocio verá que la cancelaste.', true)) void api('POST', `/public/appointments/${token}/cancel`).then(load) }}>Cancelar mi cita</button>}
      </div>
    </main>
  )
}
