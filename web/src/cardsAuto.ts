import { useEffect } from 'react'

/**
 * En celular, las tablas de estas pantallas se muestran como tarjetas (cada dato con su etiqueta). Lo hace solo, sin tocar cada tabla:
 * agrega la clase `cards-sm` a su contenedor y copia el título de cada columna a cada celda. En computadora la tabla se ve igual que siempre.
 */
export const PANTALLAS_CON_TARJETAS = ['configurar', 'usuarios', 'productos', 'devoluciones', 'entradas', 'acceso', 'importar', 'lealtad', 'cotizaciones', 'encargos', 'precios', 'carne', 'menu']

function adaptar(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>('.table-wrap table').forEach((t) => {
    const wrap = t.closest('.table-wrap')
    if (!wrap || wrap.classList.contains('cards-sm') || wrap.classList.contains('no-cards')) return
    wrap.classList.add('cards-sm')
    const heads = [...t.querySelectorAll('thead th')].map((h) => (h.textContent ?? '').trim())
    if (!heads.length) return
    t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (td.tagName === 'TD' && heads[i] && !td.hasAttribute('data-label') && !td.hasAttribute('colspan')) td.setAttribute('data-label', heads[i]!) }))
  })
}

export function useTarjetasEnCelular(pantalla: string | undefined) {
  useEffect(() => {
    if (!pantalla || !PANTALLAS_CON_TARJETAS.includes(pantalla)) return
    const main = document.getElementById('contenido') ?? document.body
    adaptar(main)
    const obs = new MutationObserver(() => adaptar(main))
    obs.observe(main, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [pantalla])
}
