import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { cambiarModo, modoActual, suscribirModo } from './tema'

/** Claro por defecto; oscuro opcional. Se recuerda en este equipo. */
export function ModoBoton() {
  const modo = useSyncExternalStore(suscribirModo, modoActual)
  const oscuro = modo === 'oscuro'
  return (
    <button className="logout" onClick={(e) => { e.stopPropagation(); cambiarModo(oscuro ? 'claro' : 'oscuro') }} aria-pressed={oscuro}>
      {oscuro ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}{oscuro ? 'Modo claro' : 'Modo oscuro'}
    </button>
  )
}

