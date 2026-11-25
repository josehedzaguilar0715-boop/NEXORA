import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { api, mxn } from '../api'

type Pos = Record<string, { x: number; y: number }>
const COLOR: Record<string, string> = { libre: '#16a34a', ocupada: '#2563eb', reservada: '#7c3aed', por_cobrar: '#dc2626', limpieza: '#64748b' }
const ETIQUETA: Record<string, string> = { libre: 'Libre', ocupada: 'Ocupada', reservada: 'Reservada', por_cobrar: 'Por cobrar', limpieza: 'Limpieza' }
const tam = (seats: number) => (seats <= 2 ? 84 : seats <= 4 ? 100 : seats <= 6 ? 120 : 140)

/** Las posiciones son el centro de la mesa (en % de la zona). Posición automática en cuadrícula para las mesas que todavía no se acomodaron. */
function auto(i: number, n: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)))
  const rows = Math.ceil(n / cols)
  return { x: ((i % cols) + 0.5) * (100 / cols), y: (Math.floor(i / cols) + 0.5) * (100 / rows) }
}

/** Plano gráfico de una zona: cada mesa con su forma, estado en color y texto. Quien configura puede acomodarlas arrastrando. */
export function PlanoMesas({ tables, puedeEditar, onOpen }: { tables: any[]; puedeEditar: boolean; onOpen: (t: any) => void }) {
  const [plan, setPlan] = useState<Pos>({})
  const [edit, setEdit] = useState(false)
  const [msg, setMsg] = useState('')
  const drag = useRef<{ id: string; box: DOMRect } | null>(null)
  useEffect(() => { api<any>('GET', '/tables/plan').then((r) => setPlan(r.plan ?? {})).catch(() => {}) }, [])
  const areas = [...new Set(tables.map((t) => t.area))]
  const pos = (t: any, i: number, n: number) => plan[t.id] ?? auto(i, n)
  const mover = (e: RPointerEvent) => {
    const d = drag.current; if (!d) return
    const x = Math.min(100, Math.max(0, ((e.clientX - d.box.left) / d.box.width) * 100))
    const y = Math.min(100, Math.max(0, ((e.clientY - d.box.top) / d.box.height) * 100))
    setPlan((p) => ({ ...p, [d.id]: { x, y } }))
  }
  const guardar = async () => {
    try {
      // Se guardan las posiciones de todas las mesas visibles (las automáticas también), para que no salten.
      const full: Pos = {}
      for (const a of areas) { const ts = tables.filter((t) => t.area === a); ts.forEach((t, i) => { full[t.id] = plan[t.id] ?? auto(i, ts.length) }) }
      await api('PUT', '/tables/plan', full); setPlan(full); setEdit(false); setMsg('Plano guardado.')
    } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div>
      {puedeEditar && (
        <div className="toolbar">
          {edit ? <><button className="primary" onClick={() => void guardar()}>Guardar plano</button><button onClick={() => { setEdit(false); void api<any>('GET', '/tables/plan').then((r) => setPlan(r.plan ?? {})) }}>Cancelar</button><span className="muted small">Arrastra cada mesa a su lugar.</span></>
            : <button onClick={() => { setEdit(true); setMsg('') }}>Acomodar mesas</button>}
        </div>
      )}
      {msg && <p className={msg.startsWith('Plano') ? 'okmsg' : 'error'}>{msg}</p>}
      {areas.map((a) => {
        const ts = tables.filter((t) => t.area === a)
        return (
          <section key={a} className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ textTransform: 'capitalize' }}>{a}</h2>
            <div className="plano" data-edit={edit || undefined} role="group" aria-label={`Plano de ${a}`}
              onPointerMove={mover} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
              {ts.map((t, i) => {
                const p = pos(t, i, ts.length); const s = tam(t.seats); const h = Math.round(s * 0.8)
                return (
                  <button key={t.id} type="button" className={`mesa-plano ${t.seats <= 4 ? 'redonda' : ''}`} aria-label={`Mesa ${t.name}, ${t.seats} lugares, ${ETIQUETA[t.status]}${t.tabId ? `, ${mxn(t.total)}` : ''}`}
                    style={{ left: `clamp(0px, calc(${p.x}% - ${s / 2}px), calc(100% - ${s}px))`, top: `clamp(0px, calc(${p.y}% - ${h / 2}px), calc(100% - ${h}px))`, width: s, height: h, borderColor: COLOR[t.status], touchAction: edit ? 'none' : 'auto', cursor: edit ? 'grab' : 'pointer' }}
                    onClick={() => { if (!edit) onOpen(t) }}
                    onPointerDown={(e) => { if (!edit) return; const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect(); drag.current = { id: t.id, box }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}>
                    <b>{t.name}</b>
                    <small style={{ color: COLOR[t.status] }}>{ETIQUETA[t.status]}</small>
                    <small>{t.tabId ? mxn(t.total) : `${t.seats} lug.`}</small>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      <div className="plano-leyenda" aria-label="Significado de los colores">
        {Object.keys(ETIQUETA).map((k) => <span key={k} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: COLOR[k], display: 'inline-block' }} aria-hidden />{ETIQUETA[k]}</span>)}
      </div>
    </div>
  )
}
