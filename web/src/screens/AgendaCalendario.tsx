import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react'
import { h12 } from '../api'

/** Calendario gráfico de la Agenda: horas en vertical, una columna por profesional (o por día en la semana) y citas como bloques según su duración. */

export type Staff = { id: string; name: string; photoUrl?: string | null }
type Ventana = [number, number]
export interface CalAppt { id: string; staffId: string; customerName: string; services: { name: string }[]; startsAt: string; endsAt: string; status: string; toCharge?: boolean; atHome?: boolean; source?: string }
export interface CalBlock { id: string; staffId: string; startsAt: string; endsAt: string; reason: string }

const TZ = 'America/Mexico_City'
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
export const dateOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
export const minOf = (iso: string) => { const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).split(':').map(Number); return h! * 60 + m! }
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h! * 60 + m! }
export const toHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const horaCorta = (n: number) => { const h = Math.floor(n / 60); const m = n % 60; const h12v = h % 12 === 0 ? 12 : h % 12; return `${h12v}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}` }
export const horaLarga = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })

/** Color visual de cada estado (ver estilos .cb-*). La cita ya terminada y sin cobrar se distingue como «Por cobrar». */
export const estadoVisual = (a: Pick<CalAppt, 'status' | 'toCharge'>) => (a.toCharge ? 'cobrar' : a.status)
export const ETIQUETA_ESTADO: Record<string, string> = { confirmada: 'Confirmada', pendiente: 'Por confirmar', en_atencion: 'Atendiendo', cobrar: 'Por cobrar', atendida: 'Cobrada', cancelada: 'Cancelada', no_asistio: 'No vino' }

const PALETA = ['#2563eb', '#0d9488', '#7c3aed', '#c2410c', '#be185d', '#4d7c0f', '#0369a1', '#a16207']
const colorDe = (s: string) => PALETA[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETA.length]!

/** Foto del profesional (dirección https) o, si no hay o no carga, su inicial en un círculo de color. */
export function Avatar({ staff, size = 40 }: { staff: Pick<Staff, 'name' | 'photoUrl'>; size?: number }) {
  const [fallo, setFallo] = useState(false)
  useEffect(() => setFallo(false), [staff.photoUrl])
  if (staff.photoUrl && !fallo) return <img className="cal-avatar" src={staff.photoUrl} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFallo(true)} style={{ width: size, height: size }} />
  return <span className="cal-avatar cal-avatar-ini" aria-hidden style={{ width: size, height: size, background: colorDe(staff.name), fontSize: Math.round(size * 0.45) }}>{staff.name.trim().charAt(0).toUpperCase()}</span>
}

