
/**
 * Tema: claro por defecto y oscuro opcional (decisión del propietario, 24 nov 2026).
 * Cada producto conserva su identidad (marca, letra, formas); solo cambian superficies, textos y apoyo
 * (reglas generadas en products/modos.generated.css). Se recuerda por equipo, sin tocar el servidor.
 */
export type Modo = 'claro' | 'oscuro'
const KEY = 'nx_modo'
type Escucha = () => void
const escuchas = new Set<Escucha>()

export function modoGuardado(): Modo {
  try { return localStorage.getItem(KEY) === 'oscuro' ? 'oscuro' : 'claro' } catch { return 'claro' }
}

/** Pone los atributos del tema en <html> y el color de la barra del navegador. `colorNativo` es el de la paleta propia del producto. */
/** Un solo tema para toda la plataforma: el color de la barra del navegador no depende del producto. */
const FONDO = { claro: '#f6f7f9', oscuro: '#0f1218' } as const
export function aplicarTema(_productId?: string, _colorNativo?: string, modo: Modo = modoGuardado()) {
  const raiz = document.documentElement
  raiz.dataset.mode = modo === 'claro' ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', FONDO[modo])
}

export function cambiarModo(modo: Modo) {
  try { localStorage.setItem(KEY, modo) } catch { /* sin almacenamiento */ }
  const raiz = document.documentElement
  aplicarTema(undefined, undefined, modo)
  escuchas.forEach((f) => f())
}

export const suscribirModo = (f: Escucha) => { escuchas.add(f); return () => void escuchas.delete(f) }
export const modoActual = (): Modo => (document.documentElement.dataset.mode === 'dark' ? 'oscuro' : 'claro')
