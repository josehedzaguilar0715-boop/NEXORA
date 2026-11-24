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
    if (st.visibility === 'hidden' || st.display === 'none' || r.width === 0 || r.height === 0 || el.closest('svg, [aria-hidden=true], .intro, .boot-loading')) continue
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
    if (r.width < 4 || r.height < 4 || st.visibility === 'hidden' || el.closest('svg, [aria-hidden=true], .intro, .boot-loading, .buscador-lista, .bottom, .topbar')) continue
    if (r.bottom < 0 || r.top > innerHeight * 6) continue
    // Solo el texto propio del elemento (sin contar a sus hijos).
    const propio = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent?.trim()).map((n) => n.textContent!.trim()).join(' ')
    if (propio) hojas.push({ el, r, rs: [...el.getClientRects()].filter((q) => q.width > 3 && q.height > 3), txt: propio.slice(0, 18) })
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
  return { n, bad, small, overflow: document.documentElement.scrollWidth > innerWidth + 2, encimados }
}

