// Genera el «modo contrario» de cada producto (claro ↔ oscuro) a partir de su paleta propia, sin cambiar su identidad:
// la marca (primary, fuentes, formas, logo) queda igual; solo cambian superficies, textos y colores de apoyo, y se
// ajustan hasta cumplir contraste AA (4.5:1 texto, 3:1 íconos). Salida:
//   src/products/modos.generated.css  (reglas [data-mode] por producto)
//   src/products/modos.generated.ts   (color de fondo por producto y modo, para la barra del navegador)
// Uso: node scripts/generar-modos.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const css = readFileSync('src/products/products.css', 'utf8') + '\n' + readFileSync('src/styles.css', 'utf8')
const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v * (1 - t) + B[i] * t)) }
const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
/** Acerca `fg` a negro (sobre fondo claro) o a blanco (sobre fondo oscuro) hasta cumplir el contraste mínimo contra `bg`. */
const ensure = (fg, bg, min, toward) => { let c = fg; for (let i = 0; i < 40 && ratio(c, bg) < min; i++) c = mix(c, toward, 0.08); return c }
const pickOn = (bg) => (ratio('#ffffff', bg) >= ratio('#14171d', bg) ? '#ffffff' : '#14171d')
/** Texto de color (enlaces, avisos, estados) legible sobre fondo, tarjeta, campo y sus versiones teñidas con el propio color. */
function textSafe(vars, key, toward, min = 4.5) {
  const fg = vars[key]; if (!isHex(fg)) return fg
  const bgs = [vars['--bg'], vars['--card'], vars['--input'], mix(vars['--card'], fg, 0.16), mix(vars['--bg'], fg, 0.16)].filter(isHex)
  let c = fg; for (let i = 0; i < 40 && Math.min(...bgs.map((b) => ratio(c, b))) < min; i++) c = mix(c, toward, 0.08)
  return c
}
const isHex = (v) => /^#[0-9a-f]{3,6}$/i.test(v?.trim() ?? '')

// ---- Leer paletas nativas ----
function vars(body) { const o = {}; for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o }
const natives = {}
for (const m of css.matchAll(/:root\[data-product='(\w+)'\](?:,\s*:root\[data-product='(\w+)'\])?\s*\{([^}]*)\}/g)) {
  const v = vars(m[3]); if (!v['--bg']) continue
  for (const id of [m[1], m[2]].filter(Boolean)) natives[id] = { ...v }
}
const base = vars(readFileSync('src/styles.css', 'utf8').match(/:root\s*\{([^}]*)\}/)[1]); natives.nexora = base
const ids = ['nexora', 'barber', 'nails', 'market', 'tools', 'paper', 'scent', 'access', 'tour', 'beach', 'dining', 'fonda', 'taco', 'greens']

