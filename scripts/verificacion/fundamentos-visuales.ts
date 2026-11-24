// Verificación de los fundamentos visuales (diseno-v0): 14 productos × modo claro/oscuro × computadora, tableta y celular.
// Comprueba, en navegador real: sin errores de JS, sin desborde horizontal, contraste AA del texto realmente dibujado
// y letra mínima de 18 px en celular. Guarda capturas. Solo datos de prueba en memoria.
// Uso: npm run build && npx tsx scripts/verificacion/fundamentos-visuales.ts [carpeta de capturas] [pantalla: guia-visual|inicio|caja]
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEMOS } from '../../src/demo.js'
import { setup } from '../../test/helpers.js'

const { chromium } = createRequire(import.meta.url)('playwright') as { chromium: any }
const shots = process.argv[2] ?? 'test/e2e/shots-fundamentos'
const pantalla = process.argv[3] ?? 'guia-visual'
mkdirSync(shots, { recursive: true })
const EXPECT: Record<string, string> = { abarrotes: 'market', ferreteria: 'tools', papeleria: 'paper', barberia: 'barber', unas: 'nails', perfumeria: 'scent', banos: 'access', turistico: 'tour', palapa: 'beach', restaurante: 'dining', comedor: 'fonda', taqueria: 'taco', verduleria: 'greens' }
const s = setup(); const at = await s.adminToken()
const root = new Hono(); root.route('/api', s.app); root.use('/*', serveStatic({ root: './web/dist' })); root.get('*', serveStatic({ path: './web/dist/index.html' }))
const server = serve({ fetch: root.fetch, port: 0 }); await new Promise((r) => server.once('listening', r))
const base = `http://localhost:${(server.address() as { port: number }).port}`
const tokens: Record<string, string> = {}
for (const d of DEMOS) {
  const r = await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
  let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
  if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
  tokens[d.giro] = own.json.token
}

/** Se ejecuta en el navegador: revisa cada texto visible. */
const auditoria = () => {
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
  return { n, bad, small, overflow: document.documentElement.scrollWidth > innerWidth + 2 }
}

const browser = await chromium.launch()
const VP = { escritorio: { width: 1366, height: 900 }, tableta: { width: 768, height: 1024 }, celular: { width: 390, height: 844 } } as const
const resumen: string[] = []; let fails = 0
const productos = [...DEMOS.map((d) => d.giro), 'base'].filter((p) => !process.env.SOLO || process.env.SOLO.split(',').includes(p))
for (const [vpName, vp] of Object.entries(VP).filter(([n]) => !process.env.VPS || process.env.VPS.split(',').includes(n))) for (const modo of ['claro', 'oscuro']) for (const giro of productos) {
  const ctx = await browser.newContext({ viewport: vp })
  await ctx.addInitScript(([t, m]: [string | null, string]) => { (window as any).__name = (f: unknown) => f; sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_modo', m); if (t) localStorage.setItem('nx_token', t) }, [tokens[giro] ?? null, modo])
  const page = await ctx.newPage(); const errs: string[] = []
  page.on('pageerror', (e: Error) => errs.push(e.message))
  await page.goto(`${base}/#/${giro === 'base' ? '' : pantalla}`); await page.waitForTimeout(1300)
  if (giro === 'base') await page.evaluate(() => { /* acceso: identidad base */ })
  const prod = await page.evaluate(() => document.documentElement.dataset.product)
  const mode = await page.evaluate(() => document.documentElement.dataset.mode)
  const a = await page.evaluate(auditoria)
  const okProd = giro === 'base' ? prod === 'nexora' : prod === EXPECT[giro]
  const okModo = mode === (modo === 'claro' ? 'light' : 'dark')
  const falla = errs.length || a.overflow || a.bad.length || a.small.length || !okProd || !okModo
  if (falla) {
    fails++
    resumen.push(`✗ [${vpName}] ${giro} ${modo}: ${errs[0] ?? ''}${a.overflow ? ' DESBORDA' : ''}${!okProd ? ` producto=${prod}` : ''}${!okModo ? ` modo=${mode}` : ''}${a.bad.length ? ` contraste(${a.bad.length}): ${a.bad.slice(0, 3).join(' | ')}` : ''}${a.small.length ? ` letra<18(${a.small.length}): ${a.small.slice(0, 3).join(' | ')}` : ''}`)
  }
  if (pantalla === 'guia-visual' || vpName !== 'tableta') await page.screenshot({ path: `${shots}/${vpName}-${giro}-${modo}.png`, fullPage: false })
  await ctx.close()
}
writeFileSync(`${shots}/resumen.txt`, resumen.join('\n'))
console.log(resumen.join('\n') || 'Sin hallazgos')
console.log(`\n${productos.length * 2 * 3} combinaciones (14 productos × 2 modos × 3 tamaños) · pantalla «${pantalla}» · con hallazgos: ${fails}`)
await browser.close(); server.close(); process.exit(fails ? 1 : 0)
