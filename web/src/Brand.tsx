import { useEffect, useId, useState } from 'react'

/** Marca provisional (spec §15: el logo definitivo está pendiente). Hexágono con degradado cian → violeta. */
export function Logo({ size = 32 }: { size?: number }) {
  // Un degradado por instancia: si una copia está oculta, las demás no pierden el color.
  const id = `nx-g-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="NEXORA">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path d="M32 4 56 18v28L32 60 8 46V18Z" fill="none" stroke={`url(#${id})`} strokeWidth="4" strokeLinejoin="round" />
      <path d="M22 44V20l20 24V20" fill="none" stroke={`url(#${id})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Intro al abrir el enlace: el logo aparece con fundido y escala suave (unos 2.5 s) y luego pasa al acceso
 * o al panel. Se puede omitir y solo sale una vez por sesión del navegador.
 */
export function Intro() {
  const [show, setShow] = useState(() => {
    try {
      return !sessionStorage.getItem('nx_intro')
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!show) return
    try { sessionStorage.setItem('nx_intro', '1') } catch { /* sin almacenamiento: no pasa nada */ }
    const t = setTimeout(() => setShow(false), 2800)
    return () => clearTimeout(t)
  }, [show])
  if (!show) return null
  return (
    <div className="intro" role="presentation" data-testid="intro">
      <div className="glow" />
      <div className="mark">
        <Logo size={120} />
        <div className="word">NEXORA</div>
      </div>
      <button className="skip" onClick={() => setShow(false)}>Omitir</button>
    </div>
  )
}
