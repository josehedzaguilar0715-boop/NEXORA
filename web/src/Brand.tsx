import { useEffect, useId, useState } from 'react'

/** Lema de la intro (spec §15). */
export const TAGLINE = 'Todo tu negocio, conectado.'

/**
 * Logo oficial (spec §16): cuadro redondeado con degradado cian → violeta, brillo suave,
 * "N" en trazo blanco y el nodo que representa un sistema que conecta todo el negocio.
 * No cambiar proporciones, colores ni la posición del nodo.
 */
export function Logo({ size = 32, title = 'NEXORA' }: { size?: number; title?: string }) {
  // Ids propios por instancia: si una copia está oculta, las demás no pierden el degradado.
  const uid = useId().replace(/:/g, '')
  const grad = `nx-grad-${uid}`, glow = `nx-glow-${uid}`
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label={title} className="nx-mark">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--logo-1, #22D3EE)' }} /><stop offset="1" style={{ stopColor: 'var(--logo-2, #8B5CF6)' }} /></linearGradient>
        <radialGradient id={glow} cx="0.3" cy="0.25" r="0.8"><stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" /><stop offset="1" stopColor="#FFFFFF" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="32" y="32" width="448" height="448" rx="120" fill={`url(#${grad})`} />
      <rect x="32" y="32" width="448" height="448" rx="120" fill={`url(#${glow})`} />
      <path d="M168 352 V160 L344 352 V160" fill="none" style={{ stroke: 'var(--logo-ink, #FFFFFF)' }} strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="344" cy="160" r="30" style={{ fill: 'var(--logo-dot, #07090F)' }} />
      <circle cx="344" cy="160" r="14" fill="#FFFFFF" />
    </svg>
  )
}

const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/**
 * Intro obligatoria al abrir el enlace (spec §15): el logo aparece con un resplandor en degradado,
 * el nombre se revela letra por letra y después el lema. Dura unos 4 segundos, sin botón ni tecla
 * para saltarla. Con movimiento reducido se acorta, pero sigue saliendo.
 */
export function Intro() {
  const [show, setShow] = useState(() => {
    try { return !sessionStorage.getItem('nx_intro') } catch { return true }
  })
  useEffect(() => {
    if (!show) return
    try { sessionStorage.setItem('nx_intro', '1') } catch { /* sin almacenamiento: no pasa nada */ }
    const t = setTimeout(() => setShow(false), reduced() ? 1600 : 4000)
    return () => clearTimeout(t)
  }, [show])
  if (!show) return null
  return (
    <div className="intro" role="presentation" aria-label={`NEXORA. ${TAGLINE}`} data-testid="intro">
      <div className="glow" />
      <div className="mark">
        <div className="intro-logo"><Logo size={132} /></div>
        <div className="word" aria-hidden>{'NEXORA'.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${1.1 + i * 0.16}s` }}>{ch}</span>)}</div>
        <div className="tagline">{TAGLINE}</div>
      </div>
    </div>
  )
}
