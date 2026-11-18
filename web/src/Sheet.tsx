import { useEffect, type ReactNode } from 'react'

/** Panel lateral: se abre desde la derecha con el detalle de algo (cliente, producto, empleado) sin salir de la lista. */
export function Sheet({ onClose, children, wide = false }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className={`sheet-panel ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}
