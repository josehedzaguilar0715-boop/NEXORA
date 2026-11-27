import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { auth } from './api'

/** Botón «Exportar» con menú: descarga un archivo (Excel, CSV o PDF) generado por el servidor. */
export function ExportarMenu({ label, path, opciones }: { label: string; path: string; opciones: { label: string; query: string }[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [alRevés, setAlRevés] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  // El menú se abre hacia donde haya lugar (en celular el botón queda a la izquierda; en computadora, a la derecha).
  useLayoutEffect(() => {
    if (!open || !box.current) return
    const r = box.current.getBoundingClientRect(); const w = Math.min(280, window.innerWidth - 32)
    setAlRevés(r.left + w > window.innerWidth - 8)
  }, [open])
  useEffect(() => {
    if (!open) return
    const fuera = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', fuera); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', esc) }
  }, [open])
  const bajar = async (o: { label: string; query: string }) => {
    setBusy(o.query); setErr('')
    try {
      const res = await fetch(`/api${path}?${o.query}`, { headers: { authorization: `Bearer ${auth.token}` } })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message ?? 'No se pudo generar el archivo.')
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'exportacion'
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
      setOpen(false)
    } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⬇ {label}</button>
      {open && (
        <div ref={menu} role="menu" className="card" style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', ...(alRevés ? { right: 0 } : { left: 0 }), width: 'min(280px, calc(100vw - 32px))', padding: 8, display: 'grid', gap: 6 }}>
          {opciones.map((o) => <button key={o.query} role="menuitem" disabled={busy !== ''} onClick={() => void bajar(o)}>{busy === o.query ? 'Generando…' : o.label}</button>)}
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  )
}