const out = ['/* GENERADO por web/scripts/generar-modos.mjs — no editar a mano. Modo contrario de cada producto (misma identidad). */']
const ts = {}
for (const id of ids) {
  const n = natives[id]
  if (!n) throw new Error('Producto sin paleta: ' + id)
  if (!n['--bg']) throw new Error('sin --bg: ' + id + ' ' + Object.keys(n).join())
  const nativeDark = lum(n['--bg']) < 0.3
  const mode = nativeDark ? 'light' : 'dark'
  const tint = n['--primary']
  const v = {}
  if (mode === 'light') {
    v['--bg'] = mix('#f5f6f8', tint, 0.05); v['--card'] = '#ffffff'; v['--input'] = mix('#ffffff', tint, 0.05)
    v['--ink'] = mix('#14171d', tint, 0.1); v['--muted'] = '#505a6b'; v['--muted-2'] = '#5f6a7b'
    v['--line'] = mix('#e2e5ea', tint, 0.12); v['--line-strong'] = mix('#c9cfd8', tint, 0.2)
    v['--selected'] = mix('#ffffff', tint, 0.12); v['--selected-line'] = mix('#ffffff', tint, 0.3)
    v['--hi'] = '#000000'; v['--glass'] = 'rgba(255, 255, 255, 0.86)'
    v['--ok'] = '#12703f'; v['--danger'] = '#b42318'
  } else {
    v['--bg'] = mix('#0c0f14', tint, 0.1); v['--card'] = mix('#151a21', tint, 0.12); v['--input'] = mix('#1b2029', tint, 0.14)
    v['--ink'] = '#eef1f5'; v['--muted'] = '#a9b2c0'; v['--muted-2'] = '#8f9aab'
    v['--line'] = mix('#262c37', tint, 0.18); v['--line-strong'] = mix('#394255', tint, 0.28)
    v['--selected'] = mix('#1b212b', tint, 0.28); v['--selected-line'] = mix('#2c3546', tint, 0.4)
    v['--hi'] = '#ffffff'; v['--glass'] = 'rgba(16, 20, 27, 0.8)'
    v['--ok'] = '#4cd08f'; v['--danger'] = '#f98080'
  }
  const toward = mode === 'light' ? '#000000' : '#ffffff'
  const surf = v['--card']
  // Textos secundarios y de estado: contraste AA contra superficie y fondo.
  for (const k of ['--muted', '--muted-2', '--ok', '--danger']) v[k] = ensure(ensure(v[k], v['--bg'], 4.5, toward), surf, 4.5, toward)
  // Acentos de la marca usados como texto o enlace (--cyan es el color de enlace/acento de cada producto).
  for (const k of ['--cyan', '--violet', '--accent']) if (isHex(n[k])) { v[k] = n[k]; v[k] = textSafe(v, k, toward, k === '--violet' ? 3 : 4.5) }
  for (const k of ['--ok', '--danger']) v[k] = textSafe(v, k, toward)
  // Colores de gráficas y de íconos del menú: legibles sobre la superficie (≥3:1).
  for (const k of Object.keys(n)) if (/^--(chart-(in|out|profit|bar-1|bar-2)|tone-[a-z]+)$/.test(k) && isHex(n[k])) v[k] = ensure(n[k], surf, 3, toward)
  v['--chart-grid'] = v['--line']
  v['--brand-text'] = `linear-gradient(135deg, ${v['--ink']}, ${ensure(n['--cyan'], v['--bg'], 4.5, toward)})`
  v['--body-glow'] = 'none'
  v['--glow'] = mode === 'light' ? '0 10px 26px -16px rgba(20, 30, 50, 0.28)' : '0 12px 32px -14px rgba(0, 0, 0, 0.7)'
  if (mode === 'light') { v['--shadow-sm'] = '0 1px 2px rgba(20, 30, 50, 0.1)'; v['--shadow-md'] = '0 8px 24px -12px rgba(20, 30, 50, 0.22)'; v['--shadow-lg'] = '0 24px 60px -20px rgba(20, 30, 50, 0.3)' }
  // Capas de profundidad y degradados que cada producto fija a mano para su modo propio: aquí se rehacen para el modo contrario.
  if (mode === 'light') {
    v['--surface'] = 'var(--card)'; v['--surface-sunken'] = 'var(--input)'
    v['--elev-1'] = '0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 1px 2px rgba(20, 30, 50, 0.07), 0 8px 20px -14px rgba(20, 30, 50, 0.2)'
    v['--elev-2'] = '0 1px 0 rgba(255, 255, 255, 0.95) inset, 0 2px 5px rgba(20, 30, 50, 0.07), 0 18px 40px -24px rgba(20, 30, 50, 0.3)'
    v['--elev-3'] = '0 1px 0 #fff inset, 0 8px 16px rgba(20, 30, 50, 0.09), 0 30px 60px -28px rgba(20, 30, 50, 0.38)'
  } else {
    v['--surface'] = 'linear-gradient(180deg, color-mix(in srgb, var(--card) 94%, #fff 6%) 0%, var(--card) 40%)'; v['--surface-sunken'] = 'linear-gradient(180deg, color-mix(in srgb, var(--input) 92%, #000 8%), var(--input))'
    v['--elev-1'] = '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 1px 2px rgba(0, 0, 0, 0.25), 0 8px 24px -16px rgba(0, 0, 0, 0.6)'
    v['--elev-2'] = '0 1px 0 rgba(255, 255, 255, 0.07) inset, 0 2px 4px rgba(0, 0, 0, 0.25), 0 18px 40px -22px rgba(0, 0, 0, 0.75)'
    v['--elev-3'] = '0 1px 0 rgba(255, 255, 255, 0.09) inset, 0 6px 12px rgba(0, 0, 0, 0.3), 0 32px 64px -28px rgba(0, 0, 0, 0.8)'
  }
  v['--btn-primary'] = 'linear-gradient(180deg, color-mix(in srgb, var(--primary) 84%, #fff 16%) 0%, var(--primary) 55%, color-mix(in srgb, var(--primary) 88%, #000 12%) 100%)'
  v['--btn-primary-glow'] = '0 8px 20px -12px color-mix(in srgb, var(--primary) 80%, transparent)'
  v['--focus-ring'] = '0 0 0 3px color-mix(in srgb, var(--primary) 38%, transparent)'
  v['--on-danger'] = pickOn(v['--danger']); v['--on-accent'] = pickOn(v['--accent'] ?? '#ffffff')
  v['--on-primary'] = ratio('#ffffff', tint) >= ratio('#14171d', tint) ? '#ffffff' : '#14171d'
  // Modo propio del producto: solo se corrigen los colores de texto que no llegaban a AA (los que ya cumplen no cambian).
  const nat = { ...n }; const nTow = nativeDark ? '#ffffff' : '#000000'; const fix = {}
  for (const k of ['--muted', '--muted-2']) if (isHex(n[k])) { const c = ensure(ensure(n[k], n['--bg'], 4.5, nTow), n['--card'], 4.5, nTow); if (c !== n[k]) fix[k] = c }
  for (const k of ['--cyan', '--accent', '--ok', '--danger']) if (isHex(n[k])) { const c = textSafe(nat, k, nTow); if (c !== n[k]) fix[k] = c }
  // Botón principal: el texto debe leerse sobre TODO su degradado (también el tramo más claro).
  const on = n['--on-primary'] ?? pickOn(n['--primary']); const onDark = lum(on) < 0.4
  const stopsOf = (x, prim) => (x && x.match(/#[0-9a-f]{6}/gi)) || [mix(prim, '#ffffff', 0.18), prim, mix(prim, '#000000', 0.12)]
  const peor = Math.min(...stopsOf(n['--btn-primary'], n['--primary']).map((s) => ratio(on, s)))
  if (peor < 4.5) {
    let prim = n['--primary']
    for (let i = 0; i < 30 && Math.min(...stopsOf(null, prim).map((s) => ratio(on, s))) < 4.5; i++) prim = mix(prim, onDark ? '#ffffff' : '#000000', 0.06)
    fix['--primary'] = prim; fix['--btn-primary'] = `linear-gradient(180deg, color-mix(in srgb, ${prim} 84%, #fff 16%) 0%, ${prim} 55%, color-mix(in srgb, ${prim} 88%, #000 12%) 100%)`
  }
  const dng = fix['--danger'] ?? n['--danger'], acc = fix['--accent'] ?? n['--accent']
  if (isHex(dng)) fix['--on-danger'] = pickOn(dng)
  if (isHex(acc)) fix['--on-accent'] = pickOn(acc)
  out.push(`:root[data-product='${id}'][data-mode='${nativeDark ? 'dark' : 'light'}'] {\n${Object.entries(fix).map(([k, x]) => `  ${k}: ${x};`).join('\n')}\n}`)
  ts[id] = { native: nativeDark ? 'dark' : 'light', [mode]: v['--bg'] }
  out.push(`:root[data-product='${id}'][data-mode='${mode}'] .card:not(.seccion) { box-shadow: var(--elev-2); border-color: var(--line); }\n:root[data-product='${id}'][data-mode='${mode}'] button.primary { text-shadow: none; }\n:root[data-product='${id}'][data-mode='${mode}'] {\n  color-scheme: ${mode};\n${Object.entries(v).map(([k, x]) => `  ${k}: ${x};`).join('\n')}\n}`)
}
writeFileSync('src/products/modos.generated.css', out.join('\n\n') + '\n')
writeFileSync('src/products/modos.generated.ts', `// GENERADO por web/scripts/generar-modos.mjs — no editar a mano.\nexport const MODOS: Record<string, { native: 'light' | 'dark'; light?: string; dark?: string }> = ${JSON.stringify(ts, null, 2)}\n`)
console.log('Generado:', ids.map((i) => `${i}→${ts[i].light ? 'claro' : 'oscuro'}`).join(' '))
