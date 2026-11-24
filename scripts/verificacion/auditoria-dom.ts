// Auditoría que se ejecuta DENTRO del navegador: contraste del texto dibujado, letra mínima en celular, desborde y textos encimados.
/** Se ejecuta en el navegador: revisa cada texto visible. */
export const auditoria = () => {
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 } }
  const over = (f: { r: number; g: number; b: number; a: number }, b: { r: number; g: number; b: number }) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a) })
  const lum = (c: { r: number; g: number; b: number }) => { const f = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]! }
  const ratio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
  /** Fondo efectivo de un elemento; si hay degradado, devuelve todos sus colores (se toma el peor caso). */
  const bgOf = (el: Element) => {
    const stack: Element[] = []
    for (let e: Element | null = el; e; e = e.parentElement) stack.push(e)
    let bg = { r: 255, g: 255, b: 255 }
    let extra: { r: number; g: number; b: number }[] = []
    for (const e of stack.reverse()) {
      const st = getComputedStyle(e)
      const c = parse(st.backgroundColor); if (c && c.a > 0) bg = over(c, bg)
      extra = []
      if (/gradient/.test(st.backgroundImage)) for (const m of st.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) { const g = parse(m[0]); if (g && g.a > 0.5) extra.push(over(g, bg)) }
    }
    return { bg, extra }
  }
  const bad: string[] = [], small: string[] = []
  let n = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set<Element>()
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement; if (!el || seen.has(el) || !t.textContent?.trim()) continue
    seen.add(el)
    const st = getComputedStyle(el); const r = el.getBoundingClientRect()
    if (st.visibility === 'hidden' || st.display === 'none' || r.width === 0 || r.height === 0 || el.closest('svg, [aria-hidden=true], .intro, .boot-loading') || (el.closest('details:not([open])') && !el.closest('summary'))) continue
    const fg = parse(st.color); if (!fg || fg.a === 0 || st.webkitTextFillColor === 'rgba(0, 0, 0, 0)' || /text/.test(st.webkitBackgroundClip || st.backgroundClip)) continue // texto con degradado de marca (logotipo)
    const { bg, extra } = bgOf(el)
    const size = parseFloat(st.fontSize); const bold = Number(st.fontWeight) >= 700
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
    const fondos = extra.length ? extra : [bg]
    const c = Math.min(...fondos.map((f) => ratio(over(fg, f), f))); n++
    const label = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} «${(t.textContent ?? '').trim().slice(0, 24)}» ${size}px`
    if (c < need) bad.push(`${label} contraste ${c.toFixed(2)} < ${need}`)
    if (innerWidth <= 600 && size < 17.95) small.push(label)
  }
  // Textos encimados: dos textos visibles (que no se contienen) cuyo recuadro se cruza de forma apreciable.
  const hojas: { el: Element; r: DOMRect; rs: DOMRect[]; txt: string }[] = []
  for (const el of seen) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el)
    if (r.width < 4 || r.height < 4 || st.visibility === 'hidden' || el.closest('svg, [aria-hidden=true], .intro, .boot-loading, .buscador-lista, .bottom, .topbar') || (el.closest('details:not([open])') && !el.closest('summary'))) continue
    if (r.bottom < 0 || r.top > innerHeight * 6) continue
    // Contenido que queda recortado dentro de una zona con desplazamiento (no se ve) no cuenta.
    let recortado = false
    const zonas: DOMRect[] = []
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue
      const pr = p.getBoundingClientRect(); zonas.push(pr)
      if (r.top >= pr.bottom - 1 || r.bottom <= pr.top + 1 || r.left >= pr.right - 1 || r.right <= pr.left + 1) { recortado = true; break }
    }
    if (recortado) continue
    // Lo que se ve de cada renglón: su recuadro recortado por las zonas con desplazamiento que lo contienen.
    const visibles = [...el.getClientRects()].map((q) => { let l = q.left, tp = q.top, rr = q.right, bt = q.bottom; for (const z of zonas) { l = Math.max(l, z.left); tp = Math.max(tp, z.top); rr = Math.min(rr, z.right); bt = Math.min(bt, z.bottom) } return new DOMRect(l, tp, Math.max(0, rr - l), Math.max(0, bt - tp)) }).filter((q) => q.width > 3 && q.height > 3)
    // Solo el texto propio del elemento (sin contar a sus hijos).
    const propio = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent?.trim()).map((n) => n.textContent!.trim()).join(' ')
    if (propio) hojas.push({ el, r, rs: visibles, txt: propio.slice(0, 18) })
  }
  const encimados: string[] = []
  for (let i = 0; i < hojas.length && encimados.length < 5; i++) for (let j = i + 1; j < hojas.length; j++) {
    const a = hojas[i]!, b = hojas[j]!
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    // Se comparan renglón contra renglón (un texto que se parte en dos líneas no se encima consigo mismo ni con su vecino).
    let cruce = false
    for (const x of a.rs) { for (const y of b.rs) {
      const w = Math.min(x.right, y.right) - Math.max(x.left, y.left), h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top)
      if (w > 3 && h > 5 && (w * h) / Math.min(x.width * x.height, y.width * y.height) > 0.25) { cruce = true; break }
    } if (cruce) break }
    if (cruce) { encimados.push(`«${a.txt}» con «${b.txt}»`); if (encimados.length >= 5) break }
  }
  // Texto cortado o que se sale de su caja: la palabra más larga no cabe, o el recuadro recorta lo que no cabe (sin puntos suspensivos).
  const cortados: string[] = []
  for (const el of seen) {
    const st = getComputedStyle(el); const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8 || st.visibility === 'hidden' || el.closest('svg, [aria-hidden=true], .intro, .boot-loading, .buscador-lista, .topbar') || (el.closest('details:not([open])') && !el.closest('summary'))) continue
    if (st.display === 'inline') continue
    const rec = (st.overflowX !== 'visible' && st.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && st.overflowX !== 'auto' && st.overflowX !== 'scroll')
    let derrame = false
    for (const nd of el.childNodes) {
      if (nd.nodeType !== 3 || !nd.textContent?.trim()) continue
      const rg = document.createRange(); rg.selectNodeContents(nd)
      for (const q of rg.getClientRects()) if (q.width > 2 && (q.right > r.right + 2 || q.left < r.left - 2) && st.overflowX === 'visible' && !el.closest('.table-wrap, .portal-tabs, .periodo, .subtabs, .tabs')) derrame = true
    }
    if (rec || derrame) cortados.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} «${(el.textContent ?? '').trim().slice(0, 18)}»`)
  }
  // Controles sin nombre accesible (lector de pantalla): botón, enlace o campo sin texto, etiqueta ni aria-label.
  const sinNombre: string[] = []
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=option]')) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el)
    if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || el.closest('[aria-hidden=true]')) continue
    const h = el as HTMLInputElement
    const nombre = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el.textContent ?? '').trim() || (h.labels && h.labels.length ? 'etiqueta' : '') || h.placeholder || (h.type === 'checkbox' || h.type === 'radio' ? (el.closest('label')?.textContent ?? '').trim() : '')
    if (!nombre) sinNombre.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`)
  }
  return { n, bad, small, overflow: document.documentElement.scrollWidth > innerWidth + 2, encimados, sinNombre, cortados }
}

