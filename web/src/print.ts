/**
 * Impresión de tickets, cortes, comprobantes y boletos con el diálogo del sistema (impresora térmica de 58 u 80 mm,
 * o cualquier impresora). Se imprime SOLO lo indicado: se copia a un contenedor propio y el resto de la app no ocupa
 * lugar (sin hojas en blanco). Los tickets de texto están armados a 32 columnas: la letra se calcula para que
 * 32 columnas quepan en el ancho útil de un rollo de 58 mm (48 mm); en 80 mm también caben.
 */
function run(fill: (root: HTMLElement) => void) {
  document.querySelector('.print-root')?.remove()
  const root = document.createElement('div')
  root.className = 'print-root'
  fill(root)
  document.body.appendChild(root)
  document.body.classList.add('printing')
  const done = () => { document.body.classList.remove('printing'); root.remove(); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.print()
  // Algunos navegadores no avisan «afterprint»: se limpia de todos modos.
  setTimeout(() => { if (document.body.contains(root)) done() }, 60_000)
}

/** Ticket o corte en texto (32 columnas). */
export function printText(text: string) {
  run((root) => { const pre = document.createElement('pre'); pre.className = 'ticket-print'; pre.textContent = text; root.appendChild(pre) })
}

/** Una parte de la pantalla tal cual (p. ej. los boletos con su QR). */
export function printElement(el: Element | null) {
  if (!el) return
  run((root) => { const copy = el.cloneNode(true) as HTMLElement; copy.classList.add('print-block'); root.appendChild(copy) })
}

/** Ancho del rollo de la impresora de tickets: 58 mm (32 columnas) u 80 mm (48 columnas). Se recuerda en este equipo. */
export type Papel = '58' | '80'
export const papel = (): Papel => { try { return localStorage.getItem('nx_papel') === '80' ? '80' : '58' } catch { return '58' } }
export const guardarPapel = (p: Papel) => { try { localStorage.setItem('nx_papel', p) } catch { /* sin almacenamiento: queda en 58 mm */ } }