export function useAngosto(px = 700) {
  const [a, setA] = useState(() => typeof window !== 'undefined' && window.innerWidth < px)
  useEffect(() => { const on = () => setA(window.innerWidth < px); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [px])
  return a
}

/** Citas que se encimen (p. ej. una cancelada y otra nueva a la misma hora) se reparten en carriles para verse las dos. */
function carriles(list: CalAppt[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>()
  const orden = [...list].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  let grupo: CalAppt[] = []; let finGrupo = -1
  const cerrar = () => { const of = Math.max(1, ...grupo.map((g) => out.get(g.id)!.lane + 1)); grupo.forEach((g) => (out.get(g.id)!.of = of)); grupo = [] }
  for (const a of orden) {
    const s = Date.parse(a.startsAt), e = Date.parse(a.endsAt)
    if (grupo.length && s >= finGrupo) { cerrar(); finGrupo = -1 }
    const ocupados = new Set(grupo.filter((g) => Date.parse(g.endsAt) > s).map((g) => out.get(g.id)!.lane))
    let lane = 0; while (ocupados.has(lane)) lane++
    out.set(a.id, { lane, of: 1 }); grupo.push(a); finGrupo = Math.max(finGrupo, e)
  }
  if (grupo.length) cerrar()
  return out
}

export interface CalProps {
  view: 'dia' | 'semana'
  date: string
  days: string[]
  staff: Staff[]
  staffSel: string
  appointments: CalAppt[]
  blocks: CalBlock[]
  hoursByDay: Record<string, { staffId: string; start: string; end: string }[]>
  onNew: (staffId: string, date: string, time: string) => void
  onOpen: (a: CalAppt) => void
  onMove: (a: CalAppt, to: { date: string; time: string; staffId: string }) => void
  onDay: (date: string) => void
}

export function Calendario({ view, date, days, staff, staffSel, appointments, blocks, hoursByDay, onNew, onOpen, onMove, onDay }: CalProps) {
  const angosto = useAngosto()
  const ppm = angosto ? 2.2 : 2
  const colMin = view === 'semana' ? (angosto ? 132 : 120) : angosto ? 168 : 190
  const sel = staff.find((s) => s.id === staffSel) ?? staff[0]
  const cols = useMemo(() => (view === 'dia'
    ? (staffSel === 'todos' ? staff : staff.filter((s) => s.id === staffSel)).map((s) => ({ key: s.id, staff: s, date }))
    : sel ? days.map((d) => ({ key: d, staff: sel, date: d })) : []), [view, staff, staffSel, date, days, sel])
  const data = useMemo(() => cols.map((c) => {
    const win: Ventana[] = (hoursByDay[c.date] ?? []).filter((h) => h.staffId === c.staff.id).map((h) => [toMin(h.start), toMin(h.end)] as Ventana)
    const appts = appointments.filter((a) => a.staffId === c.staff.id && dateOf(a.startsAt) === c.date)
    const bl = blocks.filter((b) => b.staffId === c.staff.id && dateOf(b.startsAt) === c.date)
    return { ...c, win, appts, bl, lanes: carriles(appts) }
  }), [cols, hoursByDay, appointments, blocks])

  // Rango visible: de la primera a la última hora con actividad u horario (por defecto 8:00–20:00).
  const todas = data.flatMap((d) => [...d.win.flat(), ...d.appts.flatMap((a) => [minOf(a.startsAt), minOf(a.endsAt) || 1440]), ...d.bl.flatMap((b) => [minOf(b.startsAt), minOf(b.endsAt) || 1440])])
  // Sin actividad ni horarios se muestra 8:00–20:00; si no, solo de la primera a la última hora con horario o citas (mínimo 6 horas).
  const ini0 = todas.length ? Math.max(0, Math.floor(Math.min(...todas) / 60) * 60) : 8 * 60
  const fin0 = todas.length ? Math.min(1440, Math.ceil(Math.max(...todas) / 60) * 60) : 20 * 60
  const fin = Math.min(1440, Math.max(fin0, ini0 + 6 * 60)); const ini = Math.max(0, Math.min(ini0, fin - 6 * 60))
  const alto = (fin - ini) * ppm
  const horas = Array.from({ length: (fin - ini) / 60 }, (_, i) => ini + i * 60)
  const ahora = minOf(new Date().toISOString())
  const RIEL = angosto ? 64 : 72

  // Arrastrar una cita (ratón) a otra hora o a otra columna.
  const drag = useRef<{ a: CalAppt; el: HTMLElement; x0: number; y0: number; offMin: number; moved: boolean } | null>(null)
  const suprimir = useRef(false)
  const onDown = (e: RPointerEvent<HTMLElement>, a: CalAppt) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !['pendiente', 'confirmada'].includes(a.status)) return
    const r = e.currentTarget.getBoundingClientRect()
    drag.current = { a, el: e.currentTarget, x0: e.clientX, y0: e.clientY, offMin: (e.clientY - r.top) / ppm, moved: false }
    const mover = (ev: PointerEvent) => {
      const d = drag.current; if (!d) return
      const dx = ev.clientX - d.x0, dy = ev.clientY - d.y0
      if (!d.moved && Math.hypot(dx, dy) < 6) return
      d.moved = true; d.el.classList.add('cb-arrastrando'); d.el.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const soltar = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar)
      const d = drag.current; drag.current = null
      if (!d) return
      d.el.classList.remove('cb-arrastrando'); d.el.style.transform = ''
      if (!d.moved) return
      suprimir.current = true; setTimeout(() => { suprimir.current = false }, 0)
      const col = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => (n as HTMLElement).dataset?.calCol) as HTMLElement | undefined
      if (!col) return
      const top = col.getBoundingClientRect().top
      const min = Math.round((ini + (ev.clientY - top) / ppm - d.offMin) / 15) * 15
      onMove(d.a, { date: col.dataset.calDate!, time: toHm(Math.max(0, Math.min(1425, min))), staffId: col.dataset.calStaff! })
    }
    window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar)
  }

  const clicVacio = (e: React.MouseEvent<HTMLDivElement>, c: (typeof data)[number]) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('cal-libre')) return
    const r = e.currentTarget.getBoundingClientRect()
    const min = Math.floor((ini + (e.clientY - r.top) / ppm) / 15) * 15
    if (!c.win.some(([a, b]) => min >= a && min < b)) return
    onNew(c.staff.id, c.date, toHm(min))
  }

  if (!cols.length) return <p className="card muted">No hay profesionales en la agenda.</p>
  const grid: CSSProperties = { gridTemplateColumns: `${RIEL}px repeat(${cols.length}, minmax(${colMin}px, 1fr))` }
  return (
    <div className="cal-scroll" role="region" aria-label={view === 'dia' ? 'Calendario del día' : 'Calendario de la semana'} tabIndex={0}>
      <div className="cal-inner" style={{ minWidth: RIEL + cols.length * colMin }}>
        <div className="cal-head" style={grid}>
          <div className="cal-corner" />
          {data.map((c) => {
            const vivas = c.appts.filter((a) => !['cancelada', 'no_asistio'].includes(a.status)).length
            const esHoy = c.date === today()
            return view === 'dia' ? (
              <div key={c.key} className="cal-colhead">
                <Avatar staff={c.staff} size={angosto ? 36 : 44} />
                <span className="cal-colname"><b>{c.staff.name}</b><small>{c.win.length ? `${vivas} ${vivas === 1 ? 'cita' : 'citas'}` : 'Descansa'}</small></span>
              </div>
            ) : (
              <button key={c.key} type="button" className={`cal-colhead cal-daybtn ${esHoy ? 'hoy' : ''}`} onClick={() => onDay(c.date)} aria-label={`Ver el día ${c.date}`}>
                <span className="cal-colname"><small>{new Date(`${c.date}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'short', timeZone: TZ })}</small><b className="cal-daynum">{Number(c.date.slice(8))}</b><small>{c.win.length ? `${vivas} ${vivas === 1 ? 'cita' : 'citas'}` : 'Descansa'}</small></span>
              </button>
            )
          })}
        </div>
        <div className="cal-body" style={{ ...grid, height: alto }}>
          <div className="cal-rail" style={{ height: alto }}>
            {horas.map((h) => <span key={h} className="cal-hora" style={{ top: (h - ini) * ppm }}>{horaCorta(h)}</span>)}
          </div>
          {data.map((c) => (
            <div key={c.key} className="cal-col" data-cal-col="1" data-cal-date={c.date} data-cal-staff={c.staff.id} style={{ height: alto }} onClick={(e) => clicVacio(e, c)}>
              {horas.map((h) => <i key={h} className="cal-linea" style={{ top: (h - ini) * ppm }} />)}
              {horas.map((h) => <i key={`m${h}`} className="cal-linea cal-media" style={{ top: (h - ini + 30) * ppm }} />)}
              {c.win.map(([a, b], i) => <div key={`w${i}`} className="cal-libre" title="Disponible: toca para agendar" style={{ top: (Math.max(a, ini) - ini) * ppm, height: (Math.min(b, fin) - Math.max(a, ini)) * ppm }} />)}
              {c.bl.map((b) => { const s = minOf(b.startsAt); const e = minOf(b.endsAt) || 1440; return <div key={b.id} className="cal-bloqueo" style={{ top: (s - ini) * ppm, height: Math.max(26, (e - s) * ppm) }}><span>⛔ {b.reason}</span></div> })}
              {c.appts.map((a) => {
                const s = minOf(a.startsAt), e = minOf(a.endsAt) || 1440
                const l = c.lanes.get(a.id)!
                const est = estadoVisual(a)
                const h = Math.max(30, (e - s) * ppm - 2)
                const movible = ['pendiente', 'confirmada'].includes(a.status)
                return (
                  <button key={a.id} type="button" className={`cal-cita cb-${est}`} data-movible={movible || undefined}
                    style={{ top: (s - ini) * ppm + 1, height: h, left: `calc(${(l.lane / l.of) * 100}% + 3px)`, width: `calc(${100 / l.of}% - 6px)` }}
                    aria-label={`${horaLarga(a.startsAt)} a ${horaLarga(a.endsAt)}, ${a.customerName}, ${a.services.map((x) => x.name).join(' y ')}, ${ETIQUETA_ESTADO[est]}`}
                    onPointerDown={(e) => onDown(e, a)} onClick={() => { if (!suprimir.current) onOpen(a) }}>
                    {(() => {
                      // Se muestran las líneas que caben en el bloque (nombre primero; luego aviso de estado, servicio y hora).
                      const n = Math.max(1, Math.floor((h - 8) / (angosto ? 24 : 21)))
                      const etq = est === 'cobrar' ? 'Por cobrar' : est === 'pendiente' ? 'Por confirmar' : ''
                      const lineas: { k: string; t: string; cls: string }[] = [{ k: 'n', t: a.customerName, cls: 'cb-nombre' }]
                      if (etq) lineas.push({ k: 'e', t: etq, cls: 'cb-etq' })
                      lineas.push({ k: 's', t: a.services.map((x) => x.name).join(' + '), cls: 'cb-serv' }, { k: 'h', t: `${horaLarga(a.startsAt)} – ${horaLarga(a.endsAt)}`, cls: 'cb-hora' })
                      return lineas.slice(0, n).map((l) => (l.k === 'n' ? <b key={l.k} className={l.cls}>{l.t}</b> : <span key={l.k} className={l.cls}>{l.t}</span>))
                    })()}
                  </button>
                )
              })}
              {c.date === today() && ahora >= ini && ahora <= fin && <div className="cal-ahora" style={{ top: (ahora - ini) * ppm }} aria-hidden><i /></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Tira de siete días (de lunes a domingo) para cambiar de día con un toque. */
export function TiraSemana({ date, onDay }: { date: string; onDay: (d: string) => void }) {
  const lunes = (() => { const wd = new Date(`${date}T12:00:00-06:00`).getUTCDay(); return new Date(Date.parse(`${date}T12:00:00-06:00`) - ((wd + 6) % 7) * 86_400_000).toISOString().slice(0, 10) })()
  const dias = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${lunes}T12:00:00-06:00`) + i * 86_400_000).toISOString().slice(0, 10))
  return (
    <div className="cal-tira" role="group" aria-label="Días de la semana">
      {dias.map((d) => (
        <button key={d} type="button" className={`${d === date ? 'on' : ''} ${d === today() ? 'hoy' : ''}`} aria-pressed={d === date} onClick={() => onDay(d)}>
          <small>{new Date(`${d}T12:00:00-06:00`).toLocaleDateString('es-MX', { weekday: 'short', timeZone: TZ }).replace('.', '')}</small><b>{Number(d.slice(8))}</b>
        </button>
      ))}
    </div>
  )
}

export const lunesDe = (date: string) => { const wd = new Date(`${date}T12:00:00-06:00`).getUTCDay(); return new Date(Date.parse(`${date}T12:00:00-06:00`) - ((wd + 6) % 7) * 86_400_000).toISOString().slice(0, 10) }

export function Leyenda() {
  const it: [string, string][] = [['confirmada', 'Confirmada'], ['pendiente', 'Por confirmar'], ['en_atencion', 'Atendiendo'], ['cobrar', 'Por cobrar'], ['atendida', 'Cobrada'], ['cancelada', 'Cancelada'], ['libre', 'Disponible'], ['fuera', 'Fuera de horario']]
  return <ul className="cal-leyenda" aria-label="Colores de la agenda">{it.map(([k, t]) => <li key={k}><i className={k === 'libre' ? 'cal-sw-libre' : k === 'fuera' ? 'cal-sw-fuera' : `cb-${k} cal-sw`} aria-hidden />{t}</li>)}</ul>
}

export { h12 }
