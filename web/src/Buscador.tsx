import { Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { buscar, type ItemBusqueda } from './buscar'
import { MODULOS, moduloDe } from './modulos'
import type { Screen } from './App'

/**
 * Buscador global de funciones. Solo encuentra lo que esta persona puede abrir (recibe las pantallas ya filtradas por
 * permisos, giro y producto). Atajos: «/» o Ctrl+K lo enfocan; ↑ ↓ Enter navegan; Esc cierra.
 */
export function Buscador({ pantallas, rapidas, onIr, senal }: { pantallas: Screen[]; rapidas: string[]; onIr: (key: string) => void; senal: number }) {
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const id = useId()
  const items = useMemo<(ItemBusqueda & { s: Screen })[]>(() => pantallas.map((s) => ({ key: s.key, label: s.label, desc: s.desc, modulo: MODULOS[moduloDe(s.key)].nombre, s })), [pantallas])
  const lista = useMemo(() => {
    if (q.trim()) return buscar(items, q)
    // Sin escribir: lo que más se usa en este negocio.
    return rapidas.map((k) => items.find((i) => i.key === k)).filter((i): i is NonNullable<typeof i> => !!i).slice(0, 5)
  }, [items, q, rapidas])

  useEffect(() => { setSel(0) }, [q])
  useEffect(() => { if (senal > 0) ref.current?.focus() }, [senal])
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const escribiendo = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if ((e.key === '/' && !escribiendo && !e.ctrlKey && !e.metaKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); ref.current?.focus() }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const ir = (key: string) => { setQ(''); setAbierto(false); ref.current?.blur(); onIr(key) }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setSel((v) => Math.min(v + 1, Math.max(0, lista.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)) }
    else if (e.key === 'Enter' && lista[sel]) { e.preventDefault(); ir(lista[sel]!.key) }
    else if (e.key === 'Escape') { setQ(''); setAbierto(false); ref.current?.blur() }
  }
  return (
    <div className="buscador" role="search">
      <label htmlFor={id} className="sr-only">Buscar una función</label>
      <Search size={20} aria-hidden className="buscador-lupa" />
      <input
        id={id} ref={ref} type="search" value={q} placeholder="Buscar… (ej. fiado, cita)" autoComplete="off" enterKeyHint="go"
        role="combobox" aria-expanded={abierto} aria-controls={`${id}-lista`} aria-activedescendant={abierto && lista[sel] ? `${id}-${lista[sel]!.key}` : undefined}
        onChange={(e) => { setQ(e.target.value); setAbierto(true) }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)} onKeyDown={onKey}
      />
      {q && <button type="button" className="buscador-x" aria-label="Borrar búsqueda" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(''); ref.current?.focus() }}><X size={18} aria-hidden /></button>}
      {abierto && (
        <ul className="buscador-lista" id={`${id}-lista`} role="listbox" aria-label={q.trim() ? 'Resultados' : 'Lo más usado'}>
          {!q.trim() && lista.length > 0 && <li className="buscador-nota" aria-hidden>Lo más usado</li>}
          {lista.map((i, n) => {
            const m = moduloDe(i.key), M = MODULOS[m]
            return (
              <li key={i.key} id={`${id}-${i.key}`} role="option" aria-selected={n === sel} className={n === sel ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => ir(i.key)} onMouseEnter={() => setSel(n)}>
                <span className={`mod-ico mod-${m}`}><i.s.icon size={20} aria-hidden /></span>
                <span className="buscador-txt"><b>{i.label}</b><small>{M.nombre}{i.desc ? ` · ${i.desc}` : ''}</small></span>
              </li>
            )
          })}
          {q.trim() && lista.length === 0 && <li className="buscador-vacio" role="status">Sin resultados para «{q.trim()}». Prueba con otra palabra, por ejemplo «venta» o «cliente».</li>}
        </ul>
      )}
    </div>
  )
}
